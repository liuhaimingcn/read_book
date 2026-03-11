import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import iconv from 'iconv-lite';
import { tmpdir, networkInterfaces } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const gm = require('gm');
import { fromPath } from 'pdf2pic';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const BOOKS_DIR = join(DATA_DIR, 'books');

// 安全限制
const LIMITS = {
  FILE_SIZE_TXT: 5 * 1024 * 1024,   // txt 单文件最大 5MB
  FILE_SIZE_PDF: 50 * 1024 * 1024,  // pdf 单文件最大 50MB
  TOTAL_STORAGE: 10 * 1024 * 1024 * 1024, // 总存储最大 10GB
  MAX_BOOKS: 50,                    // 最多 50 本书
  MAX_ROOMS: 100,                   // 最多 100 个房间
  MAX_HIGHLIGHTS: 10000,             // 最多 10000 条好词好句
  MAX_CONTENT_LENGTH: 2 * 1024 * 1024, // 文本内容最大 2MB（解码后）
  MAX_FILENAME_LENGTH: 100,         // 文件名最长 100 字符
  JSON_BODY_LIMIT: '100kb',         // JSON 请求体最大 100KB
};
const ROOMS_FILE = join(DATA_DIR, 'rooms.json');
const HIGHLIGHTS_FILE = join(DATA_DIR, 'highlights.json');

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: true },
});

app.use(cors());
app.use(express.json({ limit: LIMITS.JSON_BODY_LIMIT }));

// 请求日志：每次请求记录详情
app.use((req, res, next) => {
  const start = Date.now();
  const ip = req.get('x-forwarded-for')?.split(',')[0]?.trim() || req.socket?.remoteAddress || '-';
  const ua = req.get('user-agent') || '-';
  res.on('finish', () => {
    const ms = Date.now() - start;
    const queryStr = Object.keys(req.query || {}).length ? `?${new URLSearchParams(req.query).toString()}` : '';
    const log = [
      `[请求] ${req.method} ${req.path}${queryStr}`,
      `状态=${res.statusCode}`,
      `耗时=${ms}ms`,
      `IP=${ip}`,
      `UA=${ua.slice(0, 80)}${ua.length > 80 ? '...' : ''}`,
    ].join(' | ');
    console.log(log);
  });
  next();
});

// 健康检查（用于确认后端已启动）
app.get('/api/health', (_, res) => res.json({ ok: true }));

// 分享链接基础 URL（用于复制链接，解决 localhost 时跨设备分享）
app.get('/api/share-base', (req, res) => {
  let host = req.get('x-forwarded-host') || req.get('host') || req.hostname;
  const protocol = (req.get('x-forwarded-proto') || req.protocol || 'http').replace(/:$/, '') || 'http';
  const clientPort = req.query.clientPort;
  if ((!host || /^localhost$|^127\./.test(String(host).split(':')[0])) && clientPort) {
    for (const nets of Object.values(networkInterfaces())) {
      for (const net of nets || []) {
        if (net.family === 'IPv4' && !net.internal && /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(net.address)) {
          host = `${net.address}:${clientPort}`;
          break;
        }
      }
      if (host && String(host).includes('.')) break;
    }
  }
  res.json({ url: `${protocol}://${host}` });
});

// 内存存储（启动时从磁盘加载）
const books = new Map();
const rooms = new Map();

const PAGE_SIZE = 500; // 每页约500字，按段落分页

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(BOOKS_DIR)) mkdirSync(BOOKS_DIR, { recursive: true });
}

// 获取 data 目录总大小（字节）
function getTotalStorageSize() {
  if (!existsSync(DATA_DIR)) return 0;
  let total = 0;
  try {
    const walk = (dir) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else total += statSync(p).size;
      }
    };
    walk(DATA_DIR);
  } catch (_) {}
  return total;
}

