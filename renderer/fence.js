'use strict';
/* global zt */
const ID = new URLSearchParams(location.search).get('id');
const el = (id) => document.getElementById(id);
const root = el('root'), grid = el('grid'), titleBar = el('title');

let S = null;            // fenceState
let sel = new Set();     // 选中路径
let lastIdx = 0;
let renameMode = false;
const iconCache = new Map();

// ============ 渲染 ============
function applyStyle(st, theme) {
  const b = document.body;
  b.classList.toggle('theme-light', theme === 'light');
  const dark = '#22262E', light = '#FBFBFC';
  const bgc = st.bg === 'auto' ? (theme === 'light' ? light : dark) : st.bg;
  const rgb = hexToRgb(bgc);
  // 背景不透明度：同时作用于背景、标题色条与描边（标题条保留下限，保证可读）
  let op = Math.max(0, Math.min(1, Number(st.opacity)));
  if (!isFinite(op)) op = 0.62;
  if (S.peek) op = Math.max(op, 0.88);            // 速览时提高不透明度，保证可读
  const barOp = 0.3 + 0.7 * op;
  const ac = hexToRgb(st.accent);
  b.style.setProperty('--bg', `rgba(${rgb.r},${rgb.g},${rgb.b},${op})`);
  b.style.setProperty('--bar', `rgba(${ac.r},${ac.g},${ac.b},${barOp})`);
  b.style.setProperty('--bar2', `rgba(${Math.round(ac.r * 0.9)},${Math.round(ac.g * 0.9)},${Math.round(ac.b * 0.9)},${barOp})`);
  b.style.setProperty('--edge', theme === 'light' ? `rgba(15,23,42,${0.04 + 0.08 * op})` : `rgba(255,255,255,${0.05 + 0.13 * op})`);
  b.style.setProperty('--shadow-a', String(0.05 + 0.14 * op));
  b.style.setProperty('--content-op', String(st.contentOpacity == null ? 1 : st.contentOpacity));
  b.style.setProperty('--accent', st.accent);
  b.style.setProperty('--radius', st.radius + 'px');
  b.style.setProperty('--isz', Math.round(st.iconSize * ((S.scale && S.scale.icon) || 1)) + 'px');
  b.style.setProperty('--lines', st.labelLines || 2);
  b.style.setProperty('--tfs', st.titleSize + 'px');
  b.style.setProperty('--tfw', st.titleBold ? 700 : 500);
  const fg = st.textColor === 'auto' ? (theme === 'light' ? '#23272F' : '#FFFFFF') : st.textColor;
  b.style.setProperty('--fg', fg);
  const sub = fg === '#FFFFFF' ? 'rgba(255,255,255,.6)' : 'rgba(35,39,47,.55)';
  b.style.setProperty('--sub', sub);
  const t = st.titleSize;
  b.style.setProperty('--title-h', (t + 21) * (S.scale && S.scale.font || 1) + 'px');
  b.style.setProperty('--lbl', (11.5 * (S.scale && S.scale.font || 1)) + 'px');
  root.className = 'fence ts-' + st.titleStyle + (theme === 'light' ? ' light' : '') + (st.blur ? ' blur-on' : '');
  if (S.fence.rolledUp) root.classList.add('rolled');
  if (S.fence.locked) root.classList.add('locked');
  if (S.fence.type === 'portal') root.classList.add('is-portal');
  if (S.portal && S.portal.canBack) root.classList.add('can-back');
  if (S.peek) root.classList.add('peek');
  titleBar.className = 'title align-' + (st.titleAlign || 'left');
  if (st.titleStyle === 'bar') titleBar.style.color = '#fff';
}
function hexToRgb(h) {
  h = (h || '#22262E').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function initials(name) {
  const s = (name || '?').replace(/\s+/g, '');
  return s.slice(0, 1).toUpperCase();
}
function iconNode(ic) {
  const img = document.createElement('img');
  img.src = ic.url; img.draggable = false;
  if (ic.kind === 'thumb') img.className = 'thumb' + (ic.long ? ' long' : '');
  return img;
}
function iconFor(item) {
  const key = item.path + '|' + item.mtime;
  if (iconCache.has(key)) return iconCache.get(key);
  iconCache.set(key, null);
  zt.invoke('icon:get', item.path).then(ic => {
    if (!ic || !ic.url) return;
    iconCache.set(key, ic);
    const node = grid.querySelector(`[data-p="${cssEsc(item.path)}"] .ico`);
    if (node) { node.replaceChildren(iconNode(ic)); if (ic.long) node.parentElement.classList.add('is-long'); }
  });
  return null;
}
function cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'); }

function render() {
  if (!S) return;
  const f = S.fence, st = f.style;
  applyStyle(st, S.theme);
  el('tName').textContent = f.name;
  el('tCount').textContent = String(S.items.length);
  el('tIcon').textContent = '';
  if (f.type === 'portal') el('tIcon').innerHTML = '<span style="opacity:.9">📂</span>';
  else el('tIcon').innerHTML = '<span style="opacity:.9">▦</span>';
  el('crumb').textContent = S.portal ? (S.portal.crumb || '') : '';
  root.classList.toggle('empty-on', S.items.length === 0 && !f.rolledUp);

  const frag = document.createDocumentFragment();
  S.items.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'item' + (sel.has(it.path) ? ' sel' : '') + (it.missing ? ' missing' : '');
    d.dataset.p = it.path;
    d.dataset.i = i;
    d.draggable = true;
    const ico = document.createElement('div');
    ico.className = 'ico';
    const cached = iconCache.get(it.path + '|' + it.mtime);
    if (cached) { ico.appendChild(iconNode(cached)); if (cached.long) d.classList.add('is-long'); }
    else {
      const ph = document.createElement('div'); ph.className = 'ph'; ph.textContent = it.isDir ? '' : initials(it.name);
      if (it.isDir) ph.innerHTML = '<span style="font-size:20px">🗀</span>';
      ico.appendChild(ph);
      iconFor(it);
    }
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = it.name; nm.title = it.path;
    d.appendChild(ico); d.appendChild(nm);
    frag.appendChild(d);
  });
  grid.replaceChildren(frag);
}

