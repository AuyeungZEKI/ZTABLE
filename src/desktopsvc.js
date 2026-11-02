'use strict';
// 桌面/下载目录服务：隐藏原图标、规则归类、目录监视
const fs = require('fs');
const path = require('path');
const w = require('./win32');

// 用系统已知文件夹解析（兼容 OneDrive「备份桌面」与组策略重定向的桌面路径）
function userDesktop() { try { return require('electron').app.getPath('desktop'); } catch (e) { return path.join(require('os').homedir(), 'Desktop'); } }
function publicDesktop() { return path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'); }
function downloadsDir() { return require('electron').app.getPath('downloads'); }

function desktopDirs() {
  const out = [];
  for (const d of [userDesktop(), publicDesktop()]) {
    try { if (fs.existsSync(d)) out.push(d); } catch (e) { }
  }
  return out;
}

const SYS_NAMES = new Set(['desktop.ini', 'thumbs.db', '$recycle.bin', 'iconcache.db']);
function isSystemName(name) {
  const l = name.toLowerCase();
  return SYS_NAMES.has(l) || l.startsWith('~$') || l.startsWith('.');
}

function readEntries(dir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return out; }
  for (const name of names) {
    if (isSystemName(name)) continue;
    const full = path.join(dir, name);
    let st = null;
    try { st = fs.statSync(full); } catch (e) { continue; }
    const isDir = st.isDirectory();
    out.push({
      name, path: full, isDir,
      ext: isDir ? '' : (path.extname(name).slice(1).toLowerCase()),
      mtime: st.mtimeMs, size: isDir ? 0 : st.size,
      desktop: isDesktopPath(full)
    });
  }
  return out;
}

function isDesktopDir(dir) {
  return desktopDirs().some(d => path.resolve(d).toLowerCase() === path.resolve(dir).toLowerCase());
}

function isDesktopPath(p) {
  const dir = path.dirname(path.resolve(p));
  return isDesktopDir(dir);
}

// ===== 隐藏属性管理（收纳到围栏后隐藏桌面原图标） =====
// 设计原则：任何时刻 ZTABLE 退出/崩溃，桌面图标都必须能回来。
//  1. 每次改动立即同步写入日志文件 hidden.json（不依赖配置的延迟保存）
//  2. 正常退出：before-quit / will-quit 还原
//  3. 崩溃/被结束进程：钩子子进程作为看门狗，检测到主进程断开后按日志还原
//  4. 下次启动 / 卸载（--restore）：再按日志兜底还原
let hiddenList = null;     // 引用 store.data.hidden（保存原始大小写路径）
let journalFile = null;
let iconsHiddenFlag = false;
let stowedList = [];       // [{ path, origin, originDir }] 当前收纳在 ZTABLE 收纳文件夹中的桌面项目
let parkedList = [];       // [{ path, x, y }] inPlace 模式下被停放到可视区外的桌面图标及其原始坐标
let returnOnCrash = true;

