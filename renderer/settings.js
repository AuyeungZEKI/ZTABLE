'use strict';
/* global zt */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = new URLSearchParams(location.search);

let P = null;                       // settings payload
let page = q.get('page') || 'home';
let curFence = q.get('fence') || null;
let lastEdit = 0;
let capturing = null;

const PALETTE = ['#3B82F6', '#2563EB', '#14B8A6', '#22C55E', '#A855F7', '#EC4899', '#F59E0B', '#EF4444', '#0EA5E9', '#64748B', '#1F2430'];
const SORTS = [['manual', '手动'], ['name', '名称'], ['type', '类型'], ['mtime', '修改时间'], ['size', '大小']];
const SOURCES = [['desktop', '桌面'], ['downloads', '下载文件夹'], ['any', '任意来源']];
const KINDS = [['any', '文件和文件夹'], ['file', '仅文件'], ['folder', '仅文件夹']];
const EXT_GROUPS = {
  '软件/快捷方式': ['lnk', 'exe', 'url', 'appref-ms', 'bat', 'cmd'],
  '文档': ['doc', 'docx', 'pdf', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'txt', 'md', 'wps'],
  '图片': ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'psd'],
  '视频音频': ['mp4', 'mov', 'mkv', 'avi', 'mp3', 'wav', 'flac'],
  '压缩/安装包': ['zip', 'rar', '7z', 'iso', 'msi'],
  '代码': ['js', 'ts', 'py', 'json', 'html', 'css', 'cs', 'cpp', 'java']
};

// ===================== 通用组件 =====================
function toggle(on, attrs) { return `<button class="tg ${on ? 'on' : ''}" ${attrs || ''}></button>`; }
function seg(options, value, attrs) {
  return `<div class="seg" ${attrs || ''}>${options.map(([v, l]) => `<button data-v="${esc(v)}" class="${String(v) === String(value) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}
function row(icon, title, desc, control) {
  return `<div class="row"><div class="ri">${icon}</div><div class="rt"><b>${title}</b>${desc ? `<span>${desc}</span>` : ''}</div><div class="rc">${control}</div></div>`;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2200);
}
function modal(html, onMount) {
  $('#modal').innerHTML = html; $('#modalBg').classList.add('on');
  if (onMount) onMount($('#modal'));
}
function closeModal() { $('#modalBg').classList.remove('on'); $('#modal').innerHTML = ''; }
$('#modalBg').addEventListener('mousedown', (e) => { if (e.target.id === 'modalBg') closeModal(); });

async function setCfg(key, value) {
  lastEdit = Date.now();
  P = await zt.invoke('cfg:set', key, value);
}
async function cmd(name, arg) { return zt.invoke('cmd', name, arg); }
function fences() { return P.cfg.fences; }
function fenceById(id) { return P.cfg.fences.find(f => f.id === id); }
function fenceName(id) { const f = fenceById(id); return f ? f.name : '（未指定）'; }
const fmtHotkey = (s) => s ? s.split('+').map(k => `<kbd>${esc(k)}</kbd>`).join('<span style="opacity:.5">+</span>') : '<span>未设置</span>';

// ===================== 页面 =====================
const pages = {};

pages.welcome = () => `
<div class="page">
  <div class="hero mt">
    <div class="logo"><img src="../assets/mark128.png" alt=""></div>
    <div><h1>欢迎使用 ZTABLE</h1><p>把满屏乱堆的图标收进围栏，让 Windows 11 桌面井井有条。</p></div>
  </div>
  <h2>选择一个开始方式</h2>
  <div class="grid2">
    <div class="card choice rec" data-act="oneClick">
      <div class="ci">⚡</div><b>一键整理桌面 <span class="pill">推荐</span></b>
      <p>自动创建「软件 / 文档 / 图片 / 下载 / 项目」5 个围栏，并按文件类型、关键词把现有桌面图标归类进去。之后新快捷方式和新下载也会自动入栏。</p>
    </div>
    <div class="card choice" data-act="blankStart">
      <div class="ci">✏️</div><b>从空白开始</b>
      <p>不改动现有桌面。之后在桌面空白处<b>按住右键拖出一个框</b>，即可创建你的第一个围栏。</p>
    </div>
  </div>
  <h2>常用手势</h2>
  <div class="card tips">
    <div class="tip">🖱 <span><b>右键拖拽</b>桌面空白处，框出半透明选择框创建围栏</span></div>
    <div class="tip">👆 <span><b>双击桌面空白</b>，一键隐藏 / 显示全部图标</span></div>
    <div class="tip">⌃ <span><b>双击围栏标题</b>，卷起成标题条，再双击展开</span></div>
    <div class="tip">⌘ <span>按 ${fmtHotkey(P.cfg.hotkeys.peek)} <b>速览</b>：窗口挡住桌面时把围栏置顶</span></div>
    <div class="tip">📂 <span>把任意文件夹做成<b>文件夹门户</b>，直接在桌面浏览</span></div>
    <div class="tip">🔒 <span>拖进围栏的桌面图标会<b>从桌面收起</b>（文件仍在原路径）；拖出或删除围栏即回到桌面</span></div>
  </div>
</div>`;