function paintSel() {
  grid.querySelectorAll('.item').forEach(n => n.classList.toggle('sel', sel.has(n.dataset.p)));
}

// ============ 交互 ============
let pointer = null;
titleBar.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || renameMode) return;
  if (e.target.closest('.t-btn')) return;
  pointer = { x: e.screenX, y: e.screenY, moved: false };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp, { once: true });
  window.__dragStarted = false;
});
function onMove(e) {
  if (!pointer) return;
  if (!window.__dragStarted && (Math.abs(e.screenX - pointer.x) > 3 || Math.abs(e.screenY - pointer.y) > 3)) {
    window.__dragStarted = true;
    zt.send('fence:dragStart', ID, 'move');
  }
  if (window.__dragStarted) zt.send('fence:dragMove', ID);
}
function onUp() {
  document.removeEventListener('pointermove', onMove);
  if (window.__dragStarted) zt.send('fence:dragEnd', ID);
  pointer = null;
}

// 双击标题：卷起/展开
titleBar.addEventListener('dblclick', (e) => {
  if (e.target.closest('.t-btn') || renameMode) return;
  zt.invoke('fence:rollup', ID, !S.fence.rolledUp);
});
titleBar.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); zt.invoke('fence:menu', ID); });
root.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.item') || e.target.closest('.t-name input')) return;
  e.preventDefault();
  if (sel.size) zt.invoke('item:menu', ID, Array.from(sel));
  else zt.invoke('fence:menu', ID);
});