function journalPath() { return journalFile; }
function writeJournal() {
  if (!journalFile) return;
  try {
    const tmp = journalFile + '.tmp';
    const prev = readJournal();
    fs.writeFileSync(tmp, JSON.stringify({ paths: hiddenList || [], iconsHidden: iconsHiddenFlag, stowed: returnOnCrash ? stowedList : [], parked: returnOnCrash ? parkedList : [], returned: (prev && prev.returned) || [], pid: process.pid, at: Date.now() }));
    fs.renameSync(tmp, journalFile);
  } catch (e) { }
}
function readJournal() {
  try { return JSON.parse(fs.readFileSync(journalFile, 'utf8')); } catch (e) { return null; }
}
function setIconsHidden(v) { iconsHiddenFlag = !!v; writeJournal(); }
// 由主进程在每次保存配置时调用
function setStowed(config) {
  const list = [];
  for (const f of config.fences) {
    if (f.type !== 'normal') continue;
    for (const it of f.items) if (it.origin && it.path && !isDesktopPath(it.path) && fs.existsSync(it.path)) list.push({ path: it.path, origin: it.origin, originDir: it.originDir || path.dirname(it.origin) });
  }
  stowedList = list;
  returnOnCrash = config.general.returnOnQuit !== false;
  writeJournal();
}
// 由主进程维护：当前被停放隐藏的桌面图标及其还原坐标（供看门狗在崩溃时还原）
function setParked(list) { parkedList = Array.isArray(list) ? list : []; writeJournal(); }
// 看门狗放回桌面后留下的 { from, to } 记录，启动时用来修正配置里的路径
function takeReturnedMap() {
  const j = readJournal();
  const m = (j && Array.isArray(j.returned)) ? j.returned : [];
  if (m.length && j) { j.returned = []; try { fs.writeFileSync(journalFile, JSON.stringify(j)); } catch (e) { } }
  return m;
}
function journalIconsHidden() { const j = readJournal(); return !!(j && j.iconsHidden) || iconsHiddenFlag; }

function setCtx(store) {
  hiddenList = store.data.hidden;
  journalFile = path.join(store.dir, 'hidden.json');
  // 合并上次未来得及写进配置的记录
  const j = readJournal();
  if (j && Array.isArray(j.paths)) {
    const have = new Set(hiddenList.map(x => x.toLowerCase()));
    for (const p of j.paths) if (p && !have.has(p.toLowerCase())) { hiddenList.push(p); have.add(p.toLowerCase()); }
    iconsHiddenFlag = !!j.iconsHidden;
  }
}

function inList(p) { return hiddenList.findIndex(x => x.toLowerCase() === p.toLowerCase()); }

function hideOriginal(p) {
  if (!hiddenList || !isDesktopPath(p)) return;
  if (inList(p) >= 0) { w.setHiddenAttr(p, true); return; }
  const cur = w.isHiddenAttr(p);
  if (cur !== false) return;          // 不存在，或用户自己隐藏的文件：不接管
  if (w.setHiddenAttr(p, true)) { hiddenList.push(p); writeJournal(); }
}

function unhideOriginal(p) {
  if (!hiddenList) return;
  const i = inList(p);
  if (i >= 0) {
    hiddenList.splice(i, 1);
    try { w.setHiddenAttr(p, false); } catch (e) { }
    writeJournal();
  }
}

function restoreAll() {
  if (!hiddenList) return 0;
  let n = 0;
  for (const p of hiddenList.slice()) {
    try { if (w.setHiddenAttr(p, false)) n++; } catch (e) { }
  }
  hiddenList.length = 0;
  writeJournal();
  return n;
}

function forgetHidden(p) { const i = inList(p); if (i >= 0) { hiddenList.splice(i, 1); writeJournal(); } }
function renameHidden(oldP, newP) { const i = inList(oldP); if (i >= 0) { hiddenList[i] = newP; writeJournal(); } }

// 让资源管理器立即刷新桌面（同步刷新，防止进程退出导致通知丢失）
function refreshDesktop() {
  for (const d of desktopDirs()) {
    try { w.api.SHChangeNotify(0x00001000 /* SHCNE_UPDATEDIR */, 0x0005 | 0x1000 /* PATHW|FLUSH */, d, null); } catch (e) { }
  }
}

// 把围栏里所有桌面项与隐藏列表对齐（启动时/开关收纳功能时调用）
function syncHidden(fences, enabled) {
  if (!hiddenList) return;
  const wanted = new Map();
  if (enabled) {
    for (const f of fences) {
      if (f.type !== 'normal') continue;
      for (const it of f.items) if (it.path && isDesktopPath(it.path)) wanted.set(it.path.toLowerCase(), it.path);
    }
  }
  for (const p of hiddenList.slice()) {
    if (!wanted.has(p.toLowerCase())) { try { w.setHiddenAttr(p, false); } catch (e) { } hiddenList.splice(inList(p), 1); }
  }
  for (const [, p] of wanted) { try { hideOriginal(p); } catch (e) { } }
  writeJournal();
}