// 安全处理文件名：去除路径、控制字符、限制长度
function sanitizeFilename(name, ext = '.txt') {
  if (typeof name !== 'string') return `未命名${ext}`;
  const base = name.replace(/[/\\:*?"<>|\x00-\x1f]/g, '').trim() || '未命名';
  const safe = base.slice(0, LIMITS.MAX_FILENAME_LENGTH);
  if (safe.toLowerCase().endsWith('.pdf')) return safe;
  if (safe.toLowerCase().endsWith('.txt')) return safe;
  return safe.includes('.') ? safe : `${safe}${ext}`;
}

// 按页存储：只加载元数据，不加载正文
function loadBooks() {
  if (!existsSync(BOOKS_DIR)) return;
  try {
    const files = readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const filePath = join(BOOKS_DIR, f);
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (!data.highlights) data.highlights = [];
      // 旧格式（含 pages）：迁移到按页存储
      if (data.pages && Array.isArray(data.pages)) {
        const pagesDir = join(BOOKS_DIR, data.id, 'pages');
        mkdirSync(pagesDir, { recursive: true });
        for (let i = 0; i < data.pages.length; i++) {
          writeFileSync(join(pagesDir, `${i}.txt`), data.pages[i] || '', 'utf-8');
        }
        const meta = { id: data.id, name: data.name, totalPages: data.totalPages, pageSize: data.pageSize || PAGE_SIZE, highlights: data.highlights || [], bookType: 'txt' };
        writeFileSync(filePath, JSON.stringify(meta, null, 0), 'utf-8');
        books.set(data.id, meta);
      } else {
        if (!data.bookType) data.bookType = 'txt';
        if (data.bookType === 'pdf' && data.pdfPages === undefined) {
          const pagesDir = join(BOOKS_DIR, data.id, 'pages');
          data.pdfPages = existsSync(pagesDir) && readdirSync(pagesDir).some((f) => f.endsWith('.png'));
        }
        books.set(data.id, data);
      }
    }
  } catch (e) {
    console.warn('[持久化] 加载书籍失败:', e.message);
  }
}

// 按需读取单页内容（仅 txt）
function getPageContent(bookId, pageIndex) {
  const book = books.get(bookId);
  if (book?.bookType === 'pdf') return '';
  const pagePath = join(BOOKS_DIR, bookId, 'pages', `${pageIndex}.txt`);
  if (existsSync(pagePath)) return readFileSync(pagePath, 'utf-8');
  if (book?.pages?.[pageIndex]) return book.pages[pageIndex];
  return '';
}

// 迁移：将书籍内已有 highlights 同步到独立存储（仅补充缺失的）
function migrateHighlightsFromBooks() {
  const seen = new Set(highlightsStore.map((h) => `${h.bookId}:${h.pageIndex}:${h.start}:${h.end}:${h.type}`));
  let added = 0;
  for (const book of books.values()) {
    for (const h of book.highlights || []) {
      const key = `${book.id}:${h.pageIndex}:${h.start}:${h.end}:${h.type}`;
      if (seen.has(key)) continue;
      const pageContent = getPageContent(book.id, h.pageIndex);
      const text = pageContent.slice(h.start, h.end) || '';
      highlightsStore.push({
        id: uuidv4(),
        bookId: book.id,
        bookName: book.name,
        pageIndex: h.pageIndex,
        start: h.start,
        end: h.end,
        type: h.type,
        text,
        createdAt: Date.now(),
        used: false,
      });
      seen.add(key);
      added++;
    }
  }
  if (added > 0) saveHighlights();
}

function saveBook(book) {
  ensureDataDir();
  const meta = {
    id: book.id,
    name: book.name,
    totalPages: book.totalPages,
    pageSize: book.pageSize || PAGE_SIZE,
    highlights: book.highlights || [],
    bookType: book.bookType || 'txt',
  };
  writeFileSync(join(BOOKS_DIR, `${book.id}.json`), JSON.stringify(meta, null, 0), 'utf-8');
  if (book.pages && Array.isArray(book.pages)) {
    const pagesDir = join(BOOKS_DIR, book.id, 'pages');
    mkdirSync(pagesDir, { recursive: true });
    for (let i = 0; i < book.pages.length; i++) {
      writeFileSync(join(pagesDir, `${i}.txt`), book.pages[i] || '', 'utf-8');
    }
  }
}

function removeBook(id) {
  const metaPath = join(BOOKS_DIR, `${id}.json`);
  const bookDir = join(BOOKS_DIR, id);
  if (existsSync(metaPath)) unlinkSync(metaPath);
  if (existsSync(bookDir)) rmSync(bookDir, { recursive: true });
}

function loadRooms() {
  if (!existsSync(ROOMS_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(ROOMS_FILE, 'utf-8'));
    for (const [id, room] of Object.entries(data)) {
      if (books.has(room.bookId)) {
        rooms.set(id, { ...room, readerStates: {} });
      }
    }
  } catch (e) {
    console.warn('[持久化] 加载房间失败:', e.message);
  }
}

function saveRooms() {
  ensureDataDir();
  const obj = {};
  for (const [id, room] of rooms) {
    obj[id] = { id, bookId: room.bookId, currentPage: room.currentPage, createdAt: room.createdAt };
  }
  writeFileSync(ROOMS_FILE, JSON.stringify(obj, null, 0), 'utf-8');
}

// 好词好句独立存储（书删了也不删）
let highlightsStore = [];
function loadHighlights() {
  if (!existsSync(HIGHLIGHTS_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(HIGHLIGHTS_FILE, 'utf-8'));
    let needsSave = false;
    highlightsStore = (Array.isArray(data.items) ? data.items : []).map((h) => {
      const id = h.id || uuidv4();
      if (!h.id) needsSave = true;
      return { ...h, id, used: !!h.used };
    });
    if (needsSave) saveHighlights();
  } catch (e) {
    console.warn('[持久化] 加载好词好句失败:', e.message);
  }
}
function saveHighlights() {
  ensureDataDir();
  writeFileSync(HIGHLIGHTS_FILE, JSON.stringify({ items: highlightsStore }, null, 0), 'utf-8');
}

// 分页逻辑：按段落分页，每页约500字
function paginate(content, pageSize = PAGE_SIZE) {
  const text = content.replace(/\r\n/g, '\n').trim();
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [''];
  const pages = [];
  let current = '';
  for (const p of paragraphs) {
    const sep = current ? '\n\n' : '';
    const added = current + sep + p;
    if (added.length <= pageSize) {
      current = added;
    } else {
      if (current) pages.push(current);
      if (p.length <= pageSize) {
        current = p;
      } else {
        let rest = p;
        while (rest.length > pageSize) {
          const breakAt = rest.lastIndexOf('\n', pageSize);
          const chunk = breakAt > 0 ? rest.slice(0, breakAt + 1) : rest.slice(0, pageSize);
          pages.push(chunk);
          rest = rest.slice(chunk.length);
        }
        current = rest;
      }
    }
  }
  if (current) pages.push(current);
  return pages.length ? pages : [''];
}

// 文件上传（PDF 50MB，txt 5MB，multer 用较大值）
const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: LIMITS.FILE_SIZE_PDF },
  fileFilter: (_, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const ok = file.mimetype === 'text/plain' || file.mimetype === 'application/pdf' ||
      name.endsWith('.txt') || name.endsWith('.pdf');
    cb(ok ? null : new Error('只支持 txt、pdf 文件'), ok);
  },
});