// 缩放
document.querySelectorAll('.rz').forEach(h => {
  h.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    zt.send('fence:dragStart', ID, h.dataset.edge);
    const mv = () => zt.send('fence:dragMove', ID);
    const up = () => { document.removeEventListener('pointermove', mv); zt.send('fence:dragEnd', ID); };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up, { once: true });
  });
});

// 项目交互
grid.addEventListener('pointerdown', (e) => {
  const item = e.target.closest('.item');
  if (!item) {
    if (e.button === 0) { sel.clear(); paintSel(); startMarquee(e); }
    return;
  }
  const p = item.dataset.p;
  if (e.button === 0) {
    if (e.ctrlKey || e.metaKey) { sel.has(p) ? sel.delete(p) : sel.add(p); }
    else if (e.shiftKey && S.items[lastIdx]) {
      const i = +item.dataset.i;
      const [a, b] = [Math.min(i, lastIdx), Math.max(i, lastIdx)];
      sel = new Set(S.items.slice(a, b + 1).map(x => x.path));
    } else if (!sel.has(p)) { sel = new Set([p]); }
    lastIdx = +item.dataset.i;
    paintSel();
  }
});
grid.addEventListener('click', (e) => {
  const item = e.target.closest('.item');
  if (!item) return;
  if (Date.now() - (item._lastClick || 0) < 420 && sel.size === 1) {
    item._lastClick = 0;
    zt.invoke('fence:open', ID, item.dataset.p);
  } else item._lastClick = Date.now();
});
grid.addEventListener('dblclick', (e) => {
  const item = e.target.closest('.item');
  if (item && S && S.fence.type === 'portal') zt.invoke('fence:open', ID, item.dataset.p);
});
grid.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('.item');
  e.preventDefault();
  if (item) {
    const p = item.dataset.p;
    if (!sel.has(p)) { sel = new Set([p]); paintSel(); }
    zt.invoke('item:menu', ID, Array.from(sel));
  } else if (sel.size) zt.invoke('item:menu', ID, Array.from(sel));
  else zt.invoke('fence:menu', ID);
});

// 拖拽：阻止 Chromium 自带拖拽，统一交给主进程发起系统原生拖放（OLE），
// 可拖到其他围栏、桌面、资源管理器或任意应用；避免两套拖放嵌套导致崩溃。
let dragActive = false;      // 是否为 ZTABLE 自己发起的拖拽
grid.addEventListener('dragstart', (e) => {
  const item = e.target.closest('.item');
  e.preventDefault();
  if (!item || renameMode) return;
  const p = item.dataset.p;
  if (!sel.has(p)) { sel = new Set([p]); paintSel(); }
  const paths = Array.from(sel).filter(x => { const it = S.items.find(i => i.path === x); return it && !it.missing; });
  if (!paths.length) return;
  grid.querySelectorAll('.item.sel').forEach(n => n.classList.add('dragging'));
  zt.send('item:startDrag', ID, paths);
});
function clearDropMarks() { grid.querySelectorAll('.drop-before').forEach(n => n.classList.remove('drop-before')); }
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!e.dataTransfer) return;
  // 外部（资源管理器）拖入只建立引用，绝不返回「移动」，防止源文件被删除
  e.dataTransfer.dropEffect = dragActive ? 'move' : 'copy';
  const item = e.target.closest && e.target.closest('.item');
  clearDropMarks();
  if (item && S && S.fence.type === 'normal' && S.fence.style.sort === 'manual') item.classList.add('drop-before');
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) clearDropMarks(); });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  clearDropMarks();
  const item = e.target.closest && e.target.closest('.item');
  const before = item ? item.dataset.p : null;
  const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).map(f => zt.pathForFile(f)).filter(Boolean);
  if (files.length) await zt.invoke('fence:dropFiles', ID, { paths: files, before });
});