// ===== 收纳（真实移动）=====
// 拖入围栏的桌面项目会被「移动」到收纳文件夹：桌面上不再存在该文件（不是隐藏）。
// 收纳文件夹默认放在桌面的同级目录（与桌面同盘、OneDrive 备份桌面时同样会同步）：
//   C:/Users/<用户>/ZTABLE 收纳\<围栏名>\
// 移出围栏 / 删除围栏 / 退出（可选）时，文件被移回桌面原位置。
const returned = new Map();   // 刚放回桌面的文件名 -> 时间（防止被自动归类规则立刻吸回去）
function markReturned(p) { returned.set(path.basename(p).toLowerCase(), Date.now()); }
function isReturned(p) {
  const k = path.basename(p).toLowerCase(), t = returned.get(k);
  if (t && Date.now() - t < 10000) return true;
  if (t) returned.delete(k);
  return false;
}

function storeRoot(config) {
  if (config && config.general && config.general.storeRoot) return config.general.storeRoot;
  return path.join(path.dirname(userDesktop()), 'ZTABLE 收纳');
}
function safeName(name) {
  return (String(name || '围栏').replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/, '').trim() || '围栏').slice(0, 60);
}
function fenceStoreDir(config, fence) {
  if (fence.storeDir && fs.existsSync(fence.storeDir)) return fence.storeDir;
  const root = storeRoot(config);
  fs.mkdirSync(root, { recursive: true });
  let dir = path.join(root, safeName(fence.name));
  if (fs.existsSync(dir) && !(fence.storeDir && path.resolve(fence.storeDir) === path.resolve(dir))) {
    const used = config.fences.some(f => f !== fence && f.storeDir && path.resolve(f.storeDir).toLowerCase() === path.resolve(dir).toLowerCase());
    if (used) dir = path.join(root, safeName(fence.name) + ' (' + String(fence.id).slice(-4) + ')');
  }
  fs.mkdirSync(dir, { recursive: true });
  fence.storeDir = dir;
  return dir;
}
function uniquePath(dir, name) {
  let target = path.join(dir, name);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(name), base = path.basename(name, ext);
  for (let i = 2; i < 1000; i++) {
    target = path.join(dir, base + ' (' + i + ')' + ext);
    if (!fs.existsSync(target)) return target;
  }
  return path.join(dir, base + ' ' + Date.now() + ext);
}
// 移动文件/文件夹；跨盘时复制后删除源
function moveFile(src, dst) {
  try { fs.renameSync(src, dst); return true; }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(src, dst, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    fs.rmSync(src, { recursive: true, force: true });
    return true;
  }
}
function isInStore(config, p) {
  const root = path.resolve(storeRoot(config)).toLowerCase() + path.sep;
  return path.resolve(p).toLowerCase().startsWith(root);
}

function stowMode(config) {
  return (config && config.general && config.general.stowMode === 'move') ? 'move' : 'inPlace';
}

