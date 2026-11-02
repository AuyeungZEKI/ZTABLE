'use strict';
// ZTABLE 主进程
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeTheme, shell, dialog, nativeImage, clipboard, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

const ARG = (name) => { const a = process.argv.find(x => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : null; };
const FLAG = (name) => process.argv.includes('--' + name);

const profileDir = ARG('profile');
if (profileDir) app.setPath('userData', path.resolve(profileDir));
app.setAppUserModelId('com.ztable.desktop');

const LIVETEST = ARG('livetest');
const DRAGTEST = ARG('dragtest');
const QUITTEST = ARG('quittest');
const RESTARTTEST = ARG('restarttest');
const DESKDROPTEST = ARG('deskdroptest');
if (RESTARTTEST) { try { app.setPath('desktop', path.resolve(RESTARTTEST, 'Desktop')); process.env.PUBLIC = path.resolve(RESTARTTEST, 'Public'); } catch (e) { } }
if (QUITTEST) { try { app.setPath('desktop', path.resolve(QUITTEST, 'Desktop')); process.env.PUBLIC = path.resolve(QUITTEST, 'Public'); } catch (e) { } }
const SELFTEST = ARG('selftest') || LIVETEST || DRAGTEST || QUITTEST || RESTARTTEST || DESKDROPTEST;
const NOHOOK = FLAG('nohook') || (!!SELFTEST && !LIVETEST && !DRAGTEST && !QUITTEST && !RESTARTTEST && !DESKDROPTEST);

// GPU 兜底：显卡驱动异常时自动切换为软件渲染
const NO_GPU_FLAG = path.join(app.getPath('userData'), 'no-gpu.flag');
if (FLAG('soft') || SELFTEST || fs.existsSync(NO_GPU_FLAG)) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('no-sandbox'); // 部分安全软件环境下 GPU 进程沙箱无法启动
}
let gpuCrashes = 0;
app.on('child-process-gone', (e, d) => {
  if (d && d.type === 'GPU' && d.reason !== 'clean-exit' && ++gpuCrashes >= 2 && !fs.existsSync(NO_GPU_FLAG)) {
    try { fs.mkdirSync(path.dirname(NO_GPU_FLAG), { recursive: true }); fs.writeFileSync(NO_GPU_FLAG, String(Date.now())); } catch (err) { }
    try { if (cfg) restoreEverything(); } catch (err) { }
    app.relaunch(); app.exit(0);
  }
});

if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const win32 = require('./win32');
const caps = require('./oscaps');
const { Store, DEFAULT_STYLE, normalizeFence } = require('./store');
const ds = require('./desktopsvc');
const icons = require('./icons');
const hk = require('./hotkeys');

const ROOT = path.join(__dirname, '..');
const R = (f) => path.join(ROOT, 'renderer', f);
const PRELOAD = path.join(__dirname, 'preload.js');
const ICON = path.join(ROOT, 'assets', 'icon.ico');
const VERSION = app.getVersion();

const store = new Store(app.getPath('userData'));
{
  const rawSave = store.save.bind(store);
  store.save = (immediate) => { try { if (cfg) ds.setStowed(cfg); } catch (e) { } return rawSave(immediate); };
}
let cfg = null;
const fenceWins = new Map();      // id -> BrowserWindow
const virtualFences = new Map();  // 临时围栏（快速隐藏保留区）
const portalCwd = new Map();      // portal fence id -> 当前浏览目录
const portalWatchers = new Map();
let settingsWin = null, selectionWin = null, tray = null, hookProc = null, hookStatus = { ok: false };
let overlays = [], dimWins = [];
let peekActive = false, quickHidden = false, quitting = false;
let watcher = null;
let captureTarget = null;
let lastProgman = null;

const PALETTE = ['#3B82F6', '#14B8A6', '#A855F7', '#F59E0B', '#22C55E', '#EF4444', '#0EA5E9', '#EC4899', '#64748B'];

const PRESETS = {
  software: { name: '软件', accent: '#3B82F6', icon: '🧩', rules: [{ name: '软件与快捷方式', exts: ds.PRESET_GROUPS.software }] },
  docs: { name: '文档', accent: '#14B8A6', icon: '📄', rules: [{ name: '文档资料', exts: ds.PRESET_GROUPS.docs }] },
  images: { name: '图片', accent: '#A855F7', icon: '🖼', rules: [{ name: '图片与媒体', exts: ds.PRESET_GROUPS.images }] },
  downloads: { name: '下载', accent: '#F59E0B', icon: '⬇', rules: [{ name: '压缩包与安装包', exts: ds.PRESET_GROUPS.archives.concat(['msi', 'torrent', 'dmg', 'apk']) }, { name: '新下载的文件', source: 'downloads' }] },
  projects: { name: '项目', accent: '#22C55E', icon: '📁', rules: [{ name: '项目关键词', keywords: ['项目', 'project', 'proj', '工程', '方案', '提案'] }, { name: '桌面文件夹', kind: 'folder' }] }
};

// ================= 工具 =================
const uid = (p) => (p || 'f') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function themeName() {
  const t = cfg.general.theme;
  if (t === 'light' || t === 'dark') return t;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}
function displayKey(d) {
  const pw = Math.round(d.bounds.width * d.scaleFactor), ph = Math.round(d.bounds.height * d.scaleFactor);
  return (d.label || ('Display' + d.id)) + '|' + pw + 'x' + ph;
}
function ensureDisplays() {
  for (const d of screen.getAllDisplays()) {
    const k = displayKey(d);
    if (!cfg.displays[k]) cfg.displays[k] = { iconScale: 1, fontScale: 1, showFences: true };
    cfg.displays[k].name = d.label || ('显示器 ' + d.id);
    cfg.displays[k].lastSeen = Date.now();
  }
}
function displaySettings(d) { return cfg.displays[displayKey(d)] || { iconScale: 1, fontScale: 1, showFences: true }; }
function getFence(id) { return cfg.fences.find(f => f.id === id) || virtualFences.get(id) || null; }
function notify(title, body) {
  try { if (Notification.isSupported()) new Notification({ title, body, icon: ICON, silent: true }).show(); } catch (e) { }
}
function save() { store.save(); broadcastSettings(); }

// ================= 围栏位置 =================
function resolveBounds(fence) {
  const disps = screen.getAllDisplays();
  let d = fence.displayKey ? disps.find(x => displayKey(x) === fence.displayKey) : null;
  const b = Object.assign({}, fence.bounds);
  if (d && fence.rel) { b.x = d.bounds.x + fence.rel.x; b.y = d.bounds.y + fence.rel.y; }
  if (!d) d = screen.getDisplayMatching(b);
  const wa = d.workArea;
  b.width = Math.max(140, Math.min(b.width, wa.width));
  b.height = Math.max(60, Math.min(b.height, wa.height));
  b.x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - Math.min(b.width, 80));
  b.y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - 40);
  return { bounds: b, display: d };
}
function rememberBounds(fence, b) {
  fence.bounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  const d = screen.getDisplayMatching(fence.bounds);
  fence.displayKey = displayKey(d);
  fence.rel = { x: fence.bounds.x - d.bounds.x, y: fence.bounds.y - d.bounds.y };
}
function titleHeight(fence) {
  const d = resolveBounds(fence).display;
  const fs_ = displaySettings(d).fontScale || 1;
  return Math.round((fence.style.titleSize + 21) * fs_);
}
function snapValue(v, targets, tol) {
  for (const t of targets) if (Math.abs(v - t) <= tol) return t;
  return v;
}
function snapBounds(fence, b, mode) {
  if (!cfg.general.snap) return b;
  const d = screen.getDisplayMatching(b);
  const wa = d.workArea;
  const xs = [wa.x + 8, wa.x + wa.width - 8], ys = [wa.y + 8, wa.y + wa.height - 8];
  for (const [id, win] of fenceWins) {
    if (id === fence.id || !win.isVisible()) continue;
    const o = win.getBounds();
    xs.push(o.x, o.x + o.width, o.x - 8, o.x + o.width + 8);
    ys.push(o.y, o.y + o.height, o.y - 8, o.y + o.height + 8);
  }
  const tol = 10;
  const r = Object.assign({}, b);
  if (mode === 'move') {
    const nx = snapValue(r.x, xs, tol);
    if (nx !== r.x) r.x = nx; else { const nx2 = snapValue(r.x + r.width, xs, tol); if (nx2 !== r.x + r.width) r.x = nx2 - r.width; }
    const ny = snapValue(r.y, ys, tol);
    if (ny !== r.y) r.y = ny; else { const ny2 = snapValue(r.y + r.height, ys, tol); if (ny2 !== r.y + r.height) r.y = ny2 - r.height; }
  } else {
    const right = snapValue(r.x + r.width, xs, tol); r.width = right - r.x;
    const bottom = snapValue(r.y + r.height, ys, tol); r.height = bottom - r.y;
  }
  return r;
}