pages.home = () => {
  const s = P.stats;
  const hookOk = P.hook && P.hook.ok;
  return `
<div class="page">
  <h1>概览</h1>
  <p class="lead">ZTABLE 正在守护你的桌面。<span class="status ${hookOk ? '' : 'bad'}"><i></i>${hookOk ? '桌面手势与全局快捷键已启用' : '桌面手势服务未就绪（托盘菜单仍可用）'}</span></p>
  <div class="grid3">
    <div class="card stat"><div class="n">${s.fences}</div><div class="l">个围栏</div></div>
    <div class="card stat"><div class="n">${s.items}</div><div class="l">个已收纳项目</div></div>
    <div class="card stat"><div class="n">${s.rules}</div><div class="l">条自动归类规则</div></div>
  </div>
  <h2>快捷操作</h2>
  <div class="grid2">
    <div class="card action" data-act="drawFence"><div class="ai">⬚</div><div><b>框选新建围栏</b><span>在屏幕上拖出一个区域，也可直接在桌面右键拖拽</span></div></div>
    <div class="card action" data-act="newPortal"><div class="ai">⧉</div><div><b>新建文件夹门户</b><span>把下载、文档、D 盘项目或云盘镜像到桌面</span></div></div>
    <div class="card action" data-act="organize"><div class="ai">⚑</div><div><b>按规则整理桌面</b><span>把散落的桌面图标按规则归入围栏</span></div></div>
    <div class="card action" data-act="oneClick"><div class="ai">⚡</div><div><b>创建 5 个分类预设</b><span>软件 / 文档 / 图片 / 下载 / 项目（已存在的会跳过）</span></div></div>
    <div class="card action" data-act="quickHide"><div class="ai">◐</div><div><b>${P.state.quickHidden ? '恢复显示桌面' : '快速隐藏桌面'}</b><span>也可以双击桌面空白处</span></div></div>
    <div class="card action" data-act="peek"><div class="ai">⌘</div><div><b>速览围栏</b><span>快捷键 ${fmtHotkey(P.cfg.hotkeys.peek)}</span></div></div>
  </div>
  <h2>我的围栏</h2>
  <div class="group">${fences().length ? fences().map(f => `
    <div class="row" style="min-height:52px"><div class="ri" style="background:${esc(f.style.accent)};color:#fff">${f.type === 'portal' ? '⧉' : '▦'}</div>
    <div class="rt"><b>${esc(f.name)}</b><span>${f.type === 'portal' ? '门户 · ' + esc(f.portalPath) : f.items.length + ' 个项目'}${f.rolledUp ? ' · 已卷起' : ''}${f.locked ? ' · 已锁定' : ''}</span></div>
    <div class="rc"><button class="btn sm ghost" data-flash="${f.id}">定位</button><button class="btn sm" data-editf="${f.id}">编辑</button></div></div>`).join('') : `<div class="empty-box">还没有围栏。点击上方「框选新建围栏」开始。</div>`}
  </div>
</div>`;
};

function fencePreview(f) {
  const st = f.style;
  const dark = P.theme === 'dark';
  const bg = st.bg === 'auto' ? (dark ? '#22262E' : '#FBFBFC') : st.bg;
  const n = parseInt(bg.slice(1), 16);
  const op = Math.max(0, Math.min(1, Number(st.opacity)));
  const rgba = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${op})`;
  const an = parseInt(st.accent.slice(1), 16);
  const barOp = 0.3 + 0.7 * op;
  const barBg = `rgba(${(an >> 16) & 255},${(an >> 8) & 255},${an & 255},${barOp})`;
  const fg = st.textColor === 'auto' ? (dark ? '#fff' : '#23272F') : st.textColor;
  const tStyle = st.titleStyle === 'bar' ? `background:${barBg};color:#fff` : st.titleStyle === 'line' ? `border-bottom:2px solid ${st.accent};color:${fg}` : `color:${fg};${st.titleStyle === 'hidden' ? 'opacity:.35' : ''}`;
  const just = { left: 'flex-start', center: 'center', right: 'flex-end' }[st.titleAlign || 'left'];
  const sz = Math.max(22, Math.min(42, st.iconSize * 0.62));
  const cols = ['#4F8DF7', '#22C55E', '#F59E0B', '#EF4444', '#A855F7', '#0EA5E9', '#14B8A6', '#64748B'];
  const names = ['Chrome', '报告.docx', '照片.jpg', '项目A', 'PS 2025', '下载', '方案.pdf', '笔记'];
  return `<div class="pv" style="background:${rgba};border-radius:${st.radius}px;color:${fg}">
    <div class="pt" style="${tStyle};justify-content:${just};font-size:${st.titleSize}px;font-weight:${st.titleBold ? 700 : 500};height:${st.titleSize + 21}px">${esc(f.name)}</div>
    ${f.rolledUp ? '' : `<div class="pg" style="opacity:${st.contentOpacity == null ? 1 : st.contentOpacity};grid-template-columns:repeat(${sz > 34 ? 3 : 4},1fr)">${names.slice(0, sz > 34 ? 6 : 8).map((nm, i) => `<div class="pi"><i style="width:${sz}px;height:${sz}px;background:${cols[i]}"></i><span>${nm}</span></div>`).join('')}</div>`}
  </div>`;
}