// 常见 gm 路径（macOS Homebrew），仅存在时尝试
function getGmPaths() {
  const candidates = ['/opt/homebrew/bin/', '/usr/local/bin/'];
  return candidates.filter((p) => existsSync(join(p, 'gm')));
}

// PDF 预切割为图片页（需安装 graphicsmagick+ghostscript 或 imagemagick+ghostscript）
async function convertPdfToPages(pdfPath, pagesDir, numPages = 0) {
  console.log('[PDF] 开始预切割:', pdfPath, '预计', numPages, '页');
  const opts = {
    density: 150,
    format: 'png',
    width: 1200,
    preserveAspectRatio: true,
    savePath: pagesDir,
    saveFilename: 'page',
  };
  const BATCH = 10;
  const total = numPages || 0;
  const tries = [
    ...getGmPaths().map((p) => () => { const c = fromPath(pdfPath, opts); c.setGMClass(p); return c; }),
    () => { const c = fromPath(pdfPath, opts); c.setGMClass(true); return c; },
    () => fromPath(pdfPath, opts),
  ];
  let lastErr;
  for (const fn of tries) {
    try {
      const convert = fn();
      if (total > 0) {
        for (let start = 1; start <= total; start += BATCH) {
          const pages = [];
          for (let p = start; p < Math.min(start + BATCH, total + 1); p++) pages.push(p);
          await convert.bulk(pages, { responseType: 'image' });
          const done = Math.min(start + BATCH - 1, total);
          console.log('[PDF] 切割进度:', done, '/', total);
          if (done >= total) break;
        }
      } else {
        await convert.bulk(-1, { responseType: 'image' });
        console.log('[PDF] 切割完成（全部转换）');
      }
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  console.log('[PDF] 转换完成，重命名文件...');
  const files = readdirSync(pagesDir).filter((f) => f.endsWith('.png')).sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return na - nb;
  });
  for (let i = 0; i < files.length; i++) {
    const src = join(pagesDir, files[i]);
    const dest = join(pagesDir, `${i}.png`);
    if (src !== dest) {
      try {
        const buf = readFileSync(src);
        writeFileSync(dest, buf);
        unlinkSync(src);
      } catch (_) {}
    }
  }
  // 裁剪每页白边后预留边距（trim 去白边，border 加回适量留白）
  const PAD = 20; // 四边各预留 20px
  console.log('[PDF] 开始裁剪白边并预留边距，共', files.length, '页');
  for (let i = 0; i < files.length; i++) {
    const p = join(pagesDir, `${i}.png`);
    try {
      await new Promise((resolve, reject) => {
        gm(p).trim().borderColor('white').border(PAD, PAD).write(p, (err) => (err ? reject(err) : resolve()));
      });
      if ((i + 1) % 10 === 0 || i === files.length - 1) {
        console.log('[PDF] trim 进度:', i + 1, '/', files.length);
      }
    } catch (e) {
      console.warn('[PDF] trim/留白失败:', p, e.message);
    }
  }
  console.log('[PDF] 预切割完成，共', files.length, '页');
  return files.length > 0;
}