// ================= 围栏数据 -> 渲染状态 =================
function displayNameOf(p, isDir) {
  const base = path.basename(p) || p;
  if (isDir) return base;
  return base.replace(/\.(lnk|url|appref-ms|website)$/i, '');
}
function sortItems(list, sort) {
  const cmpName = (a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
  if (sort === 'name') list.sort((a, b) => (b.isDir - a.isDir) || cmpName(a, b));
  else if (sort === 'type') list.sort((a, b) => (b.isDir - a.isDir) || a.ext.localeCompare(b.ext) || cmpName(a, b));
  else if (sort === 'mtime') list.sort((a, b) => b.mtime - a.mtime);
  else if (sort === 'size') list.sort((a, b) => b.size - a.size);
  return list;
}
function listItems(fence) {
  if (fence.type === 'portal') {
    const cwd = portalCwd.get(fence.id) || fence.portalPath;
    const entries = ds.readEntries(cwd);
    const list = entries.map(e => ({ path: e.path, name: displayNameOf(e.path, e.isDir), isDir: e.isDir, ext: e.ext, mtime: e.mtime, size: e.size, missing: false }));
    sortItems(list, fence.style.sort === 'manual' ? 'name' : fence.style.sort);
    return list;
  }
  const list = fence.items.map(it => {
    let st = null;
    try { st = fs.statSync(it.path); } catch (e) { }
    const isDir = st ? st.isDirectory() : !!it.isDir;
    return {
      path: it.path, name: displayNameOf(it.path, isDir), isDir,
      ext: isDir ? '' : path.extname(it.path).slice(1).toLowerCase(),
      mtime: st ? st.mtimeMs : 0, size: st ? st.size : 0, missing: !st
    };
  });
  if (fence.style.sort !== 'manual') sortItems(list, fence.style.sort);
  return list;
}
function fenceState(fence) {
  const { display } = resolveBounds(fence);
  const dset = displaySettings(display);
  let portal = null;
  if (fence.type === 'portal') {
    const cwd = portalCwd.get(fence.id) || fence.portalPath;
    portal = { root: fence.portalPath, cwd, exists: fs.existsSync(cwd), canBack: path.resolve(cwd).toLowerCase() !== path.resolve(fence.portalPath).toLowerCase(), crumb: path.relative(fence.portalPath, cwd) };
  }
  return {
    fence: JSON.parse(JSON.stringify(fence)),
    virtual: virtualFences.has(fence.id),
    theme: themeName(),
    scale: { icon: dset.iconScale || 1, font: dset.fontScale || 1 },
    items: listItems(fence),
    portal, peek: peekActive
  };
}
const sendTimers = {};
function applyMaterial(win, fence) {
  if (!caps.acrylic) return;                       // Win10 / Win11 21H2：不支持系统背景材质
  const want = fence.style.blur ? 'acrylic' : 'none';
  if ((win._material || 'none') === want) return;
  win._material = want;
  try { win.setBackgroundMaterial(want); } catch (e) { }
  try { win32.setCornerPreference(win32.hwndFromBuffer(win.getNativeWindowHandle()), fence.style.blur ? (fence.style.radius > 6 ? 2 : 1) : 0); } catch (e) { }
}
function pushFence(id) {
  clearTimeout(sendTimers[id]);
  sendTimers[id] = setTimeout(() => {
    const win = fenceWins.get(id), fence = getFence(id);
    if (win && fence && !win.isDestroyed()) { applyMaterial(win, fence); win.webContents.send('fence:state', fenceState(fence)); }
  }, 25);
}
function pushAll() { for (const id of fenceWins.keys()) pushFence(id); }

// ================= 围栏窗口 =================
function fenceVisibleNow(fence) {
  if (peekActive) return true;
  const { display } = resolveBounds(fence);
  if (displaySettings(display).showFences === false) return false;
  if (quickHidden && cfg.quickHide.hideFences && !fence.keepOnQuickHide && !virtualFences.has(fence.id)) return false;
  return true;
}

function createFenceWindow(fence) {
  const { bounds } = resolveBounds(fence);
  const h = fence.rolledUp ? titleHeight(fence) : bounds.height;
  const win = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: h,
    frame: false, transparent: true, resizable: false, movable: true, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, thickFrame: false,
    backgroundColor: '#00000000', title: 'ZTABLE · ' + fence.name, icon: ICON,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, spellcheck: false }
  });
  fenceWins.set(fence.id, win);
  win.loadFile(R('fence.html'), { query: { id: fence.id } });
  win.webContents.on('did-finish-load', () => pushFence(fence.id));
  if (SELFTEST || FLAG('debug')) win.webContents.on('console-message', (ev) => console.log('[fence]', ev.message, ev.lineNumber));
  const hwnd = win32.hwndFromBuffer(win.getNativeWindowHandle());
  try {
    win.hookWindowMessage(0x0046 /* WM_WINDOWPOSCHANGING */, (wp, lp) => {
      if (!peekActive && !quitting) win32.forceBottomInWindowPos(lp);
    });
  } catch (e) { }
  win.once('ready-to-show', () => {
    win32.attachToDesktop(hwnd);
    if (fenceVisibleNow(fence)) win.showInactive();
    win32.sendToBottom(hwnd);
  });
  win.on('closed', () => { fenceWins.delete(fence.id); stopPortalWatch(fence.id); });
  win.on('session-end', () => restoreEverything());
  if (fence.type === 'portal') startPortalWatch(fence);
  return win;
}

function applyFenceBounds(fence) {
  const win = fenceWins.get(fence.id);
  if (!win || win.isDestroyed()) return;
  const { bounds } = resolveBounds(fence);
  const h = fence.rolledUp ? titleHeight(fence) : bounds.height;
  win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: h });
}

function refreshVisibility() {
  for (const [id, win] of fenceWins) {
    const fence = getFence(id);
    if (!fence || win.isDestroyed()) continue;
    const v = fenceVisibleNow(fence);
    if (v && !win.isVisible()) { win.showInactive(); if (!peekActive) win32.sendToBottom(win32.hwndFromBuffer(win.getNativeWindowHandle())); }
    else if (!v && win.isVisible()) win.hide();
  }
}

function startPortalWatch(fence) {
  stopPortalWatch(fence.id);
  const cwd = portalCwd.get(fence.id) || fence.portalPath;
  try {
    let t = null;
    const wch = fs.watch(cwd, { persistent: false }, () => { clearTimeout(t); t = setTimeout(() => pushFence(fence.id), 300); });
    portalWatchers.set(fence.id, wch);
  } catch (e) { }
}
function stopPortalWatch(id) { const x = portalWatchers.get(id); if (x) { try { x.close(); } catch (e) { } portalWatchers.delete(id); } }

function nextFencePosition(display, w_, h_) {
  const d = display || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = d.workArea;
  const rects = cfg.fences.map(f => resolveBounds(f).bounds);
  const gap = 16;
  for (let y = wa.y + 24; y + h_ <= wa.y + wa.height; y += 40) {
    for (let x = wa.x + 24; x + w_ <= wa.x + wa.width; x += 40) {
      const hit = rects.some(r => x < r.x + r.width + gap && x + w_ + gap > r.x && y < r.y + r.height + gap && y + h_ + gap > r.y);
      if (!hit) return { x, y, width: w_, height: h_ };
    }
  }
  return { x: wa.x + 40, y: wa.y + 40, width: w_, height: h_ };
}

function createFence(opts) {
  opts = opts || {};
  const fence = normalizeFence({
    id: uid('f'), name: opts.name || '新建围栏', type: opts.type || 'normal', portalPath: opts.portalPath || null,
    items: [], style: Object.assign({}, DEFAULT_STYLE, { accent: opts.accent || PALETTE[cfg.fences.length % PALETTE.length] }, opts.style || {}),
    bounds: opts.bounds || nextFencePosition(null, 340, 250), rolledUp: !!opts.rolledUp, createdAt: Date.now()
  });
  if (fence.type === 'portal') fence.style.sort = 'name';
  rememberBounds(fence, fence.bounds);
  cfg.fences.push(fence);
  if (opts.items && opts.items.length && fence.type === 'normal') stowInto(fence, opts.items);
  createFenceWindow(fence);
  save();
  return fence;
}

function deleteFence(id, skipConfirm) {
  const fence = getFence(id);
  if (!fence) return;
  const doIt = () => {
    const res = returnItems(fence, fence.items);
    ds.cleanupStoreDir(fence);
    cfg.fences = cfg.fences.filter(f => f.id !== id);
    for (const r of cfg.rules) if (r.fenceId === id) { r.fenceId = null; r.enabled = false; }
    const win = fenceWins.get(id);
    if (win && !win.isDestroyed()) win.close();
    store.save(true); broadcastSettings();
    scheduleReconcile(120);
    if (res.failed.length) notify('ZTABLE', res.failed.length + ' 个项目没能放回桌面，仍在「' + (fence.storeDir || '') + '」中');
  };
  if (skipConfirm) return doIt();
  const r = dialog.showMessageBoxSync({
    type: 'question', buttons: ['删除围栏', '取消'], defaultId: 1, cancelId: 1, title: 'ZTABLE', icon: ICON,
    message: '删除围栏「' + fence.name + '」？',
    detail: fence.type === 'portal' ? '只删除这个门户视图，文件夹本身不会受影响。' : '围栏中的 ' + fence.items.length + ' 个项目会立即移回桌面，文件本身不会被删除。'
  });
  if (r === 0) doIt();
}

function applyPreset(fence, key, collect) {
  const p = PRESETS[key];
  if (!p) return;
  fence.name = p.name;
  fence.style.accent = p.accent;
  const newRules = [];
  for (const r of p.rules) {
    const rule = Object.assign({ id: uid('r'), enabled: true, auto: true, source: 'desktop', kind: 'any', exts: [], keywords: [], modifiedWithinDays: 0, olderThanDays: 0, fenceId: fence.id, preset: key }, r);
    rule.exts = (rule.exts || []).slice();
    newRules.push(rule);
  }
  cfg.rules.push(...newRules);
  sortRulesByPriority();
  if (collect) {
    const saved = cfg.rules;
    cfg.rules = newRules;
    try { ds.organize(cfg, cfg.hidden, {}); } finally { cfg.rules = saved; }
  }
  pushFence(fence.id);
  save();
}
// 关键词/文件夹/下载类规则优先级：关键词 > 扩展名 > 文件夹 > 下载来源
function sortRulesByPriority() {
  const pr = (r) => (r.keywords && r.keywords.length ? 0 : (r.exts && r.exts.length ? 1 : (r.kind === 'folder' ? 2 : 3)));
  const presetOnly = cfg.rules.every(r => r.preset);
  if (presetOnly) cfg.rules.sort((a, b) => pr(a) - pr(b));
}

function oneClickSetup() {
  const order = ['software', 'docs', 'images', 'downloads', 'projects'];
  const d = screen.getPrimaryDisplay();
  const wa = d.workArea;
  const cols = Math.max(1, Math.min(order.length, Math.floor((wa.width - 24) / 336)));
  const fw = Math.min(320, Math.floor((wa.width - 24 - 16 * cols) / cols)), fh = 240;
  order.forEach((k, i) => {
    const exist = cfg.fences.find(f => f.preset === k);
    if (exist) return;
    const col = i % cols, row = Math.floor(i / cols);
    const f = createFence({ name: PRESETS[k].name, accent: PRESETS[k].accent, bounds: { x: wa.x + 24 + col * (fw + 16), y: wa.y + 24 + row * (fh + 16), width: fw, height: fh } });
    f.preset = k;
    applyPreset(f, k, false);
  });
  const res = organizeNow(true);
  return res;
}

function organizeNow(silent) {
  const created = ds.organize(cfg, cfg.hidden, {});
  const total = Object.values(created).reduce((a, b) => a + b, 0);
  pushAll(); save();
  if (!silent || total) notify('ZTABLE 整理完成', total ? ('已将 ' + total + ' 个桌面项目归入围栏') : '桌面上没有需要归类的新项目');
  return { total, created };
}

