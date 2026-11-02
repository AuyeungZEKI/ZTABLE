'use strict';
// 图标/缩略图提取
//  - 图片：直接解码（宽高比正确、按 EXIF 方向摆正），长图/全景图按「顶部裁切」生成可用缩略图
//  - 其他文件：系统 Jumbo/ExtraLarge 图标（256/48px），保留透明通道
const { nativeImage, app } = require('electron');
const fs = require('fs');
const w = require('./win32');
const koffi = w.koffi;

const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');
const shell32 = koffi.load('shell32.dll');

const GUID = koffi.struct('ZT_GUID', { Data1: 'uint32', Data2: 'uint16', Data3: 'uint16', Data4: 'uint8[8]' });
const SHFILEINFOW = koffi.struct('ZT_SHFILEINFOW', {
  hIcon: 'void *', iIcon: 'int32', dwAttributes: 'uint32',
  szDisplayName: 'char16_t[260]', szTypeName: 'char16_t[80]'
});
const IL_GetIcon = koffi.proto('int32 __stdcall ZT_IL_GetIcon(void *self, int i, uint32 flags, _Out_ void **picon)');

const f = {
  SHGetImageList: shell32.func('int32 __stdcall SHGetImageList(int iImageList, ZT_GUID *riid, _Out_ void **ppv)'),
  SHGetFileInfoW: shell32.func('uintptr_t __stdcall SHGetFileInfoW(str16 path, uint32 attrs, _Inout_ ZT_SHFILEINFOW *psfi, uint32 cb, uint32 flags)'),
  GetDC: user32.func('void * __stdcall GetDC(void *hwnd)'),
  ReleaseDC: user32.func('int __stdcall ReleaseDC(void *hwnd, void *hdc)'),
  DrawIconEx: user32.func('int __stdcall DrawIconEx(void *hdc, int x, int y, void *hIcon, int cx, int cy, uint32 step, void *brush, uint32 flags)'),
  DestroyIcon: user32.func('int __stdcall DestroyIcon(void *hIcon)'),
  CreateCompatibleDC: gdi32.func('void * __stdcall CreateCompatibleDC(void *hdc)'),
  CreateDIBSection: gdi32.func('void * __stdcall CreateDIBSection(void *hdc, void *bmi, uint32 usage, _Out_ void **bits, void *section, uint32 offset)'),
  SelectObject: gdi32.func('void * __stdcall SelectObject(void *hdc, void *obj)'),
  DeleteObject: gdi32.func('int __stdcall DeleteObject(void *obj)'),
  DeleteDC: gdi32.func('int __stdcall DeleteDC(void *hdc)'),
  GetDIBits: gdi32.func('int __stdcall GetDIBits(void *hdc, void *hbm, uint32 start, uint32 lines, void *bits, void *bmi, uint32 usage)')
};

const IID_IImageList = { Data1: 0x46EB5926, Data2: 0x582E, Data3: 0x4017, Data4: [0x9F, 0xDF, 0xE8, 0x99, 0x8D, 0xAA, 0x09, 0x50] };
const lists = {};
function imageList(kind) { // 2 = SHIL_EXTRALARGE(48), 4 = SHIL_JUMBO(256)
  if (lists[kind] !== undefined) return lists[kind];
  lists[kind] = null;
  try {
    const out = [null];
    if (f.SHGetImageList(kind, IID_IImageList, out) === 0 && out[0]) lists[kind] = out[0];
  } catch (e) { }
  return lists[kind];
}
function sysIconIndex(p) {
  const info = { hIcon: null, iIcon: 0, dwAttributes: 0, szDisplayName: '', szTypeName: '' };
  if (!f.SHGetFileInfoW(p, 0, info, koffi.sizeof(SHFILEINFOW), 0x4000 /* SHGFI_SYSICONINDEX */)) return -1;
  return info.iIcon;
}
function bmiHeader(size) {
  const bmi = Buffer.alloc(44);
  bmi.writeUInt32LE(40, 0); bmi.writeInt32LE(size, 4); bmi.writeInt32LE(-size, 8);
  bmi.writeUInt16LE(1, 12); bmi.writeUInt16LE(32, 14);
  return bmi;
}
function renderIcon(hicon, size) {
  const screen = f.GetDC(null);
  const hdc = f.CreateCompatibleDC(screen);
  const bits = [null];
  const hbm = f.CreateDIBSection(hdc, bmiHeader(size), 0, bits, null, 0);
  const old = f.SelectObject(hdc, hbm);
  f.DrawIconEx(hdc, 0, 0, hicon, size, size, 0, null, 0x0003);
  f.SelectObject(hdc, old);
  const buf = Buffer.alloc(size * size * 4);
  f.GetDIBits(hdc, hbm, 0, size, buf, bmiHeader(size), 0);
  f.DeleteObject(hbm);
  f.DeleteDC(hdc);
  f.ReleaseDC(null, screen);
  let anyAlpha = false, anyColor = false;
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i + 3]) { anyAlpha = true; break; }
    if (buf[i] || buf[i + 1] || buf[i + 2]) anyColor = true;
  }
  if (!anyAlpha && anyColor) for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
  return buf;
}
function contentExtent(buf, size) {
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (buf[(y * size + x) * 4 + 3] > 8) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return 0;
  return Math.max(maxX - minX + 1, maxY - minY + 1);
}
function iconFromList(kind, idx, size) {
  const list = imageList(kind);
  if (!list || idx < 0) return null;
  const vtbl = koffi.decode(list, 'void *');
  const fn = koffi.decode(vtbl, 10 * 8, 'void *'); // IImageList::GetIcon
  const out = [null];
  if (koffi.call(fn, IL_GetIcon, list, idx, 0x1, out) !== 0 || !out[0]) return null;
  try { return renderIcon(out[0], size); } finally { try { f.DestroyIcon(out[0]); } catch (e) { } }
}
function systemIcon(p) {
  const idx = sysIconIndex(p);
  if (idx < 0) return null;
  let buf = iconFromList(4, idx, 256);
  if (buf && contentExtent(buf, 256) > 100) return nativeImage.createFromBitmap(buf, { width: 256, height: 256 }).resize({ width: 128, height: 128, quality: 'best' });
  buf = iconFromList(2, idx, 48);
  if (buf) return nativeImage.createFromBitmap(buf, { width: 48, height: 48 });
  return null;
}