// 把一个路径收纳进围栏：
//   inPlace 模式（默认）→ 文件保持在桌面原路径，桌面图标由主进程停放到可视区域外（不移动、不隐藏属性）
//   move   模式        → 桌面项目移动到收纳文件夹；其他位置（下载等）→ 仅建立引用
// 返回 { item, moved, inPlace, error }
function stowPath(config, fence, p, existing) {
  const base = existing ? Object.assign({}, existing) : newItem(p);
  base.path = p;
  if (fence.type !== 'normal' || (config.general && config.general.noStow)) return { item: base, moved: false };
  const fromDesktop = isDesktopPath(p);
  const fromStore = !fromDesktop && isInStore(config, p);
  // ---- 原位收纳：文件保持在桌面原路径，仅用「隐藏」属性把桌面图标收起 ----
  // （off-screen 停放会被资源管理器钳制回可视区，隐藏属性才能真正让图标从桌面消失，且路径不变）
  if (stowMode(config) === 'inPlace') {
    if (fromStore) {                                  // 从旧版收纳文件夹迁回桌面，再做原位收纳
      try { const r = returnToDesktop(config, base); if (r.ok && r.path) { base.path = r.path; base.name = path.basename(r.path); } } catch (e) { }
    }
    const cur = base.path;
    if (isDesktopPath(cur) && fs.existsSync(cur)) {
      base.origin = cur; base.originDir = path.dirname(cur); base.inPlace = true; base.parked = false;
      try { hideOriginal(cur); } catch (e) { }        // 设置隐藏属性：桌面不再显示该图标，文件仍在原路径
    }
    return { item: base, moved: false, inPlace: true };
  }
  if (!fromDesktop && !fromStore) return { item: base, moved: false };
  try {
    if (!fs.existsSync(p)) return { item: base, moved: false };
    unhideOriginal(p);                                   // 旧版本隐藏过的先取消隐藏
    const dir = fenceStoreDir(config, fence);
    if (path.resolve(path.dirname(p)).toLowerCase() === path.resolve(dir).toLowerCase()) return { item: base, moved: false };
    const dst = uniquePath(dir, path.basename(p));
    moveFile(p, dst);
    if (fromDesktop) { base.origin = p; base.originDir = path.dirname(p); }
    base.path = dst;
    base.name = path.basename(dst);
    base.parked = false;
    return { item: base, moved: true };
  } catch (e) {
    cleanupStoreDir(fence);                 // 移动失败（如公共桌面无权限）不留空文件夹
    return { item: base, moved: false, error: e };
  }
}

// 把收纳的项目放回桌面（原来所在的桌面文件夹；重名自动加序号）
function returnToDesktop(config, item) {
  if (!item || !item.origin) return { ok: false, path: item && item.path };
  // 原位收纳：文件从未离开桌面，只需取消隐藏属性，桌面图标即重新出现
  if (item.inPlace) { try { unhideOriginal(item.path); } catch (e) { } return { ok: true, path: item.path, inPlace: true }; }
  if (!fs.existsSync(item.path)) return { ok: false, gone: true, path: item.path };
  if (isDesktopPath(item.path)) return { ok: true, path: item.path };        // 已在桌面
  const dir = (item.originDir && fs.existsSync(item.originDir)) ? item.originDir : userDesktop();
  const preferred = path.basename(item.origin);
  const dst = fs.existsSync(path.join(dir, preferred)) ? uniquePath(dir, preferred) : path.join(dir, preferred);
  try {
    markReturned(dst);
    moveFile(item.path, dst);
    return { ok: true, path: dst };
  } catch (e) {
    return { ok: false, error: e, path: item.path };
  }
}
function cleanupStoreDir(fence) {
  try {
    if (fence.storeDir && fs.existsSync(fence.storeDir) && fs.readdirSync(fence.storeDir).length === 0) {
      fs.rmdirSync(fence.storeDir);
      const root = path.dirname(fence.storeDir);
      if (fs.readdirSync(root).length === 0) fs.rmdirSync(root);
      fence.storeDir = null;
    }
  } catch (e) { }
}

// ===== 规则 =====
const PRESET_GROUPS = {
  software: ['lnk', 'exe', 'url', 'appref-ms', 'bat', 'cmd', 'msc'],
  docs: ['doc', 'docx', 'pdf', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'txt', 'md', 'rtf', 'wps', 'et', 'dps', 'pages', 'key', 'numbers', 'epub', '1'],
  images: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'heic', 'psd', 'ai', 'tif', 'tiff', 'raw', 'cr2', 'mp4', 'mov', 'mkv', 'avi', 'mp3', 'wav', 'flac'],
  archives: ['zip', 'rar', '7z', 'tar', 'gz', 'iso'],
  code: ['js', 'ts', 'json', 'py', 'html', 'css', 'cs', 'cpp', 'java', 'sh', 'yml', 'yaml', 'xml', 'ipynb']
};