// ================= 项目操作 =================
function addItems(fence, paths, before) {
  if (fence.type !== 'normal') return 0;
  const known = new Set(fence.items.map(i => i.path.toLowerCase()));
  let idx = before ? fence.items.findIndex(i => i.path.toLowerCase() === before.toLowerCase()) : -1;
  if (idx < 0) idx = fence.items.length;
  const add = [];
  const failed = [];
  for (const p of paths) {
    if (!p || known.has(p.toLowerCase())) continue;
    // 从其它围栏移过来：沿用原来的条目（保留「来自桌面」的记录）
    let prev = null;
    for (const other of cfg.fences) {
      if (other.id === fence.id || other.type !== 'normal') continue;
      const j = other.items.findIndex(i => i.path.toLowerCase() === p.toLowerCase());
      if (j >= 0) { prev = other.items.splice(j, 1)[0]; pushFence(other.id); }
    }
    const st = ds.stowPath(cfg, fence, p, prev);
    if (st.error) failed.push({ p, e: st.error });
    add.push(st.item); known.add(st.item.path.toLowerCase());
  }
  fence.items.splice(idx, 0, ...add);
  pushFence(fence.id); store.save(true); broadcastSettings();
  reportStowFailures(failed);
  scheduleReconcile(120);
  return add.length;
}
function stowInto(fence, paths) { return addItems(fence, paths); }
let lastFailNotice = 0;
function reportStowFailures(failed) {
  if (!failed.length || Date.now() - lastFailNotice < 3000) return;
  lastFailNotice = Date.now();
  const perm = failed.filter(f => f.e && (f.e.code === 'EPERM' || f.e.code === 'EACCES')).length;
  const busy = failed.filter(f => f.e && f.e.code === 'EBUSY').length;
  let msg = failed.length + ' 个项目无法移入围栏，已在围栏中保留快捷入口。';
  if (perm) msg += '（其中 ' + perm + ' 个位于「公共桌面」，移动需要管理员权限）';
  if (busy) msg += '（其中 ' + busy + ' 个文件正在被使用）';
  notify('ZTABLE', msg);
}
// 把条目移回桌面；返回 { returned:[], failed:[] }
function returnItems(fence, items) {
  const out = { returned: [], failed: [] };
  for (const it of items.slice()) {
    if (it.origin) {
      const r = ds.returnToDesktop(cfg, it);
      if (r.ok || r.gone) out.returned.push(r.path); else out.failed.push(it);
    } else {
      ds.unhideOriginal(it.path);                 // 旧版本留下的隐藏属性
    }
  }
  if (out.returned.length) ds.refreshDesktop();
  return out;
}

// ================= 原位收纳：桌面图标隐藏 =================
// inPlace 模式下文件始终留在桌面原路径，这里只负责让「已收进围栏」的桌面项目带上隐藏属性
// （桌面不再显示其图标），移出围栏时取消隐藏。隐藏清单与还原逻辑复用 desktopsvc 的 hidden.json。
let reconcileTimer = null;
function reconcileIcons() {
  if (!cfg) return;
  try {
    if (ds.stowMode(cfg) === 'inPlace') ds.syncHidden(cfg.fences, true);   // 收进围栏的桌面项目 → 隐藏
    else ds.syncHidden(cfg.fences, false);                                 // move 模式 → 取消任何隐藏
    ds.refreshDesktop();
  } catch (e) { }
}
function scheduleReconcile(delay) { clearTimeout(reconcileTimer); reconcileTimer = setTimeout(reconcileIcons, delay == null ? 250 : delay); }
function startIconWatch() { /* 隐藏属性持久稳定，无需定时巡检 */ }

// 移出围栏：来自桌面的项目移回桌面；引用类项目（下载文件夹等）只移除入口
function removeItems(fence, paths, opts) {
  opts = opts || {};
  const set = new Set(paths.map(p => p.toLowerCase()));
  const taking = fence.items.filter(it => set.has(it.path.toLowerCase()));
  let failed = [];
  if (!opts.noReturn && !virtualFences.has(fence.id)) failed = returnItems(fence, taking).failed;
  const keep = new Set(failed.map(i => i.path.toLowerCase()));
  fence.items = fence.items.filter(it => !set.has(it.path.toLowerCase()) || keep.has(it.path.toLowerCase()));
  if (virtualFences.has(fence.id)) cfg.quickHide.excludes = fence.items.map(i => i.path);
  pushFence(fence.id); store.save(true); broadcastSettings();
  scheduleReconcile(120);
  if (failed.length) notify('ZTABLE', failed.length + ' 个项目放回桌面失败（文件可能正在使用），已保留在围栏中');
}
function reorder(fence, paths, before) {
  const set = new Set(paths.map(p => p.toLowerCase()));
  const moving = fence.items.filter(i => set.has(i.path.toLowerCase()));
  const rest = fence.items.filter(i => !set.has(i.path.toLowerCase()));
  let idx = before ? rest.findIndex(i => i.path.toLowerCase() === before.toLowerCase()) : -1;
  if (idx < 0) idx = rest.length;
  rest.splice(idx, 0, ...moving);
  fence.items = rest;
  fence.style.sort = 'manual';
  pushFence(fence.id); save();
}
function uniqueTarget(dir, name) {
  let target = path.join(dir, name);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(name), base = path.basename(name, ext);
  for (let i = 2; i < 999; i++) {
    target = path.join(dir, base + ' (' + i + ')' + ext);
    if (!fs.existsSync(target)) return target;
  }
  return target;
}
async function copyIntoPortal(fence, paths) {
  const dir = portalCwd.get(fence.id) || fence.portalPath;
  let n = 0;
  for (const p of paths) {
    try {
      if (path.resolve(path.dirname(p)).toLowerCase() === path.resolve(dir).toLowerCase()) continue;
      await fs.promises.cp(p, uniqueTarget(dir, path.basename(p)), { recursive: true, errorOnExist: false });
      n++;
    } catch (e) { }
  }
  pushFence(fence.id);
  if (n) notify('ZTABLE', '已复制 ' + n + ' 个项目到「' + path.basename(dir) + '」');
}

function openItem(fence, p) {
  let st = null;
  try { st = fs.statSync(p); } catch (e) { }
  if (fence && fence.type === 'portal' && st && st.isDirectory()) {
    portalCwd.set(fence.id, p);
    startPortalWatch(fence);
    pushFence(fence.id);
    return;
  }
  if (!st) {
    dialog.showMessageBox({ type: 'warning', title: 'ZTABLE', message: '找不到这个项目', detail: p + '\n\n它可能已被移动或删除。可以在右键菜单中将它移出围栏。', icon: ICON });
    return;
  }
  shell.openPath(p).then(err => { if (err) win32.shellExec('open', p); });
  if (peekActive) setPeek(false);
}

// ================= 右键菜单 =================
function popupItemMenu(win, fence, paths) {
  const one = paths.length === 1 ? paths[0] : null;
  const ext = one ? path.extname(one).toLowerCase() : '';
  const tpl = [];
  if (one) {
    tpl.push({ label: '打开', click: () => openItem(fence, one) });
    if (['.exe', '.lnk', '.bat', '.cmd', '.msi'].includes(ext)) tpl.push({ label: '以管理员身份运行', click: () => win32.shellExec('runas', one) });
    tpl.push({ label: '打开文件所在位置', click: () => shell.showItemInFolder(one) });
  } else {
    tpl.push({ label: '打开选中的 ' + paths.length + ' 项', click: () => paths.forEach(p => openItem(fence, p)) });
  }
  tpl.push({ label: '复制路径', click: () => clipboard.writeText(paths.join('\r\n')) });
  if (fence.type === 'normal') {
    const others = cfg.fences.filter(f => f.type === 'normal' && f.id !== fence.id);
    tpl.push({ type: 'separator' });
    if (!virtualFences.has(fence.id)) {
      tpl.push({ label: '移出围栏（放回桌面）', click: () => removeItems(fence, paths) });
      tpl.push({ label: '移动到围栏', enabled: others.length > 0, submenu: others.map(o => ({ label: o.name, click: () => addItems(o, paths) })) });
      tpl.push({ label: '快速隐藏时保留此图标', type: 'checkbox', checked: paths.every(p => cfg.quickHide.excludes.includes(p)), click: (mi) => {
        const ex = new Set(cfg.quickHide.excludes);
        paths.forEach(p => mi.checked ? ex.add(p) : ex.delete(p));
        cfg.quickHide.excludes = Array.from(ex); save();
      } });
    } else {
      tpl.push({ label: '不再保留此图标', click: () => removeItems(fence, paths) });
    }
  }
  tpl.push({ type: 'separator' });
  if (one) tpl.push({ label: '属性', click: () => win32.showProperties(one) });
  tpl.push({ label: '删除到回收站…', click: async () => {
    const r = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['移到回收站', '取消'], defaultId: 1, cancelId: 1, title: 'ZTABLE', message: '将 ' + paths.length + ' 个项目移到回收站？', detail: paths.slice(0, 6).map(p => path.basename(p)).join('\n') + (paths.length > 6 ? '\n…' : '') });
    if (r !== 0) return;
    for (const p of paths) {
      try { ds.unhideOriginal(p); await shell.trashItem(p); } catch (e) { }
    }
    if (fence.type === 'normal') removeItems(fence, paths, { noReturn: true }); else pushFence(fence.id);
  } });
  Menu.buildFromTemplate(tpl).popup({ window: win });
}

