/**
 * 认证模块：用户存储、密码校验、session 中间件
 */
import bcrypt from 'bcrypt';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');

// 密码规则：字母+数字组合，长度>=9
const PWD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d)[a-zA-Z0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]{9,}$/;

// 预设划线颜色
export const HIGHLIGHT_COLORS = [
  { value: '#fef08a', label: '黄色' },
  { value: '#bbf7d0', label: '绿色' },
  { value: '#bfdbfe', label: '蓝色' },
  { value: '#fecaca', label: '红色' },
  { value: '#e9d5ff', label: '紫色' },
  { value: '#fed7aa', label: '橙色' },
];

let users = [];

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadUsers() {
  if (!existsSync(USERS_FILE)) {
    users = [];
    return;
  }
  try {
    const data = JSON.parse(readFileSync(USERS_FILE, 'utf-8'));
    users = Array.isArray(data.users) ? data.users : [];
  } catch (e) {
    console.warn('[Auth] 加载用户失败:', e.message);
    users = [];
  }
}

function saveUsers() {
  ensureDataDir();
  writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 0), 'utf-8');
}

/**
 * 初始化管理员账户（仅首次或不存在时）
 */
export function initAdminUser() {
  loadUsers();
  const adminUsername = 'liuhaiming';
  const exists = users.some((u) => u.username === adminUsername);
  if (exists) return;
  const passwordHash = bcrypt.hashSync('liu19900613', 10);
  users.push({
    username: adminUsername,
    passwordHash,
    isAdmin: true,
    highlightColor: HIGHLIGHT_COLORS[0].value,
  });
  saveUsers();
  console.log('[Auth] 已初始化管理员账户:', adminUsername);
}

/**
 * 校验密码格式
 */
export function validatePasswordFormat(password) {
  if (typeof password !== 'string' || password.length < 9) {
    return { ok: false, error: '密码长度不能低于9位' };
  }
  if (!PWD_REGEX.test(password)) {
    return { ok: false, error: '密码须为字母和数字的组合' };
  }
  return { ok: true };
}

/**
 * 登录
 */
export async function loginUser(username, password, highlightColor) {
  loadUsers();
  const user = users.find((u) => u.username === username);
  if (!user) return { ok: false, error: '用户名或密码错误' };
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return { ok: false, error: '用户名或密码错误' };
  const color = HIGHLIGHT_COLORS.some((c) => c.value === highlightColor)
    ? highlightColor
    : HIGHLIGHT_COLORS[0].value;
  return {
    ok: true,
    user: {
      username: user.username,
      isAdmin: !!user.isAdmin,
      highlightColor: color,
    },
  };
}

/**
 * 注册新用户
 */
export async function registerUser(username, password, highlightColor) {
  loadUsers();
  const trimmed = String(username || '').trim();
  if (trimmed.length < 3) return { ok: false, error: '用户名至少3个字符' };
  if (trimmed.length > 20) return { ok: false, error: '用户名最多20个字符' };
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(trimmed)) {
    return { ok: false, error: '用户名只能包含字母、数字、下划线或中文' };
  }
  const pwdCheck = validatePasswordFormat(password);
  if (!pwdCheck.ok) return pwdCheck;
  const exists = users.some((u) => u.username.toLowerCase() === trimmed.toLowerCase());
  if (exists) return { ok: false, error: '用户名已被占用' };
  const passwordHash = await bcrypt.hash(password, 10);
  const color = HIGHLIGHT_COLORS.some((c) => c.value === highlightColor)
    ? highlightColor
    : HIGHLIGHT_COLORS[0].value;
  users.push({
    username: trimmed,
    passwordHash,
    isAdmin: false,
    highlightColor: color,
  });
  saveUsers();
  return {
    ok: true,
    user: { username: trimmed, isAdmin: false, highlightColor: color },
  };
}

/**
 * 根据用户名获取用户信息（用于 session 恢复）
 */
export function getUserByUsername(username) {
  loadUsers();
  const user = users.find((u) => u.username === username);
  if (!user) return null;
  return {
    username: user.username,
    isAdmin: !!user.isAdmin,
    highlightColor: user.highlightColor || HIGHLIGHT_COLORS[0].value,
  };
}
