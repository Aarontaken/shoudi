#!/usr/bin/env node
/**
 * 手递 · LOCAL DROP
 * 局域网里的文件投递站：电脑上跑一个进程，手机浏览器打开就是传输页。
 * 零依赖，Node 18+。
 *
 *   node server.mjs                 # 启动，默认 7788 端口
 *   node server.mjs --open          # 启动并打开浏览器
 *   node server.mjs --port 9000 --dir ~/Desktop/互传
 */

import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(ROOT, 'web');
const VERSION = '1.1.0';

/* ---------------------------------------------------------------- 参数 */

const argv = process.argv.slice(2);
const opt = {
  port: Number(process.env.SHOUDI_PORT || 7788),
  dir: process.env.SHOUDI_DIR || null,
  open: false,
};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const [key, inline] = a.includes('=') ? a.split(/=(.*)/s) : [a, undefined];
  const next = () => (inline !== undefined ? inline : argv[++i]);
  if (key === '--port' || key === '-p') opt.port = Number(next());
  else if (key === '--dir' || key === '-d') opt.dir = next();
  else if (key === '--open' || key === '-o') opt.open = true;
  else if (key === '--help' || key === '-h') opt.help = true;
}
if (opt.help) {
  console.log(`
  手递 · LOCAL DROP v${VERSION}

  用法: node server.mjs [选项]

    -p, --port <端口>   监听端口，默认 7788（也可用环境变量 SHOUDI_PORT）
    -d, --dir  <目录>   文件存放目录，默认 ~/Downloads/LocalDrop（SHOUDI_DIR）
    -o, --open          启动后自动打开浏览器
`);
  process.exit(0);
}

if (!Number.isInteger(opt.port) || opt.port < 1 || opt.port > 65535) {
  console.error('端口不合法:', opt.port);
  process.exit(1);
}

const STORE = path.resolve(opt.dir || path.join(os.homedir(), 'Downloads', 'LocalDrop'));

/** 显示用：把家目录缩成 ~ */
const prettyDir = (p) => {
  const home = os.homedir();
  return p === home ? '~' : p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p;
};

/* ---------------------------------------------------------------- 工具 */

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', b: '\x1b[1m', r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', 0: '\x1b[0m' }
  : { dim: '', b: '', r: '', g: '', y: '', 0: '' };

const pad = (n) => String(n).padStart(2, '0');

function lanIP() {
  const nets = os.networkInterfaces();
  const preferred = [];
  const fallback = [];
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const isPhysical = /^(en\d|eth|wl|wi-?fi|wlan|ethernet|以太网|本地连接)/i.test(name);
      const isVirtual = /^(utun|bridge|awdl|llw|docker|vbox|vmnet|veth|virtual|hyper-v|wsl|tun|tap|tailscale|zt|bluetooth)/i.test(name);
      if (isPhysical && !isVirtual) preferred.push(a.address);
      else if (!isVirtual) fallback.push(a.address);
    }
  }
  return preferred[0] || fallback[0] || '127.0.0.1';
}

const REAL_IP = lanIP();
const IP = process.env.SHOUDI_IP || REAL_IP;
const HOSTNAME = os.hostname().replace(/\.local$/i, '');
const DEVICE = process.env.SHOUDI_DEVICE || (() => {
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 800 }).trim();
      if (out) return out;
    } catch { /* ignore */ }
  }
  return HOSTNAME;
})();

/** 只接受盘符内的单纯文件名 */
const isSafeSegment = (name) =>
  !!name && name !== '.' && name !== '..' && name === path.basename(name) &&
  !name.includes('/') && !name.includes('\\') && !name.includes('\0');

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', avif: 'image/avif',
  ico: 'image/x-icon', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac',
  aac: 'audio/aac', ogg: 'audio/ogg', pdf: 'application/pdf', zip: 'application/zip',
  rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', gz: 'application/gzip',
  tar: 'application/x-tar', apk: 'application/vnd.android.package-archive',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  dmg: 'application/x-apple-diskimage', exe: 'application/x-msdownload',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};