function popupFenceMenu(win, fence) {
  if (virtualFences.has(fence.id)) {
    Menu.buildFromTemplate([{ label: '这是快速隐藏时的「保留图标」区', enabled: false }, { label: '恢复显示桌面', click: () => setQuickHidden(false) }]).popup({ window: win });
    return;
  }
  const st = fence.style;
  const setStyle = (k, v) => () => { fence.style[k] = v; pushFence(fence.id); save(); };
  const radio = (label, k, v) => ({ label, type: 'radio', checked: st[k] === v, click: setStyle(k, v) });
  const tpl = [
    { label: fence.name, enabled: false },
    { type: 'separator' },
    { label: '重命名', click: () => win.webContents.send('fence:beginRename') },
    { label: '外观设置…', click: () => openSettings('fences', fence.id) },
    { label: fence.rolledUp ? '展开围栏' : '卷起围栏', click: () => setRolled(fence, !fence.rolledUp) },
    { label: '排序方式', submenu: [radio('手动排列', 'sort', 'manual'), radio('名称', 'sort', 'name'), radio('类型', 'sort', 'type'), radio('修改时间', 'sort', 'mtime'), radio('大小', 'sort', 'size')] },
    { label: '图标大小', submenu: [radio('小 (32)', 'iconSize', 32), radio('中 (48)', 'iconSize', 48), radio('大 (64)', 'iconSize', 64), radio('超大 (96)', 'iconSize', 96)] },
    { label: '主题色', submenu: PALETTE.map(c => ({ label: c, type: 'radio', checked: st.accent === c, click: setStyle('accent', c) })) },
    { type: 'separator' },
    { label: '锁定位置与大小', type: 'checkbox', checked: !!fence.locked, click: (mi) => { fence.locked = mi.checked; pushFence(fence.id); save(); } },
    { label: '快速隐藏时保留此围栏', type: 'checkbox', checked: !!fence.keepOnQuickHide, click: (mi) => { fence.keepOnQuickHide = mi.checked; save(); } },
    { type: 'separator' }
  ];
  if (fence.type === 'portal') {
    tpl.push({ label: '在资源管理器中打开', click: () => shell.openPath(portalCwd.get(fence.id) || fence.portalPath) });
    tpl.push({ label: '回到门户根目录', enabled: !!portalCwd.get(fence.id), click: () => { portalCwd.delete(fence.id); startPortalWatch(fence); pushFence(fence.id); } });
    tpl.push({ label: '更换门户文件夹…', click: async () => { const dir = await pickFolder(win, fence.portalPath); if (dir) { fence.portalPath = dir; fence.name = path.basename(dir) || dir; portalCwd.delete(fence.id); startPortalWatch(fence); pushFence(fence.id); save(); } } });
  } else {
    tpl.push({ label: '应用分类预设', submenu: Object.keys(PRESETS).map(k => ({ label: PRESETS[k].name + '（自动归类）', click: () => applyPreset(fence, k, true) })) });
    tpl.push({ label: '立即按规则整理桌面', click: () => organizeNow(false) });
  }
  tpl.push({ type: 'separator' });
  tpl.push({ label: '新建围栏（框选）', click: () => startDrawMode() });
  tpl.push({ label: '新建文件夹门户…', click: () => newPortalDialog() });
  tpl.push({ label: '删除此围栏…', click: () => deleteFence(fence.id) });
  tpl.push({ type: 'separator' });
  tpl.push({ label: 'ZTABLE 设置…', click: () => openSettings() });
  Menu.buildFromTemplate(tpl).popup({ window: win });
}

function popupPresetMenu(fence) {
  const win = fenceWins.get(fence.id);
  if (!win) return;
  const tpl = [{ label: '这个围栏用来放…', enabled: false }, { type: 'separator' }];
  for (const k of Object.keys(PRESETS)) tpl.push({ label: PRESETS[k].icon + '  ' + PRESETS[k].name, click: () => applyPreset(fence, k, true) });
  tpl.push({ type: 'separator' });
  tpl.push({ label: '📂  文件夹门户…', click: async () => {
    const dir = await pickFolder(win);
    if (dir) { fence.type = 'portal'; fence.portalPath = dir; fence.name = path.basename(dir) || dir; fence.style.sort = 'name'; startPortalWatch(fence); pushFence(fence.id); save(); }
  } });
  tpl.push({ label: '✏️  空白围栏（自己命名）', click: () => win.webContents.send('fence:beginRename') });
  setTimeout(() => Menu.buildFromTemplate(tpl).popup({ window: win }), 120);
}

function setRolled(fence, rolled) {
  fence.rolledUp = !!rolled;
  applyFenceBounds(fence);
  pushFence(fence.id); save();
}

async function pickFolder(win, def) {
  const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, { title: '选择要镜像为围栏的文件夹', defaultPath: def || app.getPath('home'), properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
}
async function newPortalDialog(dir) {
  if (!dir) dir = await pickFolder(settingsWin);
  if (!dir) return null;
  return createFence({ name: path.basename(dir) || dir, type: 'portal', portalPath: dir, accent: '#0EA5E9' });
}

// ================= 框选创建（托盘/快捷键）=================
function startDrawMode() {
  closeOverlays();
  for (const d of screen.getAllDisplays()) {
    const o = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true, hasShadow: false,
      alwaysOnTop: true, show: false, enableLargerThanScreen: true, backgroundColor: '#00000000',
      webPreferences: { preload: PRELOAD, contextIsolation: true }
    });
    o.setAlwaysOnTop(true, 'screen-saver');
    o.loadFile(R('overlay.html'), { query: { display: String(d.id), first: overlays.length === 0 ? '1' : '0' } });
    o.once('ready-to-show', () => { o.show(); if (screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id === d.id) o.focus(); });
    o._display = d;
    overlays.push(o);
  }
}
function closeOverlays() { for (const o of overlays) { try { o.close(); } catch (e) { } } overlays = []; }

// ================= 右键拖拽选择框（钩子）=================
function physRectToDip(x0, y0, x1, y1) {
  const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
  try { return screen.screenToDipRect(null, r); } catch (e) { return r; }
}
function ensureSelectionWin() {
  if (selectionWin && !selectionWin.isDestroyed()) return selectionWin;
  selectionWin = new BrowserWindow({
    width: 10, height: 10, frame: false, transparent: true, resizable: false, skipTaskbar: true, focusable: false,
    hasShadow: false, show: false, alwaysOnTop: true, backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true }
  });
  selectionWin.setIgnoreMouseEvents(true);
  selectionWin.setAlwaysOnTop(true, 'screen-saver');
  selectionWin.loadFile(R('selection.html'));
  return selectionWin;
}
function onRDrag(m) {
  const r = physRectToDip(m.x0, m.y0, m.x, m.y);
  const sw = ensureSelectionWin();
  if (m.type === 'rdrag-end') {
    sw.hide();
    if (r.width >= 120 && r.height >= 70) {
      const f = createFence({ bounds: r });
      setTimeout(() => popupPresetMenu(f), 350);
    }
    return;
  }
  sw.setBounds({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(2, Math.round(r.width)), height: Math.max(2, Math.round(r.height)) });
  sw.webContents.send('sel:size', { w: Math.round(r.width), h: Math.round(r.height), ok: r.width >= 120 && r.height >= 70 });
  if (!sw.isVisible()) sw.showInactive();
}

// ================= 快速隐藏 =================
function setQuickHidden(v) {
  quickHidden = !!v;
  if (cfg.quickHide.hideIcons) { win32.setDesktopIconsVisible(!quickHidden); ds.setIconsHidden(quickHidden); }
  else if (!quickHidden && ds.journalIconsHidden()) { win32.setDesktopIconsVisible(true); ds.setIconsHidden(false); }
  // 保留图标区
  const keepId = '__keep';
  if (quickHidden && cfg.quickHide.excludes.length) {
    let vf = virtualFences.get(keepId);
    if (!vf) {
      const d = screen.getPrimaryDisplay().workArea;
      vf = normalizeFence({ id: keepId, name: '保留图标', type: 'normal', items: [], style: Object.assign({}, DEFAULT_STYLE, { accent: '#64748B', iconSize: 48 }), bounds: cfg.quickHide.keepBounds || { x: d.x + 24, y: d.y + 24, width: 300, height: 140 } });
      virtualFences.set(keepId, vf);
    }
    vf.items = cfg.quickHide.excludes.filter(p => fs.existsSync(p)).map(p => ds.newItem(p));
    if (!fenceWins.get(keepId)) createFenceWindow(vf); else pushFence(keepId);
  } else {
    const kw = fenceWins.get(keepId);
    if (kw && !kw.isDestroyed()) kw.close();
    virtualFences.delete(keepId);
  }
  refreshVisibility();
  updateTray();
  broadcastSettings();
}
function toggleQuickHide() { if (peekActive) { setPeek(false); return; } setQuickHidden(!quickHidden); }

// ================= 速览 =================
function setPeek(v) {
  if (peekActive === !!v) return;
  peekActive = !!v;
  for (const d of dimWins) { try { d.close(); } catch (e) { } }
  dimWins = [];
  if (peekActive) {
    if (cfg.peek.dim) {
      for (const d of screen.getAllDisplays()) {
        const o = new BrowserWindow({
          x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, frame: false, transparent: true,
          resizable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true, backgroundColor: '#00000000',
          webPreferences: { preload: PRELOAD, contextIsolation: true }
        });
        o.setAlwaysOnTop(true, 'floating');
        o.loadFile(R('dim.html'), { query: { opacity: String(cfg.peek.dimOpacity), hotkey: cfg.hotkeys.peek || '', theme: themeName() } });
        o.once('ready-to-show', () => { o.showInactive(); raisePeekFences(); });
        dimWins.push(o);
      }
    }
    raisePeekFences();
  } else {
    for (const [id, win] of fenceWins) {
      if (win.isDestroyed()) continue;
      win.setAlwaysOnTop(false);
      const h = win32.hwndFromBuffer(win.getNativeWindowHandle());
      win32.attachToDesktop(h);
      win32.sendToBottom(h);
    }
    refreshVisibility();
  }
  pushAll();
  updateTray();
}
// 速览：围栏必须稳定地位于调暗遮罩之上。
// 1) 速览期间暂时解除对 Progman 的所有者关系（被拥有的窗口无法越过其他置顶窗口）
// 2) 直接用 SetWindowPos(HWND_TOPMOST) 置顶，并在遮罩显示后多次补偿
function raiseOnce() {
  if (!peekActive) return;
  for (const [, win] of fenceWins) {
    if (win.isDestroyed()) continue;
    if (!win.isVisible()) win.showInactive();
    const h = win32.hwndFromBuffer(win.getNativeWindowHandle());
    win32.detachFromDesktop(h);
    win.setAlwaysOnTop(false);
    win.setAlwaysOnTop(true, 'screen-saver');
    try { win32.api.SetWindowPos(h, -1n /* HWND_TOPMOST */, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0040); } catch (e) { }
  }
}
function raisePeekFences() {
  if (!peekActive) return;
  raiseOnce();
  for (const t of [60, 200, 500]) setTimeout(raiseOnce, t);
  const first = fenceWins.values().next().value;
  if (first && !first.isDestroyed()) first.focus();
}
function togglePeek() { setPeek(!peekActive); }