pages.fences = () => {
  const list = fences();
  if (!curFence || !fenceById(curFence)) curFence = list[0] ? list[0].id : null;
  const f = curFence ? fenceById(curFence) : null;
  const st = f ? f.style : null;
  const slider = (key, min, max, step, val, unit, fmt) => `<input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-style="${key}" data-num="1"><span class="rv" data-rv="${key}">${fmt ? fmt(val) : val + (unit || '')}</span>`;
  return `
<div class="page" style="max-width:1100px">
  <h1>围栏与外观</h1>
  <p class="lead">调整每个围栏的大小、颜色、透明度、圆角、标题样式与图标排序。改动会实时同步到桌面。</p>
  <div class="split">
    <div>
      <div class="card flist">
        ${list.map(x => `<div class="fitem ${x.id === curFence ? 'on' : ''}" data-fid="${x.id}"><span class="sw" style="background:${esc(x.style.accent)}"></span><span class="fn">${esc(x.name)}</span>${x.type === 'portal' ? '<span class="ftype">门户</span>' : `<span class="fc">${x.items.length}</span>`}</div>`).join('') || '<div class="empty-box">暂无围栏</div>'}
      </div>
      <div class="flex mt"><button class="btn primary" data-act="drawFence">＋ 框选新建</button><button class="btn" data-act="newFence">快速新建</button></div>
    </div>
    ${f ? `
    <div class="card editor">
      <div class="head">
        <span class="sw" style="width:14px;height:14px;border-radius:4px;background:${esc(st.accent)}"></span>
        <input type="text" id="fName" value="${esc(f.name)}" maxlength="60">
        <button class="btn sm ghost" data-flash="${f.id}">定位</button>
        <button class="btn sm danger" data-delf="${f.id}">删除</button>
      </div>
      <div style="padding:16px 18px 6px"><div class="preview-wrap">${fencePreview(f)}</div></div>
      <div class="group" style="border:0;box-shadow:none">
        ${f.type === 'portal' ? row('⧉', '门户文件夹', esc(f.portalPath), `<button class="btn sm" data-act="changePortal">更换…</button>`) : ''}
        ${row('🎨', '主题色', '标题条与强调色', `<div class="swatches">${PALETTE.map(c => `<span class="swatch ${c.toLowerCase() === st.accent.toLowerCase() ? 'on' : ''}" style="background:${c}" data-accent="${c}"></span>`).join('')}<input type="color" value="${esc(st.accent)}" data-style="accent"></div>`)}
        ${row('◧', '背景色', '自动跟随深浅色，或指定颜色', `${seg([['auto', '自动'], ['custom', '自定义']], st.bg === 'auto' ? 'auto' : 'custom', 'data-bgmode')}${st.bg !== 'auto' ? `<input type="color" value="${esc(st.bg)}" data-style="bg">` : ''}`)}
        ${row('◌', '背景不透明度', '同时影响背景、标题条与描边；0% 完全透明（只留图标）', slider('opacity', 0, 1, 0.01, st.opacity, '', v => Math.round(v * 100) + '%'))}
        ${row('◍', '内容不透明度', '围栏内图标与文字的整体透明度', slider('contentOpacity', 0.3, 1, 0.01, st.contentOpacity == null ? 1 : st.contentOpacity, '', v => Math.round(v * 100) + '%'))}
        ${row('▢', '圆角', '', slider('radius', 0, 24, 1, st.radius, ' px'))}
        ${P.caps && P.caps.acrylic ? row('❄', '毛玻璃（亚克力）', '由系统模糊围栏背后的内容；建议背景不透明度 20%–50%', toggle(st.blur, 'data-stoggle="blur"')) : row('❄', '毛玻璃（亚克力）', '需要 Windows 11 22H2 及以上，当前系统不支持', '<span class="chip">不可用</span>')}
        ${row('▔', '标题样式', '', seg([['bar', '色条'], ['line', '细线'], ['minimal', '简约'], ['hidden', '悬停显示']], st.titleStyle, 'data-sseg="titleStyle"'))}
        ${row('≡', '标题对齐', '', seg([['left', '左'], ['center', '中'], ['right', '右']], st.titleAlign, 'data-sseg="titleAlign"'))}
        ${row('A', '标题字号', '', slider('titleSize', 10, 20, 1, st.titleSize, ' px') + toggle(st.titleBold, 'data-stoggle="titleBold" title="粗体"'))}
        ${row('▦', '图标大小', '', slider('iconSize', 24, 128, 4, st.iconSize, ' px'))}
        ${row('¶', '名称行数', '图标名称最多显示几行', seg([['1', '1'], ['2', '2'], ['3', '3']], String(st.labelLines || 2), 'data-sseg="labelLines" data-num="1"'))}
        ${row('⇅', '图标排序', '', seg(SORTS, st.sort, 'data-sseg="sort"'))}
        ${row('↔', '尺寸', '精确设置宽高（DIP，会按显示器缩放）', `<input type="number" id="fW" value="${f.bounds.width}" min="140"> × <input type="number" id="fH" value="${f.bounds.height}" min="70">`)}
        ${row('⌃', '卷起', '只显示标题条，节省桌面空间', toggle(f.rolledUp, 'data-ftoggle="rolledUp"'))}
        ${row('🔒', '锁定位置与大小', '防止误拖动', toggle(f.locked, 'data-ftoggle="locked"'))}
        ${row('◐', '快速隐藏时保留', '双击桌面隐藏时，此围栏仍然显示', toggle(f.keepOnQuickHide, 'data-ftoggle="keepOnQuickHide"'))}
      </div>
      <div class="flex" style="padding:12px 18px 16px;border-top:1px solid var(--line-2)"><span class="muted" style="font-size:12px">将当前外观（除主题色外）应用到所有围栏</span><span class="spacer"></span><button class="btn sm" data-act="styleAll">应用到全部</button></div>
    </div>` : `<div class="card empty-box">还没有围栏。<br><br><button class="btn primary" data-act="drawFence">框选新建围栏</button></div>`}
  </div>
</div>`;
};

function ruleSummary(r) {
  const parts = [];
  parts.push('来源：' + (SOURCES.find(s => s[0] === (r.source || 'desktop')) || ['', '桌面'])[1]);
  if (r.kind && r.kind !== 'any') parts.push(KINDS.find(k => k[0] === r.kind)[1]);
  if (r.exts && r.exts.length) parts.push('类型：' + r.exts.slice(0, 8).map(e => '.' + e).join(' ') + (r.exts.length > 8 ? ` 等 ${r.exts.length} 种` : ''));
  if (r.keywords && r.keywords.length) parts.push('名称含：' + r.keywords.join(' / '));
  if (r.modifiedWithinDays) parts.push(`${r.modifiedWithinDays} 天内修改`);
  if (r.olderThanDays) parts.push(`超过 ${r.olderThanDays} 天未修改`);
  return parts.join(' · ');
}