function matchRule(rule, item, source) {
  if (!rule || rule.enabled === false) return false;
  if (rule.source && rule.source !== 'any' && rule.source !== source) return false;
  if (rule.kind === 'folder' && !item.isDir) return false;
  if (rule.kind === 'file' && item.isDir) return false;
  if (Array.isArray(rule.exts) && rule.exts.length) {
    if (item.isDir) return false;
    const exts = rule.exts.map(e => String(e).replace(/^\./, '').toLowerCase());
    if (!exts.includes(item.ext)) return false;
  }
  if (Array.isArray(rule.keywords) && rule.keywords.length) {
    const n = item.name.toLowerCase();
    if (!rule.keywords.some(k => k && n.includes(String(k).toLowerCase()))) return false;
  }
  if (rule.modifiedWithinDays && rule.modifiedWithinDays > 0) {
    if (Date.now() - item.mtime > rule.modifiedWithinDays * 86400000) return false;
  }
  if (rule.olderThanDays && rule.olderThanDays > 0) {
    if (Date.now() - item.mtime < rule.olderThanDays * 86400000) return false;
  }
  if (rule.minSizeMB && !item.isDir && item.size < rule.minSizeMB * 1048576) return false;
  const hasCond = (Array.isArray(rule.exts) && rule.exts.length) || (Array.isArray(rule.keywords) && rule.keywords.length)
    || rule.kind === 'folder' || rule.modifiedWithinDays || rule.olderThanDays || rule.minSizeMB || rule.source === 'downloads';
  return !!hasCond;
}

function fencedPaths(fences) {
  const s = new Set();
  for (const f of fences) if (f.type === 'normal') for (const it of f.items) s.add(it.path.toLowerCase());
  return s;
}

// 组织：把桌面上的散落文件按规则归类，返回 {moved:[{path,fence,iconless}], created:[]}
function organize(config, storeHidden, opts) {
  opts = opts || {};
  const fences = config.fences.filter(f => f.type === 'normal');
  const targets = {};
  for (const f of fences) targets[f.id] = f;
  const known = fencedPaths(config.fences);
  const desktop = desktopDirs();
  const created = {};
  const sources = [];
  for (const d of desktop) sources.push({ dir: d, source: 'desktop' });
  if (opts.includeDownloads) sources.push({ dir: downloadsDir(), source: 'downloads' });
  for (const src of sources) {
    const entries = readEntries(src.dir);
    for (const item of entries) {
      if (known.has(item.path.toLowerCase())) continue;
      if (item.desktop && w.isHiddenAttr(item.path) && !storeHidden.includes(item.path)) continue; // 用户自己隐藏的文件不动
      let rule = null;
      for (const r of config.rules) {
        if (src.source === 'downloads' && r.source === 'desktop') continue;
        if (matchRule(r, item, src.source)) { rule = r; break; }
      }
      if (!rule) {
        if (opts.defaultFenceId && targets[opts.defaultFenceId] && src.source === 'desktop') rule = { fenceId: opts.defaultFenceId };
        else continue;
      }
      const fence = targets[rule.fenceId];
      if (!fence) continue;
      const st = stowPath(config, fence, item.path);
      fence.items.push(st.item);
      known.add(item.path.toLowerCase());
      created[fence.id] = (created[fence.id] || 0) + 1;
    }
  }
  return created;
}

function newItem(p) {
  let isDir = false;
  try { isDir = fs.statSync(p).isDirectory(); } catch (e) { }
  return { path: p, addedAt: Date.now(), hidden: false, isDir, name: path.basename(p) };
}