// ================= 钩子进程 =================
let hookRestarts = 0;
function startHook() {
  if (NOHOOK) return;
  try {
    hookProc = fork(path.join(__dirname, 'hook.js').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep), [], {
      execPath: process.execPath,
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', ZT_JOURNAL: ds.journalPath(), ZT_DESKTOPS: ds.desktopDirs().join('|'), ZT_MAINPID: String(process.pid), ZT_HOOKLOG: SELFTEST ? path.join(path.resolve(SELFTEST), 'hook.log') : '' }),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
      detached: true   // 脱离 libuv 作业对象：主进程被强制结束后看门狗仍能存活并还原桌面
    });
  } catch (e) { hookStatus = { ok: false, error: e.message }; return; }
  hookProc.on('message', onHookMessage);
  hookProc.on('exit', () => {
    hookStatus = { ok: false };
    hookProc = null;
    if (!quitting && hookRestarts++ < 5) setTimeout(startHook, 1500);
  });
  sendHookConfig();
}
function sendHookConfig() {
  if (!hookProc) return;
  const hotkeys = [];
  for (const id of ['peek', 'quickHide', 'newFence']) if (cfg.hotkeys[id]) hotkeys.push({ id, combo: cfg.hotkeys[id] });
  try { hookProc.send({ type: 'config', config: { hotkeys, dblClick: !!cfg.quickHide.dblClick, rdrag: !!cfg.general.rightDragCreate } }); } catch (e) { }
}
function onHookMessage(m) {
  if (!m) return;
  switch (m.type) {
    case 'ready': hookStatus = { ok: m.keyboard && m.mouse, keyboard: m.keyboard, mouse: m.mouse }; broadcastSettings(); break;
    case 'hotkey':
      if (m.id === 'peek') togglePeek();
      else if (m.id === 'quickHide') toggleQuickHide();
      else if (m.id === 'newFence') startDrawMode();
      break;
    case 'dblclick': if (cfg.quickHide.dblClick && !peekActive) toggleQuickHide(); break;
    case 'rdrag-start': case 'rdrag-move': case 'rdrag-end': onRDrag(m); break;
    case 'deskdrop': if (activeDrag) activeDrag.deskDrop = true; if (SELFTEST) try { fs.appendFileSync(path.join(path.resolve(SELFTEST), 'hook.log'), 'deskdrop active=' + !!activeDrag + '\n'); } catch (e) { } break;
    case 'captured':
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('hotkey:captured', { id: captureTarget, combo: m.combo });
      captureTarget = null;
      break;
    case 'log': console.log('[hook]', m.msg); break;
  }
}

// ================= 设置窗口 =================
function openSettings(page, fenceId) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show(); settingsWin.focus();
    if (page) settingsWin.webContents.send('settings:goto', { page, fenceId });
    return settingsWin;
  }
  const dark = themeName() === 'dark';
  settingsWin = new BrowserWindow({
    width: 1080, height: 720, minWidth: 900, minHeight: 600, show: false, icon: ICON, title: 'ZTABLE 设置',
    titleBarStyle: 'hidden', titleBarOverlay: { color: dark ? '#202124' : '#F3F4F8', symbolColor: dark ? '#E6E6E6' : '#1F2430', height: 40 },
    backgroundColor: dark ? '#202124' : '#F3F4F8',
    webPreferences: { preload: PRELOAD, contextIsolation: true, spellcheck: false }
  });
  settingsWin.setMenu(null);
  if (SELFTEST || FLAG('debug')) settingsWin.webContents.on('console-message', (ev) => console.log('[settings]', ev.message, ev.lineNumber));
  settingsWin.loadFile(R('settings.html'), { query: { page: page || (cfg.general.firstRun ? 'welcome' : 'home'), fence: fenceId || '' } });
  settingsWin.once('ready-to-show', () => { if (!SELFTEST) settingsWin.show(); });
  settingsWin.on('closed', () => { settingsWin = null; if (captureTarget && hookProc) hookProc.send({ type: 'cancelCapture' }); captureTarget = null; });
  return settingsWin;
}
function displaysInfo() {
  const prim = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map(d => ({
    key: displayKey(d), id: d.id, label: d.label || ('显示器 ' + d.id), primary: d.id === prim,
    scale: d.scaleFactor, size: { w: Math.round(d.bounds.width * d.scaleFactor), h: Math.round(d.bounds.height * d.scaleFactor) },
    bounds: d.bounds, settings: displaySettings(d),
    fences: cfg.fences.filter(f => f.displayKey === displayKey(d)).length
  }));
}
function settingsPayload() {
  return {
    cfg, version: VERSION, theme: themeName(), displays: displaysInfo(), hook: hookStatus, caps, softRender: fs.existsSync(NO_GPU_FLAG), storeRoot: ds.storeRoot(cfg),
    state: { quickHidden, peekActive },
    paths: {
      desktop: ds.userDesktop(), downloads: app.getPath('downloads'), documents: app.getPath('documents'),
      pictures: app.getPath('pictures'), videos: app.getPath('videos'), music: app.getPath('music'),
      onedrive: process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial || '', userData: app.getPath('userData')
    },
    presets: Object.keys(PRESETS).map(k => ({ key: k, name: PRESETS[k].name, accent: PRESETS[k].accent, icon: PRESETS[k].icon })),
    stats: { fences: cfg.fences.length, items: cfg.fences.reduce((a, f) => a + (f.type === 'normal' ? f.items.length : 0), 0), rules: cfg.rules.length, hidden: cfg.hidden.length,
      stowed: cfg.fences.reduce((a, f) => a + (f.type === 'normal' ? f.items.filter(i => i.origin).length : 0), 0) }
  };
}
let bcTimer = null;
function broadcastSettings() {
  clearTimeout(bcTimer);
  bcTimer = setTimeout(() => { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('cfg:changed', settingsPayload()); }, 60);
}

function setByPath(obj, p, v) {
  const parts = p.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null) o[parts[i]] = {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = v;
}

function applyConfigSideEffects(key) {
  if (key.startsWith('hotkeys') || key.startsWith('quickHide.dblClick') || key.startsWith('general.rightDragCreate')) sendHookConfig();
  if (key === 'general.theme') { nativeTheme.themeSource = cfg.general.theme; pushAll(); updateSettingsChrome(); }
  if (key === 'general.autoStart') applyAutoStart();
  if (key === 'general.watchDownloads') watcher && watcher.start(cfg);
  if (key.startsWith('displays.')) { for (const f of cfg.fences) applyFenceBounds(f); refreshVisibility(); pushAll(); }
  if (key.startsWith('quickHide.') && quickHidden) setQuickHidden(true);
  if (key === 'general.stowMode') migrateStowMode();
}
// 切换收纳方式：先把所有项目还原到桌面原状，再按新模式重新收纳
function migrateStowMode() {
  try { ds.restoreAll(); } catch (e) { }      // 取消所有隐藏属性
  for (const f of cfg.fences) {
    if (f.type !== 'normal') continue;
    for (const it of f.items) {
      if (it.origin && !it.inPlace && !ds.isDesktopPath(it.path)) {   // move 模式遗留：文件在收纳文件夹
        const r = ds.returnToDesktop(cfg, it);
        if (r.ok) { it.path = r.path; it.name = path.basename(r.path); }
      }
      delete it.inPlace; delete it.parked; delete it.origin; delete it.originDir;
    }
    ds.cleanupStoreDir(f);
  }
  ds.refreshDesktop();
  stowAllOnStartup();                         // 按新模式重新收纳
  store.save(true); pushAll(); broadcastSettings();
  scheduleReconcile(200);
  notify('ZTABLE', ds.stowMode(cfg) === 'inPlace' ? '已切换为「原位收纳」：文件留在桌面原路径，只隐藏桌面图标' : '已切换为「移入收纳文件夹」');
}
function updateSettingsChrome() {
  if (!settingsWin || settingsWin.isDestroyed()) return;
  const dark = themeName() === 'dark';
  try { settingsWin.setTitleBarOverlay({ color: dark ? '#202124' : '#F3F4F8', symbolColor: dark ? '#E6E6E6' : '#1F2430' }); } catch (e) { }
  settingsWin.setBackgroundColor(dark ? '#202124' : '#F3F4F8');
}
function applyAutoStart() {
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!cfg.general.autoStart, path: process.execPath, args: ['--autostart'], name: 'ZTABLE' }); } catch (e) { }
}

// ================= IPC =================
function fenceFromEvent(e, id) { return getFence(id); }
function winFromEvent(e) { return BrowserWindow.fromWebContents(e.sender); }

const drag = new Map();