// 空白处框选
function startMarquee(e) {
  const r0 = grid.getBoundingClientRect();
  const x0 = e.clientX - r0.left + grid.scrollLeft, y0 = e.clientY - r0.top + grid.scrollTop;
  const box = document.createElement('div');
  box.className = 'marquee';
  grid.appendChild(box);
  const mv = (ev) => {
    const x = ev.clientX - r0.left + grid.scrollLeft, y = ev.clientY - r0.top + grid.scrollTop;
    const L = Math.min(x, x0), T = Math.min(y, y0), W = Math.abs(x - x0), H = Math.abs(y - y0);
    box.style.left = L + 'px'; box.style.top = T + 'px'; box.style.width = W + 'px'; box.style.height = H + 'px';
    const r = { left: r0.left + L, top: r0.top + T, right: r0.left + L + W, bottom: r0.top + T + H };
    grid.querySelectorAll('.item').forEach(node => {
      const b = node.getBoundingClientRect();
      const hit = !(b.right < r.left || b.left > r.right || b.bottom < r.top || b.top > r.bottom);
      node.classList.toggle('sel', hit);
    });
  };
  const up = () => {
    box.remove();
    document.removeEventListener('pointermove', mv);
    sel = new Set(Array.from(grid.querySelectorAll('.item.sel')).map(n => n.dataset.p));
    paintSel();
  };
  document.addEventListener('pointermove', mv);
  document.addEventListener('pointerup', up, { once: true });
}

// 键盘
document.addEventListener('keydown', (e) => {
  if (renameMode) return;
  if (e.key === 'Escape') { sel.clear(); paintSel(); zt.invoke('app:exitPeek'); }
  else if (e.key === 'Enter' && sel.size) { sel.forEach(p => zt.invoke('fence:open', ID, p)); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) { zt.invoke('item:menu', ID, Array.from(sel)); }
  else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sel = new Set(S.items.map(i => i.path)); paintSel(); }
  else if (e.key === 'F5') { zt.invoke('fence:init', ID).then(s => { if (s) { S = s; render(); } }); }
});

// 标题栏按钮
el('btnRoll').addEventListener('click', (e) => { e.stopPropagation(); zt.invoke('fence:rollup', ID, !S.fence.rolledUp); });
el('btnOpenFolder').addEventListener('click', (e) => { e.stopPropagation(); zt.invoke('fence:openFolder', ID); });
el('btnBack').addEventListener('click', (e) => { e.stopPropagation(); zt.invoke('fence:portalUp', ID); });

// 内联重命名
function beginRename() {
  if (renameMode) return;
  renameMode = true;
  const nameEl = el('tName');
  const old = S.fence.name;
  const input = document.createElement('input');
  input.value = old; input.maxLength = 60;
  nameEl.textContent = ''; nameEl.appendChild(input);
  input.focus(); input.select();
  const done = (commit) => {
    if (!renameMode) return;
    renameMode = false;
    const v = input.value.trim();
    document.removeEventListener('pointerdown', outside, true);
    if (commit && v && v !== old) zt.invoke('fence:rename', ID, v); else { nameEl.textContent = old; }
  };
  const outside = (ev) => { if (!nameEl.contains(ev.target)) done(true); };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
  });
  input.addEventListener('blur', () => done(true));
  document.addEventListener('pointerdown', outside, true);
}

zt.on('fence:state', (s) => {
  S = s;
  const live = new Set(S.items.map(i => i.path));
  for (const p of Array.from(sel)) if (!live.has(p)) sel.delete(p);
  render();
});
zt.on('drag:state', (on) => {
  dragActive = !!on;
  if (!on) grid.querySelectorAll('.dragging').forEach(n => n.classList.remove('dragging'));
});
zt.on('fence:beginRename', () => beginRename());
zt.on('fence:flash', () => { root.classList.add('flash'); setTimeout(() => root.classList.remove('flash'), 900); });
zt.invoke('fence:init', ID).then(s => { if (s) { S = s; render(); } else document.body.innerHTML = ''; });

window.addEventListener('resize', () => { /* 布局由 CSS 自动流式处理 */ });