// ============ 图片：方向 + 智能缩略图 ============
const MAX_PIXELS = 60e6;

function exifOrientation(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (n < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return 1;
    let off = 2;
    while (off + 4 < n) {
      if (buf[off] !== 0xFF) { off++; continue; }
      const marker = buf[off + 1];
      const len = buf.readUInt16BE(off + 2);
      if (marker === 0xE1 && buf.toString('ascii', off + 4, off + 8) === 'Exif') {
        const tiff = off + 10;
        const be = buf.toString('ascii', tiff, tiff + 2) === 'MM';
        const r16 = (o) => be ? buf.readUInt16BE(o) : buf.readUInt16LE(o);
        const r32 = (o) => be ? buf.readUInt32BE(o) : buf.readUInt32LE(o);
        const ifd = tiff + r32(tiff + 4);
        const count = r16(ifd);
        for (let i = 0; i < count; i++) {
          const e = ifd + 2 + i * 12;
          if (r16(e) === 0x0112) return r16(e + 8);
        }
        return 1;
      }
      if (marker === 0xDA) break;
      off += 2 + len;
    }
  } catch (e) { } finally { try { fs.closeSync(fd); } catch (e) { } }
  return 1;
}

function rotateBitmap(bmp, w0, h0, orient) {
  if (![3, 6, 8].includes(orient)) return null;
  const swap = orient !== 3;
  const w1 = swap ? h0 : w0, h1 = swap ? w0 : h0;
  const src = Buffer.from(bmp);
  const out = Buffer.alloc(src.length);
  for (let y = 0; y < h0; y++) {
    for (let x = 0; x < w0; x++) {
      const s = (y * w0 + x) * 4;
      let dx, dy;
      if (orient === 3) { dx = w0 - 1 - x; dy = h0 - 1 - y; }
      else if (orient === 6) { dx = h0 - 1 - y; dy = x; }
      else { dx = y; dy = w0 - 1 - x; }
      const d = (dy * w1 + dx) * 4;
      out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = src[s + 3];
    }
  }
  return { img: nativeImage.createFromBitmap(out, { width: w1, height: h1 }), w: w1, h: h1 };
}

// 极端长宽比时在「显示方向」上取顶部（长图）或左侧偏中（全景）一块，避免缩成细线
function cropRect(dw, dh, maxRatio) {
  const ratio = Math.max(dw / dh, dh / dw);
  if (ratio <= maxRatio) return null;
  if (dh > dw) return { x: 0, y: 0, width: dw, height: Math.max(1, Math.round(dw * maxRatio)) };
  const cw = Math.max(1, Math.round(dh * maxRatio));
  return { x: Math.round((dw - cw) * 0.42), y: 0, width: cw, height: dh };
}
// 显示坐标系的矩形 -> 原始存储坐标（EXIF 方向 3/6/8）
function toStored(r, w0, h0, o) {
  if (o === 3) return { x: w0 - r.x - r.width, y: h0 - r.y - r.height, width: r.width, height: r.height };
  if (o === 6) return { x: r.y, y: h0 - r.x - r.width, width: r.height, height: r.width };
  if (o === 8) return { x: w0 - r.y - r.height, y: r.x, width: r.height, height: r.width };
  return r;
}
function smartCrop(img, maxRatio) {
  const s = img.getSize();
  if (!s.width || !s.height) return img;
  const r = cropRect(s.width, s.height, maxRatio);
  return r ? img.crop(r) : img;
}
function fitBox(img, box) {
  const s = img.getSize();
  const k = box / Math.max(s.width, s.height);
  if (k >= 1) return img;
  return img.resize({ width: Math.max(1, Math.round(s.width * k)), height: Math.max(1, Math.round(s.height * k)), quality: 'good' });
}

