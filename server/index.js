import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync } from 'fs';
import iconv from 'iconv-lite';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const BOOKS_DIR = join(DATA_DIR, 'books');
const ROOMS_FILE = join(DATA_DIR, 'rooms.json');
const HIGHLIGHTS_FILE = join(DATA_DIR, 'highlights.json');

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: ['http://localhost:3100', 'http://127.0.0.1:3100'] },
});

app.use(cors());
app.use(express.json());

// 健康检查（用于确认后端已启动）
app.get('/api/health', (_, res) => res.json({ ok: true }));

// 内存存储（启动时从磁盘加载）
const books = new Map();
const rooms = new Map();

const PAGE_SIZE = 500; // 每页约500字，按段落分页

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(BOOKS_DIR)) mkdirSync(BOOKS_DIR, { recursive: true });
}

function loadBooks() {
  if (!existsSync(BOOKS_DIR)) return;
  try {
    const files = readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const path = join(BOOKS_DIR, f);
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      if (!data.highlights) data.highlights = [];
      books.set(data.id, data);
    }
  } catch (e) {
    console.warn('[持久化] 加载书籍失败:', e.message);
  }
}

// 迁移：将书籍内已有 highlights 同步到独立存储（仅补充缺失的）
function migrateHighlightsFromBooks() {
  const seen = new Set(highlightsStore.map((h) => `${h.bookId}:${h.pageIndex}:${h.start}:${h.end}:${h.type}`));
  let added = 0;
  for (const book of books.values()) {
    for (const h of book.highlights || []) {
      const key = `${book.id}:${h.pageIndex}:${h.start}:${h.end}:${h.type}`;
      if (seen.has(key)) continue;
      const text = book.pages?.[h.pageIndex]?.slice(h.start, h.end) || '';
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
  writeFileSync(join(BOOKS_DIR, `${book.id}.json`), JSON.stringify(book, null, 0), 'utf-8');
}

function removeBook(id) {
  const path = join(BOOKS_DIR, `${id}.json`);
  if (existsSync(path)) unlinkSync(path);
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

// 文件上传
const upload = multer({
  dest: tmpdir(),
  fileFilter: (_, file, cb) => {
    if (file.mimetype === 'text/plain' || (file.originalname || '').endsWith('.txt')) {
      cb(null, true);
    } else {
      cb(new Error('只支持 txt 文件'));
    }
  },
});

// 解码文本内容（支持 UTF-8、GBK）
function decodeText(buffer) {
  if (!buffer?.length) return '';
  let str = iconv.decode(buffer, 'utf8');
  if (str.includes('\uFFFD')) str = iconv.decode(buffer, 'gbk');
  return str;
}

// 上传 txt 文件（优先使用客户端传来的 filename，避免中文乱码）
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请选择文件' });
    const buffer = readFileSync(req.file.path);
    const content = decodeText(buffer);
    unlinkSync(req.file.path);
    const name = (req.query?.filename && typeof req.query.filename === 'string')
      ? decodeURIComponent(req.query.filename).trim()
      : (req.file.originalname || '未命名.txt');
    const id = uuidv4();
    const pages = paginate(content);
    const book = {
      id,
      name,
      content,
      totalPages: pages.length,
      pageSize: PAGE_SIZE,
      pages,
      highlights: [],
    };
    books.set(id, book);
    saveBook(book);
    res.json({ id, name, totalPages: pages.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取书籍列表
app.get('/api/books', (req, res) => {
  const list = Array.from(books.values()).map((b) => ({
    id: b.id,
    name: b.name,
    totalPages: b.totalPages,
  }));
  res.json(list);
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
    book: { id: book.id, name: book.name, totalPages: book.totalPages },
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
  const pageIndex = !isNaN(pageParam) && pageParam >= 1 && pageParam <= book.pages.length
    ? pageParam - 1
    : room.currentPage - 1;
  const content = book.pages[pageIndex] || '';
  const highlights = (book.highlights || []).filter((h) => h.pageIndex === pageIndex);
  res.json({
    content,
    highlights,
    currentPage: pageIndex + 1,
    totalPages: book.totalPages,
    readerStates: room.readerStates,
  });
});

// 添加划线（好词/好句）- 同时写入书籍（阅读展示）和独立存储（书删了也不丢）
app.post('/api/rooms/:roomId/highlights', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const book = books.get(room.bookId);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const { type, pageIndex, start, end } = req.body || {};
  if (!['word', 'sentence'].includes(type) || typeof pageIndex !== 'number' || typeof start !== 'number' || typeof end !== 'number') {
    return res.status(400).json({ error: '参数错误' });
  }
  if (pageIndex < 0 || pageIndex >= book.pages.length || start < 0 || end <= start) {
    return res.status(400).json({ error: '范围无效' });
  }
  const text = book.pages[pageIndex]?.slice(start, end) || '';
  if (!book.highlights) book.highlights = [];
  book.highlights.push({ type, pageIndex, start, end });
  saveBook(book);
  // 独立存储：书删了也不删
  highlightsStore.push({
    id: uuidv4(),
    bookId: book.id,
    bookName: book.name,
    pageIndex,
    start,
    end,
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
  socket.on('join-room', (roomId) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: '房间不存在' });
      return;
    }
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    if (roomSockets && roomSockets.size >= 2) {
      socket.emit('error', { message: '房间已满，仅限两人' });
      return;
    }
    socket.join(roomId);
    socket.roomId = roomId;
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
      room.currentPage++;
      room.readerStates = {};
      saveRooms();
      io.to(roomId).emit('page-turn', {
        currentPage: room.currentPage,
        readerStates: {},
      });
    } else {
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
    }
  });
});

const PORT = 3101;

// 启动时加载持久化数据
ensureDataDir();
loadBooks();
loadHighlights();
migrateHighlightsFromBooks();
loadRooms();

// 启动前强制释放端口
try {
  execSync(`lsof -ti:${PORT} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
} catch (_) {}

httpServer.listen(PORT, () => {
  console.log(`\n[后端] 已启动 http://localhost:${PORT}`);
  console.log(`[后端] 健康检查: http://localhost:${PORT}/api/health\n`);
}).on('error', (err) => {
  console.error('[后端] 启动失败:', err.message);
  process.exit(1);
});