// ================= 图标拖拽（系统原生 OLE 拖放） =================
let activeDrag = null;
const sameSet = (a, b) => a.length === b.length && a.every(x => b.some(y => y.toLowerCase() === x.toLowerCase()));
function broadcastDrag(on) { for (const [, w] of fenceWins) { if (!w.isDestroyed()) w.webContents.send('drag:state', on); } }
function cursorOverFence() {
  const c = screen.getCursorScreenPoint();
  for (const [, win] of fenceWins) {
    if (win.isDestroyed() || !win.isVisible()) continue;
    const b = win.getBounds();
    if (c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height) return true;
  }
  return false;
}
function cursorOverDesktop() {
  let c = screen.getCursorScreenPoint();
  try { c = screen.dipToScreenPoint(c); } catch (e) { }
  return win32.isDesktopAt({ x: Math.round(c.x), y: Math.round(c.y) });
}
function startItemDrag(sender, id, paths) {
  if (activeDrag) return;                               // 同一时刻只允许一个拖放会话
  const f = getFence(id);
  const list = (paths || []).filter(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!f || !list.length || sender.isDestroyed()) { broadcastDrag(false); return; }
  let icon = null;
  try { icon = icons.microIcon(list[0]); } catch (e) { }
  if (!icon || icon.isEmpty()) icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'mark128.png')).resize({ width: 48, height: 48 });
  const session = activeDrag = { fromId: id, paths: list, handled: false, startedAt: Date.now(), deskSnap: desktopSnapshot() };
  broadcastDrag(true);
  // 让钩子在「松开于桌面空白处」时取消这次系统拖放（否则资源管理器会尝试把桌面文件移动到它自己所在的桌面，
  // 弹出「源文件名和目标文件名相同」）；Esc 取消需要拖放源窗口拥有键盘焦点
  const srcWin = BrowserWindow.fromWebContents(sender);
  try { if (srcWin && !srcWin.isFocused()) srcWin.focus(); } catch (e) { }
  const hookDrag = (on) => { if (!app.isPackaged && process.env.ZT_NO_DESKFIX) return; try { if (hookProc && hookProc.connected) hookProc.send({ type: 'oleDrag', on }); } catch (e) { } };
  hookDrag(true);
  try {
    sender.startDrag(list.length > 1 ? { files: list, file: list[0], icon } : { file: list[0], icon });
  } catch (e) {
    console.error('startDrag failed', e);
    hookDrag(false);
    activeDrag = null; broadcastDrag(false); return;
  }
  // Windows 上 startDrag 通常阻塞到放下为止；为兼容非阻塞实现，再轮询一次鼠标左键状态
  const finish = () => {
    if (activeDrag !== session) return;
    hookDrag(false);
    setTimeout(() => {
      try { onItemDragEnd(session); } catch (e) { console.error(e); }
      if (activeDrag === session) activeDrag = null;
      broadcastDrag(false);
    }, 250);
  };
  const t0 = Date.now();
  const poll = () => {
    if (activeDrag !== session) return;
    const down = (win32.api.GetAsyncKeyState(0x01) & 0x8000) !== 0;
    if (!down || Date.now() - t0 > 60000) finish(); else setTimeout(poll, 40);
  };
  poll();
}
function fenceAtCursor(exceptId) {
  const c = screen.getCursorScreenPoint();
  for (const [id, win] of fenceWins) {
    if (id === exceptId || win.isDestroyed() || !win.isVisible()) continue;
    const b = win.getBounds();
    if (c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height) return id;
  }
  return null;
}
function onItemDragEnd(session) {
  const over = fenceAtCursor();
  if (!session.handled && over) {
    // 落在另一个围栏：跨围栏移动（不依赖网页拖放事件，原生 OLE 拖放结束事件在部分环境下不派发）
    const src = getFence(session.fromId), dst = getFence(over);
    if (src && dst && dst.type === 'normal' && !virtualFences.has(dst.id)) {
      const existing = session.paths.filter(p => fs.existsSync(p));
      if (existing.length) { addItems(dst, existing); session.handled = true; }
    } else if (src && dst && dst.type === 'portal' && !virtualFences.has(dst.id)) {
      copyIntoPortal(dst, session.paths.filter(p => fs.existsSync(p)));
      session.handled = true;
    }
  }
  const f = getFence(session.fromId);
  if (!f || session.handled) return;
  if (f.type !== 'normal' || virtualFences.has(f.id)) return;
  const items = f.items.filter(it => session.paths.some(p => p.toLowerCase() === it.path.toLowerCase()));
  const onDesktop = !over && (session.deskDrop || cursorOverDesktop());
  // 原位模式：文件始终在桌面，拖出围栏 = 移出并让图标重新出现，无需任何文件移动
  if (ds.stowMode(cfg) === 'inPlace') {
    const removeList = [];
    for (const it of items) {
      if (!fs.existsSync(it.path)) removeList.push(it.path);     // 被拖进资源管理器移走
      else if (onDesktop) removeList.push(it.path);              // 拖回桌面空白处
    }
    if (removeList.length) {
      for (const p of removeList) suppressAuto.set(path.basename(p).toLowerCase(), Date.now());
      removeItems(f, removeList);
    }
    return;
  }
  const fresh = desktopNewEntries(session.deskSnap);          // 拖拽期间桌面上新出现的文件（资源管理器复制/建链接）
  const gone = [], back = [], dupDone = [];
  for (const it of items) {
    // 1) 资源管理器已把文件移走（拖到桌面或其他文件夹）→ 围栏中移除即可
    if (!fs.existsSync(it.path)) { gone.push(it.path); continue; }
    const name = path.basename(it.path), ext = path.extname(name).toLowerCase(), stem = path.basename(name, path.extname(name)).toLowerCase();
    const related = fresh.filter(e => path.basename(e).toLowerCase().startsWith(stem));
    // 2) 资源管理器在桌面上复制了一份 → 收纳文件夹里的原件作废，桌面那份即为放回的文件
    let st = null; try { st = fs.statSync(it.path); } catch (e) { }
    const copy = related.find(e => { try { const s2 = fs.statSync(e); return path.extname(e).toLowerCase() === ext && s2.isDirectory() === st.isDirectory() && (st.isDirectory() || s2.size === st.size); } catch (err) { return false; } });
    if (copy) {
      if (it.origin) shell.trashItem(it.path).catch(() => { });  // 放进回收站而不是直接删除，留后悔余地
      dupDone.push(it.path);
      continue;
    }
    // 3) 拖到桌面空白处（或只建了快捷方式链接）→ 由 ZTABLE 自己移回桌面
    if (onDesktop || related.length) {
      for (const e of related) if (/\.lnk$/i.test(e) && !/\.lnk$/i.test(name)) shell.trashItem(e).catch(() => { });
      if (it.origin) back.push(it.path);
    }
  }
  const all = gone.concat(dupDone, back);
  if (!all.length) return;
  for (const p of all) suppressAuto.set(path.basename(p).toLowerCase(), Date.now());
  if (gone.length || dupDone.length) removeItems(f, gone.concat(dupDone), { noReturn: true });
  if (back.length) removeItems(f, back);
}
function desktopSnapshot() {
  const set = new Set();
  for (const d of ds.desktopDirs()) { try { for (const n of fs.readdirSync(d)) set.add(path.join(d, n).toLowerCase()); } catch (e) { } }
  return set;
}
function desktopNewEntries(snap) {
  const out = [];
  if (!snap) return out;
  for (const d of ds.desktopDirs()) { try { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (!snap.has(p.toLowerCase())) out.push(p); } } catch (e) { } }
  return out;
}
// 拖出到桌面的文件短时间内不要再被自动归类规则吸回围栏
const suppressAuto = new Map();
function isAutoSuppressed(p) {
  if (ds.isReturned(p)) return true;
  const k = path.basename(p).toLowerCase();
  const t = suppressAuto.get(k);
  if (t && Date.now() - t < 8000) return true;
  if (t) suppressAuto.delete(k);
  return false;
}
function setupIpc() {
  ipcMain.handle('fence:init', (e, id) => { const f = getFence(id); return f ? fenceState(f) : null; });
  ipcMain.handle('icon:get', (e, p) => icons.getIcon(p));
  ipcMain.handle('fence:open', (e, id, p) => openItem(getFence(id), p));
  ipcMain.handle('fence:portalUp', (e, id) => {
    const f = getFence(id); if (!f) return;
    const cwd = portalCwd.get(id) || f.portalPath;
    const up = path.dirname(cwd);
    if (path.resolve(cwd).toLowerCase() === path.resolve(f.portalPath).toLowerCase()) return;
    if (path.resolve(up).toLowerCase() === path.resolve(f.portalPath).toLowerCase()) portalCwd.delete(id); else portalCwd.set(id, up);
    startPortalWatch(f); pushFence(id);
  });
  ipcMain.handle('fence:portalRoot', (e, id) => { const f = getFence(id); if (!f) return; portalCwd.delete(id); startPortalWatch(f); pushFence(id); });
  ipcMain.handle('fence:openFolder', (e, id) => { const f = getFence(id); if (f) shell.openPath(portalCwd.get(id) || f.portalPath); });

  // 拖动/缩放（以主进程光标坐标为准，跨显示器 DPI 一致）
  ipcMain.on('fence:dragStart', (e, id, edge) => {
    const f = getFence(id), win = fenceWins.get(id);
    if (!f || !win || (f.locked && !virtualFences.has(id))) return;
    drag.set(id, { edge: edge || 'move', cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() });
  });
  ipcMain.on('fence:dragMove', (e, id) => {
    const st = drag.get(id), win = fenceWins.get(id), f = getFence(id);
    if (!st || !win || !f) return;
    const c = screen.getCursorScreenPoint();
    const dx = c.x - st.cursor.x, dy = c.y - st.cursor.y;
    const b = Object.assign({}, st.bounds);
    const e_ = st.edge;
    if (e_ === 'move') { b.x += dx; b.y += dy; }
    else {
      if (e_.includes('e')) b.width = Math.max(140, st.bounds.width + dx);
      if (e_.includes('s')) b.height = Math.max(70, st.bounds.height + dy);
      if (e_.includes('w')) { const nw = Math.max(140, st.bounds.width - dx); b.x = st.bounds.x + st.bounds.width - nw; b.width = nw; }
      if (e_.includes('n')) { const nh = Math.max(70, st.bounds.height - dy); b.y = st.bounds.y + st.bounds.height - nh; b.height = nh; }
    }
    const sb = snapBounds(f, b, e_ === 'move' ? 'move' : 'resize');
    win.setBounds({ x: Math.round(sb.x), y: Math.round(sb.y), width: Math.round(sb.width), height: Math.round(sb.height) });
  });
  ipcMain.on('fence:dragEnd', (e, id) => {
    const st = drag.get(id); drag.delete(id);
    const win = fenceWins.get(id), f = getFence(id);
    if (!st || !win || !f) return;
    const b = win.getBounds();
    const oldKey = f.displayKey;
    if (f.rolledUp) b.height = f.bounds.height;
    if (virtualFences.has(id)) { cfg.quickHide.keepBounds = b; store.save(); return; }
    rememberBounds(f, b);
    if (oldKey !== f.displayKey) { applyFenceBounds(f); pushFence(id); }
    save();
  });
  ipcMain.handle('fence:rollup', (e, id, rolled) => { const f = getFence(id); if (f) setRolled(f, rolled); });
  ipcMain.handle('fence:rename', (e, id, name) => {
    const f = getFence(id); if (!f) return;
    name = String(name || '').trim().slice(0, 60);
    if (name) { f.name = name; const win = fenceWins.get(id); if (win) win.setTitle('ZTABLE · ' + name); }
    pushFence(id); save();
  });
  ipcMain.handle('fence:menu', (e, id) => { const f = getFence(id); if (f) popupFenceMenu(winFromEvent(e), f); });
  ipcMain.handle('item:menu', (e, id, paths) => { const f = getFence(id); if (f && paths && paths.length) popupItemMenu(winFromEvent(e), f, paths); });
  ipcMain.handle('fence:dropInternal', (e, id, data) => {
    const f = getFence(id); if (!f || !data) return;
    if (f.type === 'portal') return copyIntoPortal(f, data.paths);
    if (data.fromId === id) return reorder(f, data.paths, data.before);
    const from = getFence(data.fromId);
    if (from && from.type === 'normal' && !virtualFences.has(from.id)) {
      from.items = from.items.filter(i => !data.paths.some(p => p.toLowerCase() === i.path.toLowerCase()));
      pushFence(from.id);
    }
    addItems(f, data.paths, data.before);
  });
  ipcMain.handle('fence:dropFiles', (e, id, data) => {
    const f = getFence(id); if (!f || !data || !data.paths) return;
    const paths = data.paths.filter(Boolean);
    const internal = activeDrag && sameSet(activeDrag.paths, paths) ? activeDrag : null;
    if (internal) internal.handled = true;
    if (f.type === 'portal') {
      if (internal && internal.fromId === id) return;           // 门户内拖动：不复制
      return copyIntoPortal(f, paths);
    }
    if (virtualFences.has(id)) { cfg.quickHide.excludes = Array.from(new Set(cfg.quickHide.excludes.concat(paths))); setQuickHidden(true); save(); return; }
    const known = new Set(f.items.map(i => i.path.toLowerCase()));
    if (paths.every(p => known.has(p.toLowerCase()))) return reorder(f, paths, data.before);   // 同一围栏内调整顺序
    addItems(f, paths, data.before);                            // 其他围栏 / 资源管理器拖入（addItems 会从原围栏移除）
  });
  ipcMain.on('item:startDrag', (e, id, paths) => startItemDrag(e.sender, id, paths));
  ipcMain.handle('fence:removeItems', (e, id, paths) => { const f = getFence(id); if (f && f.type === 'normal') removeItems(f, paths); });
  ipcMain.handle('app:exitPeek', () => setPeek(false));
  ipcMain.handle('app:togglePeek', () => togglePeek());

  // 框选覆盖层
  ipcMain.handle('overlay:done', (e, data) => {
    const o = overlays.find(x => x.webContents === e.sender);
    const d = o ? o._display : screen.getPrimaryDisplay();
    closeOverlays();
    if (!data || data.width < 120 || data.height < 70) return;
    const f = createFence({ bounds: { x: d.bounds.x + data.x, y: d.bounds.y + data.y, width: data.width, height: data.height } });
    setTimeout(() => popupPresetMenu(f), 400);
  });
  ipcMain.handle('overlay:cancel', () => closeOverlays());

  // 设置
  ipcMain.handle('cfg:get', () => settingsPayload());
  ipcMain.handle('cfg:set', (e, key, value) => {
    setByPath(cfg, key, value);
    applyConfigSideEffects(key);
    save();
    return settingsPayload();
  });
  ipcMain.handle('fence:update', (e, id, patch) => {
    const f = getFence(id); if (!f || !patch) return;
    if (patch.style) Object.assign(f.style, patch.style);
    for (const k of ['name', 'locked', 'keepOnQuickHide', 'portalPath']) if (k in patch) f[k] = patch[k];
    if ('rolledUp' in patch) setRolled(f, patch.rolledUp);
    if (patch.bounds) { rememberBounds(f, Object.assign({}, f.bounds, patch.bounds)); applyFenceBounds(f); }
    if ('portalPath' in patch) { portalCwd.delete(id); startPortalWatch(f); }
    if (patch.style && ('titleSize' in patch.style) && f.rolledUp) applyFenceBounds(f);
    const win = fenceWins.get(id); if (win && patch.name) win.setTitle('ZTABLE · ' + f.name);
    pushFence(id); save();
  });
  ipcMain.handle('fence:styleAll', (e, style) => {
    for (const f of cfg.fences) { const accent = f.style.accent; Object.assign(f.style, style); f.style.accent = accent; pushFence(f.id); if (f.rolledUp) applyFenceBounds(f); }
    save();
  });
  ipcMain.handle('fence:create', (e, opts) => createFence(opts || {}).id);
  ipcMain.handle('fence:delete', (e, id) => deleteFence(id));
  ipcMain.handle('fence:flash', (e, id) => {
    const win = fenceWins.get(id); if (!win) return;
    if (!win.isVisible()) win.showInactive();
    win.webContents.send('fence:flash');
  });
  ipcMain.handle('display:set', (e, key, patch) => {
    cfg.displays[key] = Object.assign({ iconScale: 1, fontScale: 1, showFences: true }, cfg.displays[key] || {}, patch || {});
    for (const f of cfg.fences) applyFenceBounds(f);
    refreshVisibility(); pushAll(); save();
    return settingsPayload();
  });
  ipcMain.handle('rules:set', (e, rules) => { cfg.rules = Array.isArray(rules) ? rules : []; save(); });
  ipcMain.handle('cmd', async (e, name, arg) => {
    switch (name) {
      case 'organize': return organizeNow(false);
      case 'oneClick': { cfg.general.firstRun = false; const r = oneClickSetup(); save(); return r; }
      case 'blankStart': cfg.general.firstRun = false; save(); return true;
      case 'drawFence': startDrawMode(); return true;
      case 'newFence': return createFence({}).id;
      case 'newPortal': { const f = await newPortalDialog(arg); return f ? f.id : null; }
      case 'pickFolder': return pickFolder(BrowserWindow.getFocusedWindow() || settingsWin, arg);
      case 'pickFiles': {
        const r = await dialog.showOpenDialog(settingsWin, { title: '选择文件', defaultPath: arg || ds.userDesktop(), properties: ['openFile', 'multiSelections'] });
        return r.canceled ? [] : r.filePaths;
      }
      case 'quickHide': toggleQuickHide(); return quickHidden;
      case 'peek': togglePeek(); return peekActive;
      case 'restoreIcons': { const n = ds.restoreAll(); win32.setDesktopIconsVisible(true); save(); notify('ZTABLE', '已恢复 ' + n + ' 个桌面图标的显示'); ds.syncHidden(cfg.fences, false); return n; }
      case 'resync': stowAllOnStartup(); store.save(true); pushAll(); return true;
      case 'returnAll': {
        const r = dialog.showMessageBoxSync(settingsWin, { type: 'question', buttons: ['全部放回桌面', '取消'], defaultId: 1, cancelId: 1, title: 'ZTABLE', message: '把所有围栏里的项目放回桌面？', detail: '来自桌面的文件会移回桌面，围栏会被清空（围栏本身保留）。' });
        if (r !== 0) return null;
        const res = returnAllToDesktop(false); store.save(true); pushAll(); broadcastSettings();
        notify('ZTABLE', '已放回桌面 ' + res.n + ' 个项目' + (res.failed ? '，' + res.failed + ' 个失败' : ''));
        return res;
      }
      case 'openStore': { const d = ds.storeRoot(cfg); try { fs.mkdirSync(d, { recursive: true }); } catch (e) { } shell.openPath(d); return true; }
      case 'openConfigDir': shell.openPath(app.getPath('userData')); return true;
      case 'openPath': shell.openPath(arg); return true;
      case 'openUrl': if (/^https?:/.test(arg)) shell.openExternal(arg); return true;
      case 'exportConfig': {
        const r = await dialog.showSaveDialog(settingsWin, { title: '导出 ZTABLE 配置', defaultPath: path.join(app.getPath('documents'), 'ZTABLE-配置.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (!r.canceled) fs.writeFileSync(r.filePath, JSON.stringify(cfg, null, 2), 'utf8');
        return !r.canceled;
      }
      case 'importConfig': {
        const r = await dialog.showOpenDialog(settingsWin, { title: '导入 ZTABLE 配置', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
        if (r.canceled) return false;
        try {
          const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
          if (!Array.isArray(data.fences)) throw new Error('格式不正确');
          for (const win of fenceWins.values()) win.close();
          ds.restoreAll();
          const hiddenRef = cfg.hidden;
          store.data = Object.assign(store.data, data, { hidden: hiddenRef });
          cfg = store.data;
          cfg.fences.forEach(normalizeFence);
          ds.setCtx(store);
          ds.syncHidden(cfg.fences, false); stowAllOnStartup();
          for (const f of cfg.fences) createFenceWindow(f);
          sendHookConfig(); save();
          return true;
        } catch (err) { dialog.showErrorBox('导入失败', String(err.message || err)); return false; }
      }
      case 'captureHotkey': captureTarget = arg; if (hookProc) hookProc.send({ type: 'capture' }); return !!hookProc;
      case 'cancelCapture': captureTarget = null; if (hookProc) hookProc.send({ type: 'cancelCapture' }); return true;
      case 'validateHotkey': return !!hk.parse(arg);
      case 'softRender': {
        try { if (arg) fs.writeFileSync(NO_GPU_FLAG, 'user'); else if (fs.existsSync(NO_GPU_FLAG)) fs.unlinkSync(NO_GPU_FLAG); } catch (err) { }
        const r = dialog.showMessageBoxSync(settingsWin, { type: 'info', buttons: ['立即重启', '稍后'], defaultId: 0, title: 'ZTABLE', message: arg ? '已开启兼容模式（软件渲染）' : '已关闭兼容模式', detail: '需要重启 ZTABLE 生效。' });
        if (r === 0) { restoreEverything(); app.relaunch({ args: process.argv.slice(1).filter(a => a !== '--soft') }); app.exit(0); }
        return true;
      }
      case 'readPrivacy': return fs.readFileSync(path.join(ROOT, 'assets', 'privacy.md'), 'utf8');
      case 'quit': app.quit(); return true;
    }
    return null;
  });
}

// 把所有围栏里来自桌面的项目移回桌面
//  keepInFence=true ：退出时使用，条目留在围栏（标记 parked），下次启动自动收回
//  keepInFence=false：用户选择「全部放回桌面」/卸载，条目从围栏移除
function returnAllToDesktop(keepInFence) {
  let n = 0, failed = 0;
  for (const f of cfg.fences) {
    if (f.type !== 'normal') continue;
    const keep = [];
    for (const it of f.items) {
      if (!it.origin) { if (keepInFence) keep.push(it); continue; }
      const r = ds.returnToDesktop(cfg, it);
      if (r.ok) { n++; if (keepInFence) { it.path = r.path; it.parked = true; keep.push(it); } }
      else if (r.gone) { if (keepInFence) keep.push(it); }
      else { failed++; keep.push(it); }
    }
    f.items = keep;
    if (!keepInFence) ds.cleanupStoreDir(f);
  }
  if (n) ds.refreshDesktop();
  return { n, failed };
}
// 启动时：把上次退出时放回桌面的（或旧版「隐藏」模式留下的）桌面项目重新收进围栏
function stowAllOnStartup() {
  const map = ds.takeReturnedMap();          // 看门狗在崩溃时放回桌面的记录
  if (map.length) {
    for (const f of cfg.fences) for (const it of f.items) {
      const m = map.find(x => x.from.toLowerCase() === String(it.path).toLowerCase());
      if (m) { it.path = m.to; it.parked = true; }
    }
  }
  const failed = [];
  for (const f of cfg.fences) {
    if (f.type !== 'normal') continue;
    f.items = f.items.map(it => {
      let p = it.path;
      if (!fs.existsSync(p) && it.origin && fs.existsSync(it.origin)) p = it.origin;
      // 桌面项目 → 原位收纳；旧版移动到收纳文件夹的项目 → 迁回桌面再原位收纳
      if ((!ds.isDesktopPath(p) && !ds.isInStore(cfg, p)) || !fs.existsSync(p)) return it;
      const st = ds.stowPath(cfg, f, p, it);
      if (st.error) failed.push({ p, e: st.error });
      return st.item;
    });
  }
  reportStowFailures(failed);
}
function removeAllHiddenNow() {
  const n = ds.restoreAll();
  try { win32.setDesktopIconsVisible(true); ds.setIconsHidden(false); } catch (e) { }
  ds.refreshDesktop();
  save(); pushAll();
  notify('ZTABLE', '桌面图标显示已恢复' + (n ? '（' + n + ' 个）' : ''));
}

// ================= 托盘 =================
function updateTray() {
  if (!tray) return;
  const tpl = [
    { label: 'ZTABLE ' + VERSION, enabled: false },
    { type: 'separator' },
    { label: '新建围栏（框选）', click: () => startDrawMode() },
    { label: '新建文件夹门户…', click: () => newPortalDialog() },
    { label: '按规则整理桌面', click: () => organizeNow(false) },
    { type: 'separator' },
    { label: quickHidden ? '显示桌面图标与围栏' : '快速隐藏桌面', click: () => toggleQuickHide() },
    { label: (peekActive ? '退出速览' : '速览围栏') + (cfg.hotkeys.peek ? '\t' + cfg.hotkeys.peek : ''), click: () => togglePeek() },
    { type: 'separator' },
    { label: '设置…', click: () => openSettings() },
    { label: '恢复显示桌面图标', click: () => { removeAllHiddenNow(); } },
    { label: '退出 ZTABLE（图标放回桌面）', click: () => app.quit() }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(tpl));
  tray.setToolTip('ZTABLE 桌面整理' + (quickHidden ? '（已快速隐藏）' : ''));
}
function createTray() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png'));
  tray = new Tray(img.isEmpty() ? ICON : img);
  tray.on('double-click', () => openSettings());
  tray.on('click', () => openSettings());
  updateTray();
}

// ================= 文件变化 =================
const recentRemoved = [];
function onFsChanged(ev) {
  if (ev.type === 'auto') {
    pushFence(ev.fenceId); save();
    if (ev.from === 'downloads') {
      const f = getFence(ev.fenceId);
      notify('已归入「' + (f ? f.name : '') + '」', path.basename(ev.path));
    }
  } else if (ev.type === 'removed') {
    for (const f of cfg.fences) {
      if (f.type !== 'normal') continue;
      const idx = f.items.findIndex(i => i.path.toLowerCase() === ev.path.toLowerCase());
      if (idx >= 0) {
        recentRemoved.push({ fenceId: f.id, path: ev.path, at: Date.now(), idx });
        setTimeout(() => {
          const r = recentRemoved.find(x => x.path === ev.path);
          if (!r) return;
          recentRemoved.splice(recentRemoved.indexOf(r), 1);
          if (!fs.existsSync(ev.path)) {
            f.items = f.items.filter(i => i.path.toLowerCase() !== ev.path.toLowerCase());
            ds.forgetHidden(ev.path);
            pushFence(f.id); save();
          }
        }, 2500);
      }
    }
  } else if (ev.type === 'new') {
    // 重命名配对：同目录 3 秒内消失的围栏项目
    const dir = path.dirname(ev.path).toLowerCase();
    const r = recentRemoved.find(x => path.dirname(x.path).toLowerCase() === dir && Date.now() - x.at < 3000 && !fs.existsSync(x.path));
    if (r) {
      recentRemoved.splice(recentRemoved.indexOf(r), 1);
      const f = getFence(r.fenceId);
      if (f) {
        const it = f.items.find(i => i.path.toLowerCase() === r.path.toLowerCase());
        if (it) { it.path = ev.path; it.name = path.basename(ev.path); }
        ds.renameHidden(r.path, ev.path);
        icons.invalidate(ev.path);
        pushFence(f.id); save();
      }
    }
  }
}

// ================= 生命周期 =================
let restored = false;
function restoreEverything() {
  if (restored) return;
  restored = true;
  try { if (quickHidden || ds.journalIconsHidden()) win32.setDesktopIconsVisible(true); } catch (e) { }
  quickHidden = false;
  try { ds.setIconsHidden(false); } catch (e) { }
  try { if (watcher) watcher.stop(); } catch (e) { }
  // 「退出时放回桌面」开启（默认）→ 取消隐藏 / 把文件移回桌面；关闭 → 保持收纳状态
  if (!cfg || cfg.general.returnOnQuit !== false) {
    try { ds.restoreAll(); } catch (e) { }
    try { if (cfg) returnAllToDesktop(true); } catch (e) { }
  }
  try { ds.refreshDesktop(); } catch (e) { }
  try { store.save(true); } catch (e) { }
}
process.on('uncaughtException', (err) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), new Date().toISOString() + ' ' + (err && err.stack || err) + '\n'); } catch (e) { } });