const mimeOf = (name) => MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';

const fmtSize = (n) => {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' ' + u[i];
};

const json = (res, code, obj) => {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
};

const fail = (res, code, msg) => json(res, code, { error: msg });

/* ---------------------------------------------------------------- 状态 */

let files = [];          // [{ name, size, mtime }]
let clips = [];          // [{ id, text, at }]
const clients = new Map();   // SSE: res -> { host }
const CLIPS_FILE = path.join(STORE, '.clips.json');

async function loadClips() {
  try {
    const raw = JSON.parse(await fsp.readFile(CLIPS_FILE, 'utf8'));
    if (Array.isArray(raw)) {
      clips = raw.filter((c) => c && typeof c.text === 'string').slice(0, 20);
    }
  } catch { /* 第一次运行没有这个文件 */ }
}

const saveClips = () => fsp.writeFile(CLIPS_FILE, JSON.stringify(clips)).catch(() => {});

function broadcast(type, hostOnly = false) {
  const line = `data: ${JSON.stringify({ type, at: Date.now() })}\n\n`;
  for (const [res, meta] of clients) {
    if (hostOnly && !meta.host) continue;
    try { res.write(line); } catch { clients.delete(res); }
  }
}

/* ---------------------------------------------------------------- 授权 */

const LOCAL_IPS = (process.env.SHOUDI_LOCAL_IPS || '').split(',').map((x) => x.trim()).filter(Boolean);
const DEVICES_FILE = path.join(STORE, '.devices.json');
const devices = new Map();     // token -> { id, name, ip, ua, at, seen }
const pending = new Map();     // id -> { id, name, ip, ua, at, state, token, device }
let lastHostAlert = 0;

/** 这台电脑自己（本机回环 / 本机局域网 IP） */
function isHost(peer) {
  if (LOCAL_IPS.length) return LOCAL_IPS.includes(peer);
  return peer === '127.0.0.1' || peer === '::1' || peer === IP || peer === REAL_IP || peer.startsWith('127.');
}

const peerOf = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function deviceName(ua = '') {
  const system = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
      : /Android/.test(ua) ? 'Android'
        : /Macintosh/.test(ua) ? 'Mac'
          : /Windows/.test(ua) ? 'Windows'
            : /Linux/.test(ua) ? 'Linux' : '设备';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Chrome\//.test(ua) ? 'Chrome'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${system} · ${browser}` : system;
}

/** 谁在访问：本机 / 已授权设备 / 陌生人 */
function identify(req) {
  const peer = peerOf(req);
  if (isHost(peer)) return { peer, host: true, trusted: true, device: null };
  const token = parseCookies(req).shoudi;
  const device = token ? devices.get(token) : null;
  if (device) {
    device.seen = Date.now();
    return { peer, host: false, trusted: true, device };
  }
  return { peer, host: false, trusted: false, device: null };
}

async function loadDevices() {
  try {
    const raw = JSON.parse(await fsp.readFile(DEVICES_FILE, 'utf8'));
    if (Array.isArray(raw)) for (const d of raw) if (d && d.token) devices.set(d.token, d);
  } catch { /* 还没授权过任何设备 */ }
}

const saveDevices = () => fsp.writeFile(DEVICES_FILE, JSON.stringify([...devices.values()])).catch(() => {});

const cookieFor = (token) => `shoudi=${token}; Path=/; Max-Age=${180 * 24 * 3600}; HttpOnly; SameSite=Lax`;

const publicDevice = (d) => ({ id: d.id, name: d.name, ip: d.ip, at: d.at, seen: d.seen || d.at });

/** 有陌生设备想连进来，而电脑上的页面没开着 —— 帮忙把页面弹出来 */
function alertHost() {
  const hosts = [...clients.values()].filter((c) => c.host).length;
  if (hosts > 0) return;
  if (Date.now() - lastHostAlert < 60000) return;
  lastHostAlert = Date.now();
  openInShell(`http://127.0.0.1:${opt.port}/`, false);
}

