/**
 * 把一组 PNG 拼成 Windows 的 .ico
 * 用法：node make-ico.mjs <png 目录> <输出.ico>
 * 目录里需要有 icon-16.png / icon-32.png / icon-48.png / icon-64.png / icon-128.png / icon-256.png
 *
 * 用 PNG 载荷（Vista 之后都支持），比 BMP 省事也清晰。
 */

import fs from 'node:fs';
import path from 'node:path';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error('usage: node make-ico.mjs <png-dir> <out.ico>');
  process.exit(1);
}

const sizes = [16, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => {
  const file = path.join(dir, `icon-${s}.png`);
  if (!fs.existsSync(file)) throw new Error(`缺少 ${file}`);
  return { s, data: fs.readFileSync(file) };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = icon
header.writeUInt16LE(pngs.length, 4);

let offset = 6 + 16 * pngs.length;
const entries = pngs.map(({ s, data }) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s >= 256 ? 0 : s, 0);
  e.writeUInt8(s >= 256 ? 0 : s, 1);
  e.writeUInt8(0, 2); // palette count
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // color planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});

fs.writeFileSync(out, Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]));
console.log(`ico ${out} → ${sizes.join(' / ')} px, ${offset} bytes`);