const THUMB_BOX = 192;
const MAX_RATIO = 1.55;
const LONG_BADGE_RATIO = 2.2;   // 超过 1:2.2 才标记为「长图」，普通竖拍照片(9:16)不标
const isLong = (w, h) => Math.max(w / h, h / w) > LONG_BADGE_RATIO;
const NATIVE_EXT = new Set(['jpg', 'jpeg', 'png', 'bmp']);
const SHELL_THUMB_EXT = new Set(['webp', 'gif', 'ico', 'tif', 'tiff', 'heic', 'jfif', 'svg', 'mp4', 'mov', 'mkv', 'avi', 'webm', 'psd']);

function directImage(file) {
  const ext = (file.split('.').pop() || '').toLowerCase();
  if (!NATIVE_EXT.has(ext)) return null;
  let st;
  try { st = fs.statSync(file); } catch (e) { return null; }
  if (!st.size || st.size > 120 * 1024 * 1024) return null;
  let img;
  try { img = nativeImage.createFromPath(file); } catch (e) { return null; }
  if (!img || img.isEmpty()) return null;
  const s = img.getSize();
  if (s.width * s.height > MAX_PIXELS) return null;
  let o = (ext === 'jpg' || ext === 'jpeg') ? exifOrientation(file) : 1;
  if (![3, 6, 8].includes(o)) o = 1;
  const swap = o === 6 || o === 8;
  const dw = swap ? s.height : s.width, dh = swap ? s.width : s.height;
  const r = cropRect(dw, dh, MAX_RATIO);
  if (r) img = img.crop(toStored(r, s.width, s.height, o));   // 1) 原图上裁切
  img = fitBox(img, THUMB_BOX);                                // 2) 缩放
  if (o !== 1) {                                               // 3) 小图上旋转
    try {
      const z = img.getSize();
      const rot = rotateBitmap(img.toBitmap(), z.width, z.height, o);
      if (rot) img = rot.img;
    } catch (e) { }
  }
  return { img, long: isLong(dw, dh) };
}

async function shellThumb(file) {
  try {
    // 请求较大的盒子，长图裁切后仍有足够分辨率
    const t = await nativeImage.createThumbnailFromPath(file, { width: 1024, height: 1024 });
    if (!t || t.isEmpty()) return null;
    const z = t.getSize();
    const long = isLong(z.width, z.height);
    return { img: fitBox(smartCrop(t, MAX_RATIO), THUMB_BOX), long };
  } catch (e) { return null; }
}

const cache = new Map();   // path -> { url, kind, w, h } | null
async function getIcon(p) {
  const key = p.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const ext = (p.split('.').pop() || '').toLowerCase();
  let img = null, kind = 'icon', long = false;
  if (NATIVE_EXT.has(ext) || SHELL_THUMB_EXT.has(ext)) {
    const d = directImage(p);
    if (d) { img = d.img; long = d.long; }
    else { const r = await shellThumb(p); if (r) { img = r.img; long = r.long; } }
    if (img) kind = 'thumb';
  }
  if (!img) { try { img = systemIcon(p); } catch (e) { img = null; } }
  if (!img) { try { img = await app.getFileIcon(p, { size: 'large' }); } catch (e) { } }
  let res = null;
  if (img && !img.isEmpty()) {
    const s = img.getSize();
    res = { url: img.toDataURL(), kind, long, w: s.width, h: s.height };
  }
  if (cache.size > 1200) cache.clear();
  cache.set(key, res);
  return res;
}

// 拖拽反馈用的 48px 小图（同步，避免拖拽启动时等待）
function microIcon(p) {
  const hit = cache.get(String(p).toLowerCase());
  if (hit && hit.url) { try { return nativeImage.createFromDataURL(hit.url).resize({ width: 48, height: 48 }); } catch (e) { } }
  try { const i = systemIcon(p); if (i) return i.resize({ width: 48, height: 48 }); } catch (e) { }
  return null;
}

function invalidate(p) { if (p) cache.delete(p.toLowerCase()); else cache.clear(); }

module.exports = { getIcon, microIcon, invalidate, systemIcon };