// 解码文本内容（支持 UTF-8、GBK）
function decodeText(buffer) {
  if (!buffer?.length) return '';
  let str = iconv.decode(buffer, 'utf8');
  if (str.includes('\uFFFD')) str = iconv.decode(buffer, 'gbk');
  return str;
}

// 上传 txt/pdf 文件（带安全校验）
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请选择文件' });

    // 数量限制
    if (books.size >= LIMITS.MAX_BOOKS) {
      unlinkSync(req.file.path);
      return res.status(400).json({ error: `最多只能上传 ${LIMITS.MAX_BOOKS} 本书` });
    }

    const buffer = readFileSync(req.file.path);
    let rawName = req.file.originalname || '未命名.txt';
    try {
      if (req.query?.filename && typeof req.query.filename === 'string') {
        rawName = decodeURIComponent(req.query.filename);
      }
    } catch (_) {}

    const isPdf = (req.file.mimetype === 'application/pdf' || (rawName || '').toLowerCase().endsWith('.pdf'));

    if (!isPdf && buffer.length > LIMITS.FILE_SIZE_TXT) {
      unlinkSync(req.file.path);
      return res.status(400).json({ error: `txt 文件不能超过 ${LIMITS.FILE_SIZE_TXT / 1024 / 1024}MB` });
    }

    if (isPdf) {
      // PDF 上传
      const currentSize = getTotalStorageSize();
      if (currentSize + buffer.length > LIMITS.TOTAL_STORAGE) {
        unlinkSync(req.file.path);
        return res.status(400).json({ error: `存储空间已满（最多 ${LIMITS.TOTAL_STORAGE / 1024 / 1024 / 1024}GB）` });
      }
      let numPages = 1;
      try {
        const data = await pdfParse(buffer);
        numPages = data.numpages || 1;
      } catch (_) {}
      const name = sanitizeFilename(rawName, '.pdf');
      const id = uuidv4();
      const bookDir = join(BOOKS_DIR, id);
      mkdirSync(bookDir, { recursive: true });
      const pdfPath = join(bookDir, 'book.pdf');
      writeFileSync(pdfPath, buffer);
      unlinkSync(req.file.path);
      const pagesDir = join(bookDir, 'pages');
      mkdirSync(pagesDir, { recursive: true });
      let hasPages = false;
      try {
        console.log('[PDF] 上传完成，开始预切割 bookId=', id, '页数=', numPages);
        hasPages = await convertPdfToPages(pdfPath, pagesDir, numPages);
      } catch (e) {
        console.warn('[PDF] 预切割失败，请安装: brew install graphicsmagick ghostscript 或 brew install imagemagick ghostscript');
        console.warn('[PDF] 错误详情:', e.message);
      }
      const meta = { id, name, totalPages: numPages, bookType: 'pdf', highlights: [], pdfPages: hasPages };
      writeFileSync(join(BOOKS_DIR, `${id}.json`), JSON.stringify(meta, null, 0), 'utf-8');
      books.set(id, meta);
      return res.json({ id, name, totalPages: numPages, pdfPages: hasPages });
    }

    // txt 上传
    const content = decodeText(buffer);
    unlinkSync(req.file.path);

    if (content.length > LIMITS.MAX_CONTENT_LENGTH) {
      return res.status(400).json({ error: `文件内容不能超过 ${LIMITS.MAX_CONTENT_LENGTH / 1024 / 1024}MB` });
    }

    const name = sanitizeFilename(rawName);

    const currentSize = getTotalStorageSize();
    if (currentSize + buffer.length > LIMITS.TOTAL_STORAGE) {
      return res.status(400).json({ error: `存储空间已满（最多 ${LIMITS.TOTAL_STORAGE / 1024 / 1024 / 1024}GB）` });
    }

    const id = uuidv4();
    const pages = paginate(content);
    const book = {
      id,
      name,
      totalPages: pages.length,
      pageSize: PAGE_SIZE,
      pages,
      highlights: [],
    };
    saveBook(book);
    books.set(id, { id, name, totalPages: pages.length, pageSize: PAGE_SIZE, highlights: [] });
    res.json({ id, name, totalPages: pages.length });
  } catch (e) {
    if (req.file?.path && existsSync(req.file.path)) unlinkSync(req.file.path);
    const msg = e.code === 'LIMIT_FILE_SIZE' ? `文件不能超过 ${LIMITS.FILE_SIZE_PDF / 1024 / 1024}MB` : e.message;
    res.status(e.code === 'LIMIT_FILE_SIZE' ? 400 : 500).json({ error: msg });
  }
});