// 单文件归类（监视器触发，只对新文件生效）
function classifyOne(config, p, source) {
  const known = fencedPaths(config.fences);
  if (known.has(p.toLowerCase())) return null;
  const nameOverride = p;
  let st = null;
  try { st = fs.statSync(p); } catch (e) { return null; }
  const item = {
    name: path.basename(p), path: p, isDir: st.isDirectory(),
    ext: st.isDirectory() ? '' : path.extname(p).slice(1).toLowerCase(),
    mtime: st.mtimeMs, size: st.isDirectory() ? 0 : st.size,
    desktop: isDesktopPath(p)
  };
  for (const r of config.rules) {
    if (!r.auto) continue;
    if (source === 'downloads' && r.source === 'desktop') continue;
    if (matchRule(r, item, source)) {
      const fence = config.fences.find(f => f.id === r.fenceId && f.type === 'normal');
      if (!fence) continue;
      if (isReturned(p)) return null;
      const st = stowPath(config, fence, p);
      fence.items.push(st.item);
      return { fence, item };
    }
  }
  return null;
}

// ===== 监视 =====
function makeWatcher(getConfig, onChanged, shouldSkip) {
  const watchers = [];
  const timers = {};
  const pending = new Map();

  function watchDir(dir, source) {
    if (!dir) return;
    const key = dir.toLowerCase();
    try {
      const wch = fs.watch(dir, { persistent: false }, (evt, filename) => {
        if (!filename) return;
        const full = path.join(dir, filename);
        if (isSystemName(filename)) return;
        if (/\.(crdownload|part|tmp|download)$/i.test(filename)) return;
        const now = Date.now();
        pending.set(full, { at: now, source, dir });
        clearTimeout(timers[key]);
        timers[key] = setTimeout(() => flush(), 900);
      });
      watchers.push(wch);
    } catch (e) { }
  }

  function flush() {
    const cfg = getConfig();
    const now = Date.now();
    for (const [full, meta] of Array.from(pending.entries())) {
      if (now - meta.at < 300) continue;
      pending.delete(full);
      let st = null;
      try { st = fs.statSync(full); } catch (e) {
        if (meta.dir && isDesktopDir(meta.dir)) onChanged({ type: 'removed', path: full });
        continue;
      }
      if (!st.isFile() && !st.isDirectory()) continue;
      if (meta.source === 'downloads') {
        // 等文件落盘稳定
        if (now - st.mtimeMs < 700) { pending.set(full, { at: meta.at, source: meta.source, dir: meta.dir, retry: (meta.retry || 0) + 1 }); continue; }
      }
      const res = ((shouldSkip && shouldSkip(full)) || isReturned(full)) ? null : classifyOne(cfg, full, meta.source);
      if (res) onChanged({ type: 'auto', path: full, fenceId: res.fence.id, from: meta.source });
      else onChanged({ type: 'new', path: full, from: meta.source });
    }
    if (pending.size) {
      clearTimeout(timers.__retry);
      timers.__retry = setTimeout(() => flush(), 800);
    }
  }

  return {
    start(config) {
      this.stop();
      if (!config || config.general.watchDownloads !== false) watchDir(downloadsDir(), 'downloads');
      for (const d of desktopDirs()) watchDir(d, 'desktop');
    },
    stop() { for (const x of watchers.splice(0)) { try { x.close(); } catch (e) { } } },
    poke() { clearTimeout(timers.__retry); timers.__retry = setTimeout(() => flush(), 500); }
  };
}

module.exports = {
  userDesktop, publicDesktop, downloadsDir, desktopDirs, readEntries, isDesktopPath, isDesktopDir,
  setCtx, hideOriginal, unhideOriginal, restoreAll, syncHidden, refreshDesktop,
  journalPath, setIconsHidden, journalIconsHidden, forgetHidden, renameHidden,
  setStowed, setParked, stowMode, takeReturnedMap, storeRoot, fenceStoreDir, stowPath, returnToDesktop, cleanupStoreDir, isInStore, markReturned, isReturned,
  matchRule, organize, classifyOne, newItem, makeWatcher, PRESET_GROUPS, fencedPaths
};