async function scan() {
  const entries = await fsp.readdir(STORE, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('.')) continue;
    try {
      const st = await fsp.stat(path.join(STORE, e.name));
      out.push({ name: e.name, size: st.size, mtime: Math.round(st.mtimeMs) });
    } catch { /* 文件在扫描过程中被删掉 */ }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  files = out;
}

function safeName(raw) {
  let n = String(raw || '').normalize('NFC');
  n = n.split(/[\\/]/).pop() || '';
  n = n.replace(/[\u0000-\u001f\u007f]/g, '');
  n = n.replace(/[:*?"<>|]/g, '_');
  n = n.replace(/^[.\s]+/, '').replace(/\s+$/, '');
  if (!n) n = 'file-' + Date.now();
  if (n.length > 180) {
    const ext = path.extname(n).slice(0, 12);
    n = n.slice(0, 168) + ext;
  }
  return n;
}

const filePath = (name) => path.join(STORE, path.basename(name));

async function uniquePath(name) {
  let candidate = name;
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  for (let i = 2; i < 9999; i++) {
    try {
      await fsp.access(filePath(candidate));
      candidate = `${base} (${i})${ext}`;
    } catch { return filePath(candidate); }
  }
  return filePath(`${base}-${Date.now()}${ext}`);
}

/* ---------------------------------------------------------------- 响应 */

function serveStatic(res, file, type) {
  let st;
  try { st = statSync(file); } catch { return fail(res, 404, 'not found'); }
  res.writeHead(200, {
    'Content-Type': MIME[type] || mimeOf(file),
    'Content-Length': st.size,
    'Cache-Control': 'no-store',
  });
  const rs = createReadStream(file);
  rs.on('error', () => res.destroy());
  rs.pipe(res);
}

function contentDisposition(name, inline) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function serveDownload(req, res, name, inline) {
  const p = filePath(name);
  let st;
  try { st = statSync(p); } catch { return fail(res, 404, '文件不见了'); }
  if (!st.isFile()) return fail(res, 404, 'not a file');

  const total = st.size;
  const headers = {
    'Content-Type': mimeOf(name),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'Content-Disposition': contentDisposition(name, inline),
  };
  const range = req.headers.range;
  let start = 0;
  let end = total - 1;
  let partial = false;

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      if (m[1]) { start = Number(m[1]); end = m[2] ? Number(m[2]) : total - 1; }
      else if (m[2]) { start = Math.max(0, total - Number(m[2])); }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        return res.end();
      }
      end = Math.min(end, total - 1);
      partial = true;
    }
  }

  res.writeHead(partial ? 206 : 200, {
    ...headers,
    'Content-Length': end - start + 1,
    ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}),
  });
  if (req.method === 'HEAD' || total === 0) return res.end();
  const rs = createReadStream(p, { start, end });
  rs.on('error', () => res.destroy());
  rs.pipe(res);
}