// 获取书籍列表
app.get('/api/books', (req, res) => {
  const list = Array.from(books.values()).map((b) => ({
    id: b.id,
    name: b.name,
    totalPages: b.totalPages,
    bookType: b.bookType || 'txt',
  }));
  res.json(list);
});

// 获取 PDF 文件（仅 bookType=pdf）
app.get('/api/books/:id/file', (req, res) => {
  const book = books.get(req.params.id);
  if (!book || book.bookType !== 'pdf') return res.status(404).json({ error: '不存在' });
  const pdfPath = join(BOOKS_DIR, book.id, 'book.pdf');
  if (!existsSync(pdfPath)) return res.status(404).json({ error: '文件不存在' });
  res.sendFile(pdfPath);
});

// 获取 PDF 预切割页图片（1-based 页码，有则返回图片，无则 404）
app.get('/api/books/:id/page/:page', (req, res) => {
  const book = books.get(req.params.id);
  if (!book || book.bookType !== 'pdf') return res.status(404).json({ error: '不存在' });
  const pageNum = parseInt(req.params.page, 10);
  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > (book.totalPages || 1)) {
    return res.status(404).json({ error: '页码无效' });
  }
  const imgPath = join(BOOKS_DIR, book.id, 'pages', `${pageNum - 1}.png`);
  if (!existsSync(imgPath)) return res.status(404).json({ error: '该页未预渲染' });
  res.type('image/png').sendFile(imgPath);
});