pages.rules = () => {
  const rules = P.cfg.rules;
  return `
<div class="page">
  <h1>自动归类</h1>
  <p class="lead">按文件类型、名称关键词、修改时间设规则。新快捷方式、新下载会自动进入对应围栏；规则从上到下依次匹配，命中第一条即停止。</p>
  <div class="flex mb10"><button class="btn primary" data-act="addRule">＋ 新建规则</button><button class="btn" data-act="organize">立即按规则整理桌面</button><span class="spacer"></span>
    <span class="tg-wrap">监视下载文件夹 ${toggle(P.cfg.general.watchDownloads, 'data-cfg="general.watchDownloads"')}</span></div>
  <div class="group">
    ${rules.length ? rules.map((r, i) => `
      <div class="rule">
        <span class="ord">${i + 1}</span>
        ${toggle(r.enabled !== false, `data-rtoggle="${r.id}"`)}
        <div style="flex:1;min-width:0"><div class="rn">${esc(r.name || '未命名规则')} <span class="muted" style="font-weight:400">→</span> <span class="chip b">${esc(fenceName(r.fenceId))}</span>${r.auto === false ? '<span class="chip">仅手动整理</span>' : ''}</div><div class="rd">${esc(ruleSummary(r))}</div></div>
        <button class="btn sm ghost" data-rup="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn sm ghost" data-rdown="${i}" ${i === rules.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn sm" data-redit="${r.id}">编辑</button>
        <button class="btn sm ghost danger" data-rdel="${r.id}">删除</button>
      </div>`).join('') : `<div class="empty-box">还没有规则。<br>在「概览」里使用「创建 5 个分类预设」可以一次生成常用规则，或点击「新建规则」。</div>`}
  </div>
  <div class="note mt">💡 <span>${P.cfg.general.stowMode === 'move' ? '桌面上的文件被归类后会<b>移入收纳文件夹</b>，桌面不再保留' : '桌面上的文件被归类后<b>仍留在桌面原路径</b>，只把桌面图标隐藏、收进围栏'}；新下载的文件仍留在「下载」文件夹，围栏里只是多一个入口。</span></div>
</div>`;
};

function ruleEditor(rule) {
  const r = Object.assign({ id: 'r' + Date.now().toString(36), name: '', enabled: true, auto: true, source: 'desktop', kind: 'any', exts: [], keywords: [], modifiedWithinDays: 0, olderThanDays: 0, fenceId: (fences().find(f => f.type === 'normal') || {}).id }, JSON.parse(JSON.stringify(rule || {})));
  const normal = fences().filter(f => f.type === 'normal');
  const chips = (arr, kind) => arr.map((v, i) => `<span class="chip">${kind === 'ext' ? '.' : ''}${esc(v)}<x data-rm="${kind}:${i}">×</x></span>`).join('');
  const html = () => `
    <div class="mh">${rule ? '编辑规则' : '新建规则'}</div>
    <div class="mb"><div class="form">
      <label>规则名称</label><input type="text" id="rName" value="${esc(r.name)}" placeholder="例如：设计稿">
      <label>放入围栏</label><select id="rFence">${normal.map(f => `<option value="${f.id}" ${f.id === r.fenceId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
      <label>文件来源</label>${seg(SOURCES, r.source, 'id="rSource"')}
      <label>项目种类</label>${seg(KINDS, r.kind, 'id="rKind"')}
      <label>文件类型</label><div><div class="chipbox" id="extBox">${chips(r.exts, 'ext')}<input id="extIn" placeholder="输入扩展名后回车，如 docx"></div>
        <div class="flex" style="margin-top:6px">${Object.keys(EXT_GROUPS).map(g => `<button class="btn sm ghost" data-grp="${esc(g)}">＋${esc(g)}</button>`).join('')}</div></div>
      <label>名称关键词</label><div class="chipbox" id="kwBox">${chips(r.keywords, 'kw')}<input id="kwIn" placeholder="名称包含任一关键词即匹配，回车添加"></div>
      <label>修改时间</label><div class="flex"><span class="muted">最近</span><input type="number" id="rWithin" min="0" value="${r.modifiedWithinDays || 0}"><span class="muted">天内修改；或超过</span><input type="number" id="rOlder" min="0" value="${r.olderThanDays || 0}"><span class="muted">天未修改（0 = 不限）</span></div>
      <label>自动执行</label><div class="tg-wrap">${toggle(r.auto !== false, 'id="rAuto"')}新出现的文件自动归类（关闭后仅在「立即整理」时生效）</div>
    </div></div>
    <div class="mf"><button class="btn" id="rCancel">取消</button><button class="btn primary" id="rSave">保存规则</button></div>`;
  const mount = (m) => {
    const sync = () => {
      r.name = $('#rName', m).value.trim();
      r.fenceId = $('#rFence', m).value;
      r.modifiedWithinDays = Math.max(0, parseInt($('#rWithin', m).value || '0', 10));
      r.olderThanDays = Math.max(0, parseInt($('#rOlder', m).value || '0', 10));
    };
    const rerender = () => { sync(); m.innerHTML = html(); mount(m); };
    $$('#rSource button', m).forEach(b => b.onclick = () => { sync(); r.source = b.dataset.v; rerender(); });
    $$('#rKind button', m).forEach(b => b.onclick = () => { sync(); r.kind = b.dataset.v; rerender(); });
    $$('[data-grp]', m).forEach(b => b.onclick = () => { sync(); EXT_GROUPS[b.dataset.grp].forEach(e => { if (!r.exts.includes(e)) r.exts.push(e); }); rerender(); });
    $$('[data-rm]', m).forEach(x => x.onclick = () => { sync(); const [k, i] = x.dataset.rm.split(':'); (k === 'ext' ? r.exts : r.keywords).splice(+i, 1); rerender(); });
    const addChip = (input, arr, norm) => input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',' || e.key === ' ' && norm) {
        e.preventDefault();
        input.value.split(/[,，;；\s]+/).map(v => norm ? v.replace(/^\*?\./, '').toLowerCase() : v.trim()).filter(Boolean).forEach(v => { if (!arr.includes(v)) arr.push(v); });
        const id = input.id; rerender(); const n = $('#' + id, m); if (n) n.focus();
      }
    });
    addChip($('#extIn', m), r.exts, true);
    addChip($('#kwIn', m), r.keywords, false);
    $('#rAuto', m).onclick = (e) => { r.auto = !(r.auto !== false); e.currentTarget.classList.toggle('on'); };
    $('#rCancel', m).onclick = closeModal;
    $('#rSave', m).onclick = async () => {
      sync();
      ['extIn', 'kwIn'].forEach(id => { const v = $('#' + id, m).value.trim(); if (v) v.split(/[,，;；\s]+/).filter(Boolean).forEach(x => { const arr = id === 'extIn' ? r.exts : r.keywords; const vv = id === 'extIn' ? x.replace(/^\*?\./, '').toLowerCase() : x; if (!arr.includes(vv)) arr.push(vv); }); });
      if (!r.fenceId) { toast('请先创建一个普通围栏'); return; }
      if (!r.exts.length && !r.keywords.length && r.kind !== 'folder' && !r.modifiedWithinDays && !r.olderThanDays && r.source !== 'downloads') { toast('请至少设置一个匹配条件'); return; }
      if (!r.name) r.name = r.exts.length ? r.exts.slice(0, 3).map(e => '.' + e).join(' ') : (r.keywords[0] || '自定义规则');
      const rules = P.cfg.rules.slice();
      const i = rules.findIndex(x => x.id === r.id);
      if (i >= 0) rules[i] = r; else rules.push(r);
      await zt.invoke('rules:set', rules);
      closeModal(); toast('规则已保存');
    };
  };
  if (!normal.length) { toast('请先创建一个普通围栏，再设置规则'); return; }
  modal(html(), mount);
}

pages.portals = () => {
  const ps = P.paths;
  const quick = [
    ['⬇', '下载', ps.downloads], ['📄', '文档', ps.documents], ['🖼', '图片', ps.pictures],
    ['🖥', '桌面', ps.desktop], ['☁', 'OneDrive', ps.onedrive], ['🎬', '视频', ps.videos]
  ].filter(x => x[2]);
  const portals = fences().filter(f => f.type === 'portal');
  return `
<div class="page">
  <h1>文件夹门户</h1>
  <p class="lead">把「下载」「文档」「D 盘项目」「OneDrive / 云盘」等任意文件夹镜像成一个桌面围栏：直接看内容、打开文件、进入子文件夹，不用开资源管理器。拖文件进门户会复制到该文件夹。</p>
  <h2>一键添加</h2>
  <div class="grid3">
    ${quick.map(([i, n, p]) => `<div class="card action" data-portal="${esc(p)}"><div class="ai">${i}</div><div><b>${esc(n)}</b><span style="word-break:break-all">${esc(p)}</span></div></div>`).join('')}
    <div class="card action" data-act="newPortal"><div class="ai">＋</div><div><b>选择其他文件夹…</b><span>如 D:\\项目、网盘同步目录</span></div></div>
  </div>
  <h2>已创建的门户</h2>
  <div class="group">${portals.length ? portals.map(f => `
    <div class="row"><div class="ri" style="background:${esc(f.style.accent)};color:#fff">⧉</div><div class="rt"><b>${esc(f.name)}</b><span>${esc(f.portalPath)}</span></div>
    <div class="rc"><button class="btn sm ghost" data-openpath="${esc(f.portalPath)}">打开</button><button class="btn sm ghost" data-flash="${f.id}">定位</button><button class="btn sm" data-editf="${f.id}">外观</button><button class="btn sm ghost danger" data-delf="${f.id}">删除</button></div></div>`).join('') : '<div class="empty-box">还没有门户。点击上方任意卡片即可创建。</div>'}
  </div>
</div>`;
};

pages.quickhide = () => {
  const qh = P.cfg.quickHide;
  return `
<div class="page">
  <h1>快速隐藏</h1>
  <p class="lead">演示、录屏或需要专注时，双击桌面空白处即可隐藏全部图标与围栏，再次双击恢复。</p>
  <div class="group">
    ${row('👆', '双击桌面空白处快速隐藏', '在没有图标的桌面区域双击', toggle(qh.dblClick, 'data-cfg="quickHide.dblClick"'))}
    ${row('▦', '隐藏桌面图标', '同 Windows「查看 → 显示桌面图标」', toggle(qh.hideIcons, 'data-cfg="quickHide.hideIcons"'))}
    ${row('▣', '隐藏围栏', '标记为「保留」的围栏不受影响', toggle(qh.hideFences, 'data-cfg="quickHide.hideFences"'))}
    ${row('⌨', '快捷键', '可在「速览与快捷键」中修改', `<span class="hk ${P.cfg.hotkeys.quickHide ? '' : 'none'}">${fmtHotkey(P.cfg.hotkeys.quickHide)}</span>`)}
    ${row('◐', '当前状态', P.state.quickHidden ? '桌面已隐藏' : '桌面正常显示', `<button class="btn ${P.state.quickHidden ? 'primary' : ''}" data-act="quickHide">${P.state.quickHidden ? '恢复显示' : '立即隐藏'}</button>`)}
  </div>
  <h2>只隐藏部分围栏</h2>
  <div class="group">${fences().length ? fences().map(f => row(`<span style="width:10px;height:10px;border-radius:3px;background:${esc(f.style.accent)}"></span>`, esc(f.name), f.keepOnQuickHide ? '快速隐藏时保留' : '随快速隐藏一起隐藏', `<span class="tg-wrap">保留 ${toggle(f.keepOnQuickHide, `data-keep="${f.id}"`)}</span>`)).join('') : '<div class="empty-box">暂无围栏</div>'}</div>
  <h2>排除的图标（隐藏时仍显示）</h2>
  <div class="group">
    ${qh.excludes.map((p, i) => row('📌', esc(p.split(/[\\/]/).pop()), esc(p), `<button class="btn sm ghost danger" data-unex="${i}">移除</button>`)).join('')}
    <div class="row" style="min-height:52px"><div class="rt"><span>隐藏桌面时，这些图标会集中显示在一个「保留图标」小围栏里。也可以在围栏内右键图标 →「快速隐藏时保留此图标」。</span></div><div class="rc"><button class="btn sm" data-act="addExclude">＋ 添加图标</button></div></div>
  </div>
</div>`;
};

function hkRow(id, title, desc) {
  const v = P.cfg.hotkeys[id];
  const rec = capturing === id;
  return row('⌨', title, desc, `<span class="hk ${rec ? 'rec' : (v ? '' : 'none')}">${rec ? '请按下组合键…（Esc 取消）' : fmtHotkey(v)}</span>
    <button class="btn sm" data-cap="${id}">${rec ? '取消' : '录制'}</button>${v ? `<button class="btn sm ghost" data-clr="${id}">清除</button>` : ''}${id === 'peek' && v !== 'Win+Space' ? `<button class="btn sm ghost" data-hkdef="peek">恢复默认</button>` : ''}`);
}
pages.peek = () => `
<div class="page">
  <h1>速览与快捷键</h1>
  <p class="lead">桌面被其他窗口挡住时，按下速览快捷键即可把所有围栏临时置顶；打开文件、再次按快捷键、按 Esc 或点击空白处即退出。</p>
  ${P.hook && P.hook.ok ? '' : '<div class="note warn mb10">⚠ <span>全局快捷键服务未就绪，快捷键暂不可用。可尝试重启 ZTABLE。</span></div>'}
  <div class="group">
    ${hkRow('peek', '速览围栏', '默认 Win + 空格（会接管系统的输入法切换组合键，可改用 Ctrl+Shift 切换输入法）')}
    ${hkRow('quickHide', '快速隐藏 / 显示桌面', '与双击桌面空白效果相同')}
    ${hkRow('newFence', '框选新建围栏', '进入屏幕框选模式')}
  </div>
  <h2>速览效果</h2>
  <div class="group">
    ${row('◑', '速览时调暗背景', '让围栏更醒目', toggle(P.cfg.peek.dim, 'data-cfg="peek.dim"'))}
    ${row('◌', '调暗程度', '', `<input type="range" min="0.05" max="0.8" step="0.05" value="${P.cfg.peek.dimOpacity}" data-cfgnum="peek.dimOpacity"><span class="rv">${Math.round(P.cfg.peek.dimOpacity * 100)}%</span>`)}
    ${row('⌘', '试一试', '', `<button class="btn" data-act="peek">进入速览</button>`)}
  </div>
</div>`;

pages.displays = () => {
  const ds = P.displays;
  const minX = Math.min(...ds.map(d => d.bounds.x)), minY = Math.min(...ds.map(d => d.bounds.y));
  const maxX = Math.max(...ds.map(d => d.bounds.x + d.bounds.width)), maxY = Math.max(...ds.map(d => d.bounds.y + d.bounds.height));
  const sc = Math.min(560 / (maxX - minX), 140 / (maxY - minY));
  const offX = (100 - 0) + (560 - (maxX - minX) * sc) / 2;
  return `
<div class="page">
  <h1>显示器</h1>
  <p class="lead">多显示器、4K 与高 DPI 屏幕可分别设置图标与文字缩放。围栏会记住自己所在的显示器，插拔显示器后自动归位。</p>
  <div class="mon-map">${ds.map((d, i) => `<div class="mon ${d.primary ? 'p' : ''}" style="left:${offX + (d.bounds.x - minX) * sc}px;top:${15 + (d.bounds.y - minY) * sc}px;width:${d.bounds.width * sc - 4}px;height:${d.bounds.height * sc - 4}px"><div>${i + 1}<small>${d.size.w}×${d.size.h} · ${Math.round(d.scale * 100)}%</small></div></div>`).join('')}</div>
  ${ds.map((d, i) => `
  <h2>${i + 1}. ${esc(d.label)} ${d.primary ? '<span class="pill">主显示器</span>' : ''}</h2>
  <div class="group">
    ${row('▭', '分辨率与缩放', `${d.size.w} × ${d.size.h} 像素 · 系统缩放 ${Math.round(d.scale * 100)}% · ${d.fences} 个围栏`, `<span class="chip">${d.size.w >= 3800 ? '4K' : d.size.w >= 2500 ? '2K' : 'FHD'}</span>`)}
    ${row('▦', '图标缩放', '在系统缩放基础上额外放大/缩小围栏图标', `<input type="range" min="0.6" max="2" step="0.05" value="${d.settings.iconScale || 1}" data-disp="${esc(d.key)}" data-dk="iconScale"><span class="rv">${Math.round((d.settings.iconScale || 1) * 100)}%</span>`)}
    ${row('A', '文字缩放', '围栏标题与图标名称', `<input type="range" min="0.8" max="1.6" step="0.05" value="${d.settings.fontScale || 1}" data-disp="${esc(d.key)}" data-dk="fontScale"><span class="rv">${Math.round((d.settings.fontScale || 1) * 100)}%</span>`)}
    ${row('◉', '在此显示器显示围栏', '关闭后该屏幕上的围栏会被隐藏（不删除）', toggle(d.settings.showFences !== false, `data-disp="${esc(d.key)}" data-dk="showFences"`))}
  </div>`).join('')}
</div>`;
};

pages.general = () => {
  const g = P.cfg.general;
  return `
<div class="page">
  <h1>通用</h1>
  <p class="lead">外观主题、启动方式与桌面行为。</p>
  <div class="group">
    ${row('◐', '外观', '围栏与设置窗口的深浅色', seg([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']], g.theme, 'data-cfgseg="general.theme"'))}
    ${row('⏻', '开机自动启动', '登录 Windows 后在后台运行', toggle(g.autoStart, 'data-cfg="general.autoStart"'))}
    ${row('▦', '收纳方式', g.stowMode === 'move' ? '文件移动到收纳文件夹中，桌面上不再保留' : '文件保留在桌面原路径、不移动，只把桌面上的图标收起（移出围栏即恢复）', seg([['inPlace', '原位（留在桌面）'], ['move', '移入收纳文件夹']], g.stowMode === 'move' ? 'move' : 'inPlace', 'data-cfgseg="general.stowMode"'))}
    ${g.stowMode === 'move' ? row('📁', '收纳文件夹', esc(P.storeRoot || ''), `<button class="btn" data-act="openStore">打开</button>`) : ''}
    ${row('↩', '退出 ZTABLE 时放回桌面', '退出时把隐藏的图标放回桌面（或把文件移回），下次启动自动重新收纳；关闭后退出时保持收纳状态', toggle(g.returnOnQuit !== false, 'data-cfg="general.returnOnQuit"'))}
    ${row('🖱', '桌面右键拖拽创建围栏', '在桌面空白处按住右键拖出选择框；单击右键仍弹出系统菜单', toggle(g.rightDragCreate, 'data-cfg="general.rightDragCreate"'))}
    ${row('⊞', '围栏吸附', '拖动时自动对齐屏幕边缘与其他围栏', toggle(g.snap, 'data-cfg="general.snap"'))}
  </div>
  <h2>兼容性</h2>
  <div class="group">
    ${row('🖥', '当前系统', esc(P.caps ? P.caps.label : ''), `<span class="chip ${P.caps && P.caps.supported ? 'b' : ''}">${P.caps && P.caps.supported ? '受支持' : '低于 1903'}</span>`)}
    ${row('🧩', '兼容模式（软件渲染）', '围栏出现黑底、闪烁、花屏或软件闪退时开启；会略增加 CPU 占用', toggle(!!P.softRender, 'data-act="toggleSoft"'))}
  </div>
  <h2>数据与恢复</h2>
  <div class="group">
    ${row('↺', '全部放回桌面', '把所有围栏里来自桌面的项目移回桌面，并清空围栏（围栏本身保留）', `<button class="btn" data-act="returnAll">全部放回</button>`)}
    ${row('◐', '恢复显示桌面图标', '快速隐藏后图标没有回来时使用', `<button class="btn" data-act="restoreIcons">恢复</button>`)}
    ${row('⇪', '导出 / 导入配置', '备份或迁移围栏布局、规则与快捷键', `<button class="btn" data-act="exportConfig">导出</button><button class="btn" data-act="importConfig">导入</button>`)}
    ${row('📁', '配置目录', esc(P.paths.userData), `<button class="btn" data-act="openConfigDir">打开</button>`)}
  </div>
</div>`;
};

pages.about = () => `
<div class="page">
  <div class="card" style="padding:30px;display:flex;gap:26px;align-items:center">
    <img src="../assets/logo_full.png" style="width:150px" alt="ZTABLE">
    <div><h1 style="margin:0">ZTABLE</h1><p class="muted">版本 ${esc(P.version)} · Windows 11 桌面整理工具</p>
    <p class="muted" style="margin-top:8px">桌面围栏 · 自动归类 · 文件夹门户 · 快速隐藏 · 卷起标题 · 外观自定义 · 速览</p>
    <div class="flex mt"><button class="btn" data-act="privacy">用户隐私协议</button><button class="btn" data-act="welcome">查看欢迎页</button><button class="btn ghost danger" data-act="quit">退出 ZTABLE</button></div></div>
  </div>
  <h2>隐私承诺</h2>
  <div class="note">🔒 <span>ZTABLE 完全在本机运行，不联网、不收集任何数据。收纳的桌面项目在拖出围栏、删除围栏、退出或卸载时都会回到桌面。</span></div>
</div>`;

// ===================== 渲染 & 事件 =====================
let lastSig = '';
function render(anim) {
  if (!P) return;
  lastSig = page + '|' + (curFence || '') + '|' + (capturing || '') + '|' + JSON.stringify(P);
  document.body.classList.toggle('dark', P.theme === 'dark');
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.page === page));
  const fn = pages[page] || pages.home;
  const scroll = $('#content').scrollTop;
  $('#content').innerHTML = fn();
  const pg = $('#content .page');
  if (pg && anim) pg.classList.add('anim');
  $('#content').scrollTop = anim ? 0 : scroll;
  bind();
}
function go(p, fenceId) {
  page = p; if (fenceId) curFence = fenceId;
  render(true);
}

const actions = {
  async oneClick() { const r = await cmd('oneClick'); toast(`已创建分类围栏，归类 ${r.total} 个项目`); go('home'); },
  async blankStart() { await cmd('blankStart'); toast('在桌面空白处按住右键拖拽，即可创建围栏'); go('home'); },
  drawFence() { cmd('drawFence'); },
  async newFence() { const id = await cmd('newFence'); go('fences', id); },
  async newPortal() { const id = await cmd('newPortal'); if (id) { toast('门户已创建'); } },
  async organize() { const r = await cmd('organize'); toast(r.total ? `已归类 ${r.total} 个项目` : '没有需要归类的新项目'); },
  quickHide() { cmd('quickHide'); },
  peek() { cmd('peek'); },
  addRule() { ruleEditor(null); },
  async addExclude() {
    const files = await cmd('pickFiles');
    if (files && files.length) await setCfg('quickHide.excludes', Array.from(new Set(P.cfg.quickHide.excludes.concat(files))));
    render();
  },
  async restoreIcons() { const n = await cmd('restoreIcons'); toast(`已恢复 ${n} 个图标`); },
  exportConfig() { cmd('exportConfig').then(ok => ok && toast('配置已导出')); },
  importConfig() { cmd('importConfig').then(ok => ok && toast('配置已导入')); },
  openConfigDir() { cmd('openConfigDir'); },
  async changePortal() {
    const f = fenceById(curFence); const dir = await cmd('pickFolder', f.portalPath);
    if (dir) { await zt.invoke('fence:update', curFence, { portalPath: dir, name: dir.split(/[\\/]/).filter(Boolean).pop() || dir }); }
  },
  styleAll() { const f = fenceById(curFence); if (f) { zt.invoke('fence:styleAll', f.style); toast('已应用到全部围栏'); } },
  async privacy() {
    const md = await cmd('readPrivacy');
    modal(`<div class="mb md" style="padding-top:20px">${mdToHtml(md)}</div><div class="mf"><button class="btn primary" id="okP">我知道了</button></div>`, m => { $('#okP', m).onclick = closeModal; });
  },
  welcome() { go('welcome'); },
  async toggleSoft() { await cmd('softRender', !P.softRender); },
  async returnAll() { const r = await cmd('returnAll'); if (r) toast(`已放回桌面 ${r.n} 个项目`); },
  openStore() { cmd('openStore'); },
  quit() { cmd('quit'); }
};

function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  let out = '', list = null;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const l of lines) {
    let m;
    if ((m = /^# (.*)/.exec(l))) { close(); out += `<h1>${inline(m[1])}</h1>`; }
    else if ((m = /^## (.*)/.exec(l))) { close(); out += `<h2>${inline(m[1])}</h2>`; }
    else if ((m = /^\d+\. (.*)/.exec(l))) { if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; }
    else if ((m = /^- (.*)/.exec(l))) { if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
    else if (/^---/.test(l)) { close(); out += '<hr>'; }
    else if (l.trim()) { close(); out += `<p>${inline(l)}</p>`; }
  }
  close();
  return out;
}

let styleTimer = null;
function bind() {
  const c = $('#content');
  $$('[data-act]', c).forEach(n => n.addEventListener('click', () => actions[n.dataset.act] && actions[n.dataset.act]()));
  $$('[data-flash]', c).forEach(n => n.addEventListener('click', (e) => { e.stopPropagation(); zt.invoke('fence:flash', n.dataset.flash); }));
  $$('[data-editf]', c).forEach(n => n.addEventListener('click', () => go('fences', n.dataset.editf)));
  $$('[data-delf]', c).forEach(n => n.addEventListener('click', () => zt.invoke('fence:delete', n.dataset.delf)));
  $$('[data-openpath]', c).forEach(n => n.addEventListener('click', () => cmd('openPath', n.dataset.openpath)));
  $$('[data-portal]', c).forEach(n => n.addEventListener('click', async () => { await cmd('newPortal', n.dataset.portal); toast('门户已创建到桌面'); }));
  $$('[data-fid]', c).forEach(n => n.addEventListener('click', () => { curFence = n.dataset.fid; render(); zt.invoke('fence:flash', curFence); }));

  // 通用配置开关
  $$('[data-cfg]', c).forEach(n => n.addEventListener('click', async () => {
    const key = n.dataset.cfg; const cur = key.split('.').reduce((o, k) => o[k], P.cfg);
    n.classList.toggle('on', !cur);
    await setCfg(key, !cur); render();
  }));
  $$('[data-cfgseg]', c).forEach(sg => $$('button', sg).forEach(b => b.addEventListener('click', async () => { await setCfg(sg.dataset.cfgseg, b.dataset.v); render(); })));
  $$('[data-cfgnum]', c).forEach(n => n.addEventListener('input', () => {
    n.nextElementSibling.textContent = Math.round(n.value * 100) + '%';
    clearTimeout(n._t); n._t = setTimeout(() => setCfg(n.dataset.cfgnum, parseFloat(n.value)), 120);
  }));

  // 围栏编辑
  const fid = curFence;
  const upd = (patch) => { lastEdit = Date.now(); return zt.invoke('fence:update', fid, patch); };
  const fName = $('#fName', c);
  if (fName) {
    fName.addEventListener('input', () => { clearTimeout(fName._t); fName._t = setTimeout(() => upd({ name: fName.value.trim() || '围栏' }), 250); });
    fName.addEventListener('keydown', (e) => { if (e.key === 'Enter') fName.blur(); });
  }
  $$('[data-style]', c).forEach(n => n.addEventListener('input', () => {
    const k = n.dataset.style;
    const v = n.dataset.num ? parseFloat(n.value) : n.value;
    const rv = $(`[data-rv="${k}"]`, c);
    if (rv) rv.textContent = k === 'opacity' ? Math.round(v * 100) + '%' : v + (k === 'radius' || k === 'titleSize' || k === 'iconSize' ? ' px' : '');
    const f = fenceById(fid); if (f) f.style[k] = v;
    const pv = $('.preview-wrap', c); if (pv && f) pv.innerHTML = fencePreview(f);
    clearTimeout(styleTimer); styleTimer = setTimeout(() => upd({ style: { [k]: v } }), 60);
  }));
  $$('[data-accent]', c).forEach(n => n.addEventListener('click', async () => { await upd({ style: { accent: n.dataset.accent } }); }));
  $$('[data-bgmode] button', c).forEach(b => b.addEventListener('click', async () => {
    await upd({ style: { bg: b.dataset.v === 'auto' ? 'auto' : (P.theme === 'dark' ? '#22262E' : '#FBFBFC') } });
  }));
  $$('[data-sseg]', c).forEach(sg => $$('button', sg).forEach(b => b.addEventListener('click', async () => {
    const v = sg.dataset.num ? parseInt(b.dataset.v, 10) : b.dataset.v;
    await upd({ style: { [sg.dataset.sseg]: v } });
  })));
  $$('[data-stoggle]', c).forEach(n => n.addEventListener('click', async () => { const f = fenceById(fid); await upd({ style: { [n.dataset.stoggle]: !f.style[n.dataset.stoggle] } }); }));
  $$('[data-ftoggle]', c).forEach(n => n.addEventListener('click', async () => { const f = fenceById(fid); await upd({ [n.dataset.ftoggle]: !f[n.dataset.ftoggle] }); }));
  const fW = $('#fW', c), fH = $('#fH', c);
  if (fW && fH) [fW, fH].forEach(n => n.addEventListener('change', () => upd({ bounds: { width: Math.max(140, +fW.value), height: Math.max(70, +fH.value) } })));

  // 规则
  $$('[data-rtoggle]', c).forEach(n => n.addEventListener('click', async () => {
    const rules = P.cfg.rules.map(r => r.id === n.dataset.rtoggle ? Object.assign({}, r, { enabled: r.enabled === false }) : r);
    await zt.invoke('rules:set', rules);
  }));
  $$('[data-redit]', c).forEach(n => n.addEventListener('click', () => ruleEditor(P.cfg.rules.find(r => r.id === n.dataset.redit))));
  $$('[data-rdel]', c).forEach(n => n.addEventListener('click', async () => { await zt.invoke('rules:set', P.cfg.rules.filter(r => r.id !== n.dataset.rdel)); }));
  const move = async (i, d) => { const rules = P.cfg.rules.slice(); const [x] = rules.splice(i, 1); rules.splice(i + d, 0, x); await zt.invoke('rules:set', rules); };
  $$('[data-rup]', c).forEach(n => n.addEventListener('click', () => move(+n.dataset.rup, -1)));
  $$('[data-rdown]', c).forEach(n => n.addEventListener('click', () => move(+n.dataset.rdown, 1)));

  // 快速隐藏
  $$('[data-keep]', c).forEach(n => n.addEventListener('click', async () => { const f = fenceById(n.dataset.keep); lastEdit = 0; await zt.invoke('fence:update', f.id, { keepOnQuickHide: !f.keepOnQuickHide }); }));
  $$('[data-unex]', c).forEach(n => n.addEventListener('click', async () => { const ex = P.cfg.quickHide.excludes.slice(); ex.splice(+n.dataset.unex, 1); await setCfg('quickHide.excludes', ex); render(); }));

  // 快捷键
  $$('[data-cap]', c).forEach(n => n.addEventListener('click', async () => {
    const id = n.dataset.cap;
    if (capturing === id) { capturing = null; await cmd('cancelCapture'); render(); return; }
    capturing = id;
    const ok = await cmd('captureHotkey', id);
    if (!ok) { capturing = null; toast('全局快捷键服务未就绪'); }
    render();
  }));
  $$('[data-clr]', c).forEach(n => n.addEventListener('click', async () => { await setCfg('hotkeys.' + n.dataset.clr, ''); render(); }));
  $$('[data-hkdef]', c).forEach(n => n.addEventListener('click', async () => { await setCfg('hotkeys.peek', 'Win+Space'); render(); }));

  // 显示器
  $$('[data-disp]', c).forEach(n => {
    const key = n.dataset.disp, dk = n.dataset.dk;
    if (n.tagName === 'INPUT') {
      n.addEventListener('input', () => {
        n.nextElementSibling.textContent = Math.round(n.value * 100) + '%';
        clearTimeout(n._t); n._t = setTimeout(async () => { lastEdit = Date.now(); P = await zt.invoke('display:set', key, { [dk]: parseFloat(n.value) }); }, 150);
      });
    } else n.addEventListener('click', async () => {
      const cur = (P.cfg.displays[key] || {})[dk]; P = await zt.invoke('display:set', key, { [dk]: cur === false }); render();
    });
  });
}

$$('#nav a').forEach(a => a.addEventListener('click', () => go(a.dataset.page)));

zt.on('cfg:changed', (p) => {
  P = p;
  const active = document.activeElement;
  const editing = active && (active.tagName === 'INPUT' && (active.type === 'text' || active.type === 'number' || active.type === 'range'));
  if ($('#modalBg').classList.contains('on')) return;
  if (page + '|' + (curFence || '') + '|' + (capturing || '') + '|' + JSON.stringify(P) === lastSig) return;
  if (editing || Date.now() - lastEdit < 350 && page === 'fences') { setTimeout(() => { if (Date.now() - lastEdit >= 350 && !(document.activeElement && document.activeElement.type === 'range')) render(); }, 420); return; }
  render();
});
zt.on('settings:goto', ({ page: p, fenceId }) => go(p, fenceId));
zt.on('hotkey:captured', async ({ id, combo }) => {
  const target = capturing || id; capturing = null;
  if (combo && target) {
    const valid = await cmd('validateHotkey', combo);
    if (!valid) { toast('请使用包含 Win / Ctrl / Alt 的组合键'); render(); return; }
    const dup = Object.keys(P.cfg.hotkeys).find(k => k !== target && P.cfg.hotkeys[k] === combo);
    if (dup) { toast('该组合键已被其他功能使用'); render(); return; }
    await setCfg('hotkeys.' + target, combo); toast('快捷键已设置为 ' + combo);
  }
  render();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modalBg').classList.contains('on')) closeModal(); });

zt.invoke('cfg:get').then(p => { P = p; render(true); });