async function readBody(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function openInShell(target, reveal) {
  if (process.platform === 'darwin') {
    spawn('open', reveal ? ['-R', target] : [target], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'win32') {
    const opts = { detached: true, stdio: 'ignore', windowsHide: true };
    if (reveal) spawn('explorer', [`/select,${target}`], opts).unref();
    else if (/^https?:/i.test(target)) spawn('cmd', ['/c', 'start', '', target], opts).unref();
    else spawn('explorer', [target], opts).unref();
  } else {
    spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
  }
}

/* ---------------------------------------------------------------- 路由 */

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'local'}`);
  const p = decodeURIComponent(url.pathname);
  const method = req.method || 'GET';
  const who = identify(req);

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,PUT,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Filename',
    });
    return res.end();
  }

  /* --- 页面 --- */
  if (method === 'GET' || method === 'HEAD') {
    if (p === '/' || p === '/index.html') return serveStatic(res, path.join(WEB, 'index.html'), 'html');
    if (p === '/style.css') return serveStatic(res, path.join(WEB, 'style.css'), 'css');
    if (p === '/app.js') return serveStatic(res, path.join(WEB, 'app.js'), 'js');
    if (p === '/qrcode.js') return serveStatic(res, path.join(WEB, 'qrcode.js'), 'js');
    if (p === '/manifest.webmanifest') return serveStatic(res, path.join(WEB, 'manifest.webmanifest'), 'webmanifest');
    if (p === '/icon.svg') return serveStatic(res, path.join(WEB, 'icon.svg'), 'svg');
    if (p === '/icon-192.png') return serveStatic(res, path.join(WEB, 'icon-192.png'), 'png');
    if (p === '/icon-512.png') return serveStatic(res, path.join(WEB, 'icon-512.png'), 'png');
  }

  /* --- 不用授权就能访问的：看状态、请求配对 --- */
  if (p === '/api/session' && method === 'GET') {
    const mine = [...pending.values()]
      .filter((x) => x.ip === who.peer && x.state === 'pending')
      .sort((a, b) => b.at - a.at)[0];
    return json(res, 200, {
      host: who.host,
      trusted: who.trusted,
      device: who.device ? { id: who.device.id, name: who.device.name } : null,
      pending: mine ? { id: mine.id, name: mine.name, ip: mine.ip, at: mine.at } : null,
    });
  }

  if (p === '/api/pair' && method === 'POST') {
    if (who.trusted) return json(res, 200, { trusted: true });
    const ua = String(req.headers['user-agent'] || '');
    const name = deviceName(ua);
    let item = [...pending.values()].find((x) => x.ip === who.peer && x.ua === ua && x.state === 'pending');
    if (item) {
      item.at = Date.now();
    } else {
      const active = [...pending.values()].filter((x) => x.state === 'pending').length;
      if (active >= 8) return fail(res, 429, '请求太多了，等会儿再试');
      item = {
        id: crypto.randomBytes(4).toString('hex'),
        name, ip: who.peer, ua,
        at: Date.now(), state: 'pending', token: null, device: null,
      };
      pending.set(item.id, item);
      console.log(`${C.y}?${C[0]} ${C.b}${name}${C[0]} ${C.dim}(${who.peer})${C[0]} 请求连接`);
      broadcast('pending', true);
      alertHost();
    }
    return json(res, 200, { id: item.id, name: item.name });
  }

  if (p.startsWith('/api/pair/') && method === 'GET') {
    const item = pending.get(p.slice('/api/pair/'.length));
    if (!item || item.ip !== who.peer) return json(res, 200, { state: 'expired' });
    if (item.state === 'allowed' && item.device) {
      const body = Buffer.from(JSON.stringify({ trusted: true, device: publicDevice(item.device) }));
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'Set-Cookie': cookieFor(item.token),
      });
      return res.end(body);
    }
    return json(res, 200, { state: item.state });
  }

  /* --- 以下所有接口都要先配对 --- */
  if (!who.trusted) {
    return json(res, 401, { error: 'unauthorized', needPair: true });
  }

  /* --- 接口 --- */
  if (p === '/api/state' && method === 'GET') {
    return json(res, 200, {
      files,
      clips,
      host: who.host,
      local: who.host,
      info: { host: DEVICE, ip: IP, port: opt.port, dir: prettyDir(STORE), platform: process.platform, version: VERSION },
      now: Date.now(),
    });
  }

  if (p === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 2000\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
    clients.set(res, { host: who.host });
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* ignore */ }
    }, 15000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (p === '/api/pending' && method === 'GET') {
    if (!who.host) return fail(res, 403, '只有这台电脑能看');
    const list = [...pending.values()].filter((x) => x.state === 'pending').sort((a, b) => a.at - b.at);
    return json(res, 200, { pending: list.map((x) => ({ id: x.id, name: x.name, ip: x.ip, at: x.at })) });
  }

  if (p.startsWith('/api/pending/') && method === 'POST') {
    if (!who.host) return fail(res, 403, '只有这台电脑能确认');
    const item = pending.get(p.slice('/api/pending/'.length));
    if (!item || item.state !== 'pending') return fail(res, 404, '这个请求已经过期了');
    let allow = true;
    try { allow = !!(JSON.parse((await readBody(req, 4096)) || '{}').allow); } catch { /* 默认允许 */ }
    if (allow) {
      item.state = 'allowed';
      item.token = crypto.randomBytes(24).toString('hex');
      item.device = {
        id: crypto.randomBytes(4).toString('hex'), token: item.token,
        name: item.name, ip: item.ip, ua: item.ua, at: Date.now(), seen: Date.now(),
      };
      devices.set(item.token, item.device);
      saveDevices();
      console.log(`${C.g}✓${C[0]} 允许 ${C.b}${item.name}${C[0]} ${C.dim}(${item.ip})${C[0]}`);
      broadcast('devices', true);
    } else {
      item.state = 'denied';
      console.log(`${C.r}✕${C[0]} 拒绝 ${item.name} ${C.dim}(${item.ip})${C[0]}`);
    }
    broadcast('pending', true);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/devices' && method === 'GET') {
    if (!who.host) return fail(res, 403, '只有这台电脑能看');
    return json(res, 200, { devices: [...devices.values()].map(publicDevice) });
  }

  if (p.startsWith('/api/devices/') && method === 'DELETE') {
    if (!who.host) return fail(res, 403, '只有这台电脑能撤销');
    const id = p.slice('/api/devices/'.length);
    let removed = null;
    for (const [token, d] of devices) {
      if (d.id === id) { removed = d; devices.delete(token); }
    }
    if (removed) {
      saveDevices();
      broadcast('devices', true);
      console.log(`${C.r}×${C[0]} 撤销 ${removed.name} ${C.dim}(${removed.ip})${C[0]}`);
    }
    return json(res, 200, { ok: true });
  }

  if (p === '/api/upload' && (method === 'POST' || method === 'PUT')) {
    const raw = req.headers['x-filename'] || url.searchParams.get('name') || `file-${Date.now()}`;
    let name;
    try { name = safeName(decodeURIComponent(String(raw))); } catch { name = safeName(String(raw)); }
    const dest = await uniquePath(name);
    const tmp = path.join(STORE, `.${path.basename(dest)}.part`);
    let bytes = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) { bytes += chunk.length; cb(null, chunk); },
    });
    try {
      await pipeline(req, counter, createWriteStream(tmp));
      if (bytes === 0) {
        await fsp.unlink(tmp).catch(() => {});
        return fail(res, 400, '空文件');
      }
      await fsp.rename(tmp, dest);
    } catch (err) {
      await fsp.unlink(tmp).catch(() => {});
      if (!res.headersSent) fail(res, 500, '上传中断');
      return;
    }
    await scan();
    broadcast('files');
    const finalName = path.basename(dest);
    const from = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    console.log(`${C.g}↑${C[0]} 收到 ${C.b}${finalName}${C[0]}  ${fmtSize(bytes)}  ${C.dim}${from}${C[0]}`);
    return json(res, 200, { name: finalName, size: bytes });
  }

  if (p.startsWith('/f/')) {
    const name = p.slice(3);
    if (!isSafeSegment(name)) return fail(res, 400, 'bad name');
    return serveDownload(req, res, name, url.searchParams.get('view') === '1');
  }

  if (p.startsWith('/api/files/') && method === 'DELETE') {
    if (!who.host) return fail(res, 403, '只能在电脑上删');
    const name = p.slice('/api/files/'.length);
    if (!isSafeSegment(name)) return fail(res, 400, 'bad name');
    await fsp.unlink(filePath(name)).catch(() => {});
    await scan();
    broadcast('files');
    console.log(`${C.r}×${C[0]} 删除 ${C.dim}${name}${C[0]}`);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/clips' && method === 'POST') {
    let data;
    try { data = JSON.parse(await readBody(req, 256 * 1024)); } catch { return fail(res, 400, '请求体不合法'); }
    const text = String(data.text || '').slice(0, 10000).trim();
    if (!text) return fail(res, 400, '内容为空');
    if (!clips.length || clips[0].text !== text) {
      clips.unshift({ id: crypto.randomBytes(4).toString('hex'), text, at: Date.now() });
      clips = clips.slice(0, 20);
      saveClips();
      broadcast('clips');
    }
    return json(res, 200, { ok: true });
  }

  if (p.startsWith('/api/clips/') && method === 'DELETE') {
    const id = p.slice('/api/clips/'.length);
    clips = clips.filter((c) => c.id !== id);
    saveClips();
    broadcast('clips');
    return json(res, 200, { ok: true });
  }

  if (p === '/api/reveal' && method === 'POST') {
    if (!who.host) return fail(res, 403, '只能在电脑上打开');
    let name = '';
    try { name = String((JSON.parse(await readBody(req, 4096)) || {}).name || ''); } catch { /* ignore */ }
    if (name && name === path.basename(name)) {
      const target = filePath(name);
      try { statSync(target); openInShell(target, true); return json(res, 200, { ok: true }); } catch { /* fallthrough */ }
    }
    openInShell(STORE, false);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/quit' && method === 'POST') {
    if (!who.host) return fail(res, 403, '只能在电脑上关');
    json(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 120);
    return;
  }

  return fail(res, 404, 'not found');
}

/* ---------------------------------------------------------------- 启动 */

const server = http.createServer({ requestTimeout: 0, headersTimeout: 60000 }, (req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) fail(res, 500, '服务器内部错误');
    else res.destroy();
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const url = `http://127.0.0.1:${opt.port}/`;
    http.get(`${url}api/state`, (r) => {
      r.resume();
      console.log(`${C.y}手递已经在运行了${C[0]}  ${C.b}${url}${C[0]}`);
      if (opt.open) openInShell(url, false);
      setTimeout(() => process.exit(0), 100);
    }).on('error', () => {
      console.error(`${C.r}端口 ${opt.port} 被别的程序占用了${C[0]}，换个端口：node server.mjs --port 8080`);
      process.exit(1);
    });
    return;
  }
  console.error(err);
  process.exit(1);
});