// 删除书籍（不存在也返回成功；会同时移除引用该书的房间）
app.post('/api/books/delete', (req, res) => {
  const { id } = req.body || {};
  if (id && books.has(id)) {
    books.delete(id);
    removeBook(id);
    for (const [roomId, room] of rooms) {
      if (room.bookId === id) rooms.delete(roomId);
    }
    saveRooms();
  }
  res.json({ ok: true });
});

// 获取房间列表
app.get('/api/rooms', (req, res) => {
  const list = [];
  for (const [roomId, room] of rooms) {
    const book = books.get(room.bookId);
    if (book) {
      list.push({
        roomId,
        bookName: book.name,
        currentPage: room.currentPage,
        totalPages: book.totalPages,
        createdAt: room.createdAt,
      });
    }
  }
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json(list);
});

// 创建房间
app.post('/api/rooms', (req, res) => {
  const { bookId } = req.body;
  if (!bookId || !books.has(bookId)) {
    return res.status(400).json({ error: '书籍不存在' });
  }
  if (rooms.size >= LIMITS.MAX_ROOMS) {
    return res.status(400).json({ error: `房间数量已达上限（${LIMITS.MAX_ROOMS}）` });
  }
  const roomId = uuidv4().slice(0, 8);
  const room = {
    id: roomId,
    bookId,
    currentPage: 1,
    readerStates: {},
    createdAt: Date.now(),
  };
  rooms.set(roomId, room);
  saveRooms();
  res.json({ roomId, book: books.get(bookId) });
});

// 获取房间信息
app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const book = books.get(room.bookId);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  res.json({
    roomId: room.id,
    currentPage: room.currentPage,
    book: { id: book.id, name: book.name, totalPages: book.totalPages, bookType: book.bookType || 'txt' },
    readerStates: room.readerStates,
  });
});

// 释放房间（仅手动释放）
app.post('/api/rooms/:roomId/release', (req, res) => {
  const { roomId } = req.params;
  if (rooms.has(roomId)) {
    rooms.delete(roomId);
    saveRooms();
  }
  res.json({ ok: true });
});

// 获取房间页内容（?page=N 可指定页码，否则用房间当前页）
app.get('/api/rooms/:roomId/page', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const book = books.get(room.bookId);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const pageParam = parseInt(req.query.page, 10);
  const pageIndex = !isNaN(pageParam) && pageParam >= 1 && pageParam <= book.totalPages
    ? pageParam - 1
    : room.currentPage - 1;
  const isPdf = book.bookType === 'pdf';
  const content = isPdf ? '' : getPageContent(book.id, pageIndex);
  const highlights = (book.highlights || []).filter((h) => h.pageIndex === pageIndex);
  const base = {
    content,
    highlights,
    currentPage: pageIndex + 1,
    totalPages: book.totalPages,
    readerStates: room.readerStates,
  };
  if (isPdf) {
    base.type = 'pdf';
    base.pdfUrl = `/api/books/${book.id}/file`;
    base.pdfPages = !!book.pdfPages;
    base.pageImageUrl = book.pdfPages ? `/api/books/${book.id}/page/${pageIndex + 1}` : null;
    base.pageIndex = pageIndex;
  }
  res.json(base);
});