app.on('second-instance', (e, argv) => {
  if (argv.includes('--restore')) { quitting = true; try { returnAllToDesktop(false); } catch (e) { } restoreEverything(); app.exit(0); return; }
  openSettings();
});

app.on('before-quit', () => {
  quitting = true;
  if (peekActive) { try { setPeek(false); } catch (e) { } }
  restoreEverything();
  if (hookProc) { try { hookProc.send({ type: 'quit' }); } catch (e) { } }
});
app.on('will-quit', () => restoreEverything());
app.on('window-all-closed', (e) => { /* 常驻托盘 */ });

app.whenReady().then(async () => {
  cfg = store.load();
  ds.setCtx(store);

  if (FLAG('restore')) {
    try { if (ds.journalIconsHidden()) win32.setDesktopIconsVisible(true); } catch (e) { }
    ds.setIconsHidden(false); ds.restoreAll();
    try { returnAllToDesktop(false); } catch (e) { }       // 卸载：收纳的项目全部放回桌面
    ds.refreshDesktop(); store.save(true); app.exit(0); return;
  }

  if (!caps.supported && !cfg.general.osWarned) {
    dialog.showMessageBoxSync({ type: 'warning', title: 'ZTABLE', icon: ICON, message: '当前系统版本较低（' + caps.label + '）', detail: 'ZTABLE 适配 Windows 10 1903 及以上和 Windows 11，在当前系统上部分功能可能异常。', buttons: ['继续'] });
    cfg.general.osWarned = true;
  }
  nativeTheme.themeSource = cfg.general.theme;
  nativeTheme.on('updated', () => { pushAll(); updateSettingsChrome(); broadcastSettings(); });
  ensureDisplays();
  if (SELFTEST && !QUITTEST && !RESTARTTEST && !DESKDROPTEST && !app.isPackaged) await require('./selftest').prepare({ cfg, store, ds, createFence: (o) => createFence(o), PRESETS, applyPreset, dir: SELFTEST });
  // 上次异常退出时由我们关掉的「显示桌面图标」先恢复
  try { if (ds.journalIconsHidden()) { win32.setDesktopIconsVisible(true); ds.setIconsHidden(false); } } catch (e) { }
  // 1.0.1 起不再「隐藏」：先把旧版本隐藏的属性全部取消，再把桌面项目真实收进围栏
  cfg.general.hideOriginals = false;
  ds.syncHidden(cfg.fences, false);
  stowAllOnStartup();
  store.save(true);
  setupIpc();
  for (const f of cfg.fences) if (!fenceWins.has(f.id)) createFenceWindow(f);
  if (!SELFTEST) createTray();
  applyAutoStart();
  startHook();
  watcher = ds.makeWatcher(() => cfg, onFsChanged, isAutoSuppressed);
  if (!SELFTEST) watcher.start(cfg);
  if (!SELFTEST) { scheduleReconcile(1500); startIconWatch(); }   // 原位模式：隐藏已收进围栏的桌面图标

  const onDisplays = () => { ensureDisplays(); for (const f of cfg.fences) applyFenceBounds(f); refreshVisibility(); pushAll(); broadcastSettings(); };
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);
  screen.on('display-metrics-changed', () => setTimeout(onDisplays, 300));

  // Explorer 重启后重新挂到桌面
  setInterval(() => {
    const pm = win32.findProgman();
    if (pm && pm !== lastProgman) {
      lastProgman = pm;
      for (const [, win] of fenceWins) { if (!win.isDestroyed()) win32.attachToDesktop(win32.hwndFromBuffer(win.getNativeWindowHandle())); }
      refreshVisibility();
    }
  }, 4000);

  store.save();
  if (DESKDROPTEST && !app.isPackaged) { require('./selftest').deskDrop({ app, cfg, dir: DESKDROPTEST, fenceWins, createFence: (o) => createFence(o), ds, win32 }); return; }
  if (RESTARTTEST && !app.isPackaged) { require('./selftest').restartCheck({ app, cfg, dir: RESTARTTEST }); return; }
  if (QUITTEST && !app.isPackaged) { require('./selftest').quitTest({ app, cfg, dir: QUITTEST, store, ds, createFence: (o) => createFence(o), removeItems, deleteFence, save: () => store.save(true) }); return; }
  if (DRAGTEST && !app.isPackaged) { require('./selftest').dragPrep({ app, fenceWins, setPeek, cfg, dir: DRAGTEST }); return; }
  if (LIVETEST && !app.isPackaged) { require('./selftest').live({ app, fenceWins, setPeek, cfg, dir: SELFTEST, win32, hookStatus: () => hookStatus }); return; }
  if (SELFTEST && !app.isPackaged) { require('./selftest').run({ app, fenceWins, openSettings, setPeek, startDrawMode, cfg, dir: SELFTEST, getSettings: () => settingsWin, setQuickHidden }); return; }
  if (cfg.general.firstRun || !FLAG('autostart')) openSettings(cfg.general.firstRun ? 'welcome' : null);
});