await fsp.mkdir(STORE, { recursive: true }).catch((err) => {
  console.error(`${C.r}无法创建存放目录${C[0]} ${STORE}\n${err.message}`);
  process.exit(1);
});
await scan();
await loadClips();
await loadDevices();

setInterval(() => {
  const now = Date.now();
  for (const [id, item] of pending) {
    if (item.state === 'pending' && now - item.at > 120000) item.state = 'expired';
    else if (item.state !== 'pending' && now - item.at > 300000) pending.delete(id);
  }
}, 15000).unref();

server.listen(opt.port, '0.0.0.0', () => {
  const url = `http://${IP}:${opt.port}`;
  const local = `http://127.0.0.1:${opt.port}`;
  const line = '─'.repeat(46);

  console.log(`
  ${C.r}${C.b}手递${C[0]} ${C.dim}LOCAL DROP${C[0]}  ${C.dim}v${VERSION}${C[0]}
  ${C.dim}${line}${C[0]}
  手机打开   ${C.b}${C.g}${url}${C[0]}   ${C.dim}(扫码也行，页面上有二维码)${C[0]}
  本机打开   ${C.dim}${local}${C[0]}
  存放目录   ${C.dim}${STORE}${C[0]}
  ${C.dim}${line}${C[0]}
  ${C.dim}两台设备连同一个 Wi-Fi，按 Ctrl+C 停止${C[0]}
`);

  if (opt.open) openInShell(local, false);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n  ${C.dim}收摊了，文件还在 ${STORE}${C[0]}\n`);
    process.exit(0);
  });
}

process.on('uncaughtException', (err) => console.error('uncaught:', err));
process.on('unhandledRejection', (err) => console.error('unhandled:', err));