// 添加划线（好词/好句）- txt 用 start/end，PDF 用 text
app.post('/api/rooms/:roomId/highlights', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const book = books.get(room.bookId);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const { type, pageIndex, start, end, text: textBody } = req.body || {};
  if (!['word', 'sentence'].includes(type) || typeof pageIndex !== 'number') {
    return res.status(400).json({ error: '参数错误' });
  }
  if (pageIndex < 0 || pageIndex >= book.totalPages) {
    return res.status(400).json({ error: '范围无效' });
  }
  let text;
  let startVal = 0;
  let endVal = 0;
  if (book.bookType === 'pdf') {
    if (typeof textBody !== 'string' || !textBody.trim()) return res.status(400).json({ error: '请选择文字' });
    text = textBody.trim().slice(0, 500);
  } else {
    if (typeof start !== 'number' || typeof end !== 'number') return res.status(400).json({ error: '参数错误' });
    if (start < 0 || end <= start) return res.status(400).json({ error: '范围无效' });
    const pageContent = getPageContent(book.id, pageIndex);
    text = pageContent.slice(start, end) || '';
    startVal = start;
    endVal = end;
  }
  if (highlightsStore.length >= LIMITS.MAX_HIGHLIGHTS) {
    return res.status(400).json({ error: `好词好句数量已达上限（${LIMITS.MAX_HIGHLIGHTS}）` });
  }
  if (!book.highlights) book.highlights = [];
  const hl = book.bookType === 'pdf' ? { type, pageIndex, text } : { type, pageIndex, start: startVal, end: endVal };
  book.highlights.push(hl);
  saveBook(book);
  // 独立存储：书删了也不删（PDF 用 start=0, end=text.length 兼容）
  highlightsStore.push({
    id: uuidv4(),
    bookId: book.id,
    bookName: book.name,
    pageIndex,
    start: startVal,
    end: endVal,
    type,
    text,
    createdAt: Date.now(),
    used: false,
  });
  saveHighlights();
  io.to(req.params.roomId).emit('highlights-updated', { pageIndex, highlights: book.highlights.filter((h) => h.pageIndex === pageIndex) });
  res.json({ ok: true, highlights: book.highlights.filter((h) => h.pageIndex === pageIndex) });
});

// 获取书中全部划线（从独立存储，按好词/好句分类）
app.get('/api/rooms/:roomId/highlights-all', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const book = books.get(room.bookId);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const byBook = highlightsStore.filter((h) => h.bookId === room.bookId);
  const mapH = (h) => ({ ...h, used: !!h.used });
  const words = byBook.filter((h) => h.type === 'word').map(mapH);
  const sentences = byBook.filter((h) => h.type === 'sentence').map(mapH);
  res.json({ words, sentences });
});

// 标记好词好句为已使用/未使用
app.patch('/api/highlights/:id/used', (req, res) => {
  const item = highlightsStore.find((h) => h.id === req.params.id);
  if (!item) return res.status(404).json({ error: '不存在' });
  item.used = !item.used;
  saveHighlights();
  res.json({ ok: true, used: item.used });
});

// 获取全部好词好句（独立于书籍，书删了也能看到）
app.get('/api/highlights', (req, res) => {
  const bookIdToRoom = new Map();
  for (const [roomId, room] of rooms) {
    if (!bookIdToRoom.has(room.bookId)) bookIdToRoom.set(room.bookId, roomId);
  }
  const withRoom = (h) => ({ ...h, roomId: bookIdToRoom.get(h.bookId) || null });
  const words = highlightsStore.filter((h) => h.type === 'word').map(withRoom);
  const sentences = highlightsStore.filter((h) => h.type === 'sentence').map(withRoom);
  res.json({ words, sentences });
});

