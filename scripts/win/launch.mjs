/**
 * 手递 · 桌面启动器
 *
 *   1. 服务没跑就先在后台拉起来（无窗口）
 *   2. 打开浏览器
 *   3. 把拖到图标上的文件投递出去
 *
 * 由 start.vbs 调起（wscript 隐藏窗口运行 node.exe）。
 */

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createReadStream, statSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SHOUDI_PORT || 7788);
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.tmpdir(), 'shoudi-server.log');
const files = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function probe() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/api/state`, { timeout: 900 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function openBrowser() {
  const url = `${BASE}/`;
  const opts = { detached: true, stdio: 'ignore', windowsHide: true };
  let child;
  if (process.platform === 'win32') child = spawn('cmd', ['/c', 'start', '', url], opts);
  else if (process.platform === 'darwin') child = spawn('open', [url], opts);
  else child = spawn('xdg-open', [url], opts);
  child.on('error', () => {});
  child.unref();
}

function notify(title, msg) {
  if (process.platform === 'win32') {
    const safe = (s) => String(s).replace(/'/g, "''");
    const ps = "Add-Type -AssemblyName PresentationFramework;" +
      `[System.Windows.MessageBox]::Show('${safe(msg)}','${safe(title)}')`;
    spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else {
    console.error(`[${title}] ${msg}`);
  }
}

function upload(file) {
  return new Promise((resolve) => {
    let size;
    try {
      size = statSync(file).size;
      if (!statSync(file).isFile()) return resolve(true);
    } catch {
      return resolve(true);
    }
    const req = http.request(`${BASE}/api/upload`, {
      method: 'POST',
      headers: {
        'X-Filename': encodeURIComponent(path.basename(file)),
        'Content-Type': 'application/octet-stream',
        'Content-Length': size,
      },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
      res.on('error', () => resolve(false));
    });
    req.on('error', () => resolve(false));
    createReadStream(file).on('error', () => resolve(false)).pipe(req);
  });
}

async function main() {
  if (!(await probe())) {
    const log = openSync(LOG, 'a');
    const child = spawn(process.execPath, [path.join(HERE, 'server.mjs')], {
      detached: true,
      stdio: ['ignore', log, log],
      windowsHide: true,
      cwd: HERE,
    });
    child.on('error', () => {});
    child.unref();

    let ok = false;
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if (await probe()) { ok = true; break; }
    }
    if (!ok) {
      notify('手递没能启动', `端口 ${PORT} 可能被占用了。\n日志：${LOG}`);
      process.exit(1);
    }
  }

  openBrowser();

  if (files.length) {
    let failed = 0;
    for (const f of files) {
      if (!(await upload(f))) failed++;
    }
    if (failed) notify('有文件没投出去', `${failed} 个文件上传失败。\n日志：${LOG}`);
  }
}

main().catch((err) => {
  notify('手递出错了', String(err && err.message ? err.message : err));
  process.exit(1);
});