// Socket.io
io.on('connection', (socket) => {
  console.log(`[Socket] 连接 socket.id=${socket.id}`);

  socket.on('join-room', (roomId) => {
    const room = rooms.get(roomId);
    if (!room) {
      console.log(`[Socket] join-room 失败 roomId=${roomId} 房间不存在`);
      socket.emit('error', { message: '房间不存在' });
      return;
    }
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    if (roomSockets && roomSockets.size >= 2) {
      console.log(`[Socket] join-room 失败 roomId=${roomId} 房间已满`);
      socket.emit('error', { message: '房间已满，仅限两人' });
      return;
    }
    socket.join(roomId);
    socket.roomId = roomId;
    const book = books.get(room.bookId);
    console.log(`[Socket] join-room 成功 roomId=${roomId} 当前页=${room.currentPage}/${book?.totalPages || '?'} book=${book?.name || '?'}`);
    socket.emit('room-joined', {
      currentPage: room.currentPage,
      readerStates: room.readerStates,
    });
    io.to(roomId).emit('sync-state', {
      currentPage: room.currentPage,
      readerStates: room.readerStates,
    });
  });

  socket.on('reader-ready', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.readerStates[socket.id] = true;
    const book = books.get(room.bookId);
    const readerCount = Object.keys(room.readerStates).length;
    const allReady = readerCount >= 2 && Object.values(room.readerStates).every(Boolean);
    if (allReady && room.currentPage < book.totalPages) {
      const newPage = room.currentPage + 1;
      room.currentPage++;
      room.readerStates = {};
      saveRooms();
      console.log(`[Socket] 翻页 roomId=${roomId} ${room.currentPage - 1} -> ${room.currentPage}/${book.totalPages} 书=${book?.name || '?'}`);
      io.to(roomId).emit('page-turn', {
        currentPage: room.currentPage,
        readerStates: {},
      });
    } else {
      console.log(`[Socket] reader-ready roomId=${roomId} 已读=${readerCount}/2 当前页=${room.currentPage} 未翻页`);
      io.to(roomId).emit('sync-state', {
        currentPage: room.currentPage,
        readerStates: room.readerStates,
      });
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId) {
      const room = rooms.get(roomId);
      if (room && room.readerStates[socket.id] !== undefined) {
        delete room.readerStates[socket.id];
        io.to(roomId).emit('sync-state', {
          currentPage: room.currentPage,
          readerStates: room.readerStates,
        });
      }
      console.log(`[Socket] 断开 roomId=${roomId} socket.id=${socket.id}`);
    }
  });
});

// 统一错误处理（如 multer 文件过大）
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: `文件不能超过 ${LIMITS.FILE_SIZE_PDF / 1024 / 1024}MB` });
  }
  next(err);
});

// 生产环境：若存在 client/dist 则托管前端（放在所有 API 之后）
const clientDist = join(__dirname, '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('/{*path}', (_, res) => res.sendFile(join(clientDist, 'index.html')));
}

const PORT = 3101;

// 启动时加载持久化数据
ensureDataDir();
loadBooks();
loadHighlights();
migrateHighlightsFromBooks();
loadRooms();

// 启动前强制释放端口（超时 2 秒，避免阻塞）
try {
  execSync(`lsof -ti:${PORT} | xargs kill -9 2>/dev/null`, { stdio: 'ignore', timeout: 2000 });
} catch (_) {}

httpServer.listen(PORT, () => {
  console.log(`\n[后端] 已启动 http://localhost:${PORT}`);
  console.log(`[后端] 健康检查: http://localhost:${PORT}/api/health\n`);
}).on('error', (err) => {
  console.error('[后端] 启动失败:', err.message);
  process.exit(1);
});
