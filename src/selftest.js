'use strict';
// 自检/截图模式：--selftest=<输出目录>。使用临时样例文件，不触碰真实桌面文件。
const fs = require('fs');
const path = require('path');

const SAMPLE = [
  '季度汇报.pptx', '产品需求文档.docx', '预算表.xlsx', '合同扫描件.pdf', '会议纪要.md', '读书笔记.txt',
  '海报设计.png', '团建合影.jpg', '图标素材.svg', 'UI 草图.psd',
  'Chrome.url', '安装包.zip', 'setup.msi', '项目A-方案', '项目B-提案', 'data.json'
];

async function prepare(ctx) {
  const dir = path.resolve(ctx.dir);
  const samples = path.join(dir, 'samples');
  fs.mkdirSync(samples, { recursive: true });
  for (const n of SAMPLE) {
    const p = path.join(samples, n);
    if (!path.extname(n) || n.startsWith('项目')) { fs.mkdirSync(p, { recursive: true }); continue; }
    if (!fs.existsSync(p)) fs.writeFileSync(p, n.endsWith('.url') ? '[InternetShortcut]\r\nURL=https://www.microsoft.com/\r\n' : 'ZTABLE sample');
  }
  // 拷几张真实图片做缩略图
  const assets = path.join(__dirname, '..', 'assets');
  try { fs.copyFileSync(path.join(assets, 'logo_source.png'), path.join(samples, '海报设计.png')); } catch (e) { }
  try { fs.copyFileSync(path.join(assets, 'mark.png'), path.join(samples, '团建合影.jpg')); } catch (e) { }
  try { fs.copyFileSync(path.join(__dirname, '..', 'tools', 't2', 'long.png'), path.join(samples, '长截图.png')); } catch (e) { }
  try { fs.copyFileSync(path.join(__dirname, '..', 'tools', 't2', 'rot6.jpg'), path.join(samples, '竖拍照片.jpg')); } catch (e) { }
  try { fs.copyFileSync(path.join(__dirname, '..', 'tools', 't2', 'wide.png'), path.join(samples, '全景.png')); } catch (e) { }
  const sysLinks = [];
  const pd = path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop');
  try { for (const f of fs.readdirSync(pd)) if (/\.lnk$/i.test(f)) sysLinks.push(path.join(pd, f)); } catch (e) { }

  const { cfg } = ctx;
  cfg.general.firstRun = false;
  cfg.general.hideOriginals = false; // 自检不改任何文件属性
  cfg.general.noStow = true;         // 自检不移动任何真实文件（样例里包含公共桌面快捷方式）
  if (cfg.fences.length) return;
  const P = (n) => path.join(samples, n);
  const mk = (o) => ctx.createFence(o);
  const a = mk({ name: '软件', accent: '#3B82F6', items: sysLinks.slice(0, 7).concat([P('Chrome.url')]), bounds: { x: 40, y: 60, width: 330, height: 250 } });
  const b = mk({ name: '文档', accent: '#14B8A6', items: ['季度汇报.pptx', '产品需求文档.docx', '预算表.xlsx', '合同扫描件.pdf', '会议纪要.md', '读书笔记.txt'].map(P), bounds: { x: 390, y: 60, width: 330, height: 250 } });
  const c = mk({ name: '图片', accent: '#A855F7', items: ['长截图.png', '竖拍照片.jpg', '全景.png', '海报设计.png', '图标素材.svg', 'UI 草图.psd'].map(P), bounds: { x: 740, y: 60, width: 330, height: 250 } });
  c.style.iconSize = 64; c.style.opacity = 0.62; if (process.argv.includes('--blurtest')) c.style.blur = true;
  const d = mk({ name: '项目', accent: '#22C55E', items: ['项目A-方案', '项目B-提案', 'data.json'].map(P), bounds: { x: 40, y: 330, width: 330, height: 200 } });
  d.style.titleStyle = 'minimal'; d.style.titleAlign = 'center';
  a.style.opacity = 0.12;   // 低不透明度：标题条与背景同步变淡
  b.style.opacity = 1;
  const e = mk({ name: '样例门户', type: 'portal', portalPath: samples, accent: '#0EA5E9', bounds: { x: 390, y: 330, width: 330, height: 200 } });
  const f = mk({ name: '下载（已卷起）', accent: '#F59E0B', rolledUp: true, items: ['安装包.zip', 'setup.msi'].map(P), bounds: { x: 740, y: 330, width: 330, height: 200 } });
  ctx.cfg.rules.push({ id: 'r1', name: '文档资料', enabled: true, auto: true, source: 'desktop', kind: 'any', exts: ['docx', 'pdf', 'pptx', 'xlsx'], keywords: [], fenceId: b.id });
  ctx.cfg.rules.push({ id: 'r2', name: '新下载的文件', enabled: true, auto: true, source: 'downloads', kind: 'any', exts: [], keywords: [], fenceId: f.id });
  ctx.cfg.rules.push({ id: 'r3', name: '项目关键词', enabled: true, auto: true, source: 'desktop', kind: 'any', exts: [], keywords: ['项目', 'project'], fenceId: d.id });
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function run(ctx) {
  const out = path.resolve(ctx.dir);
  const log = [];
  try {
    await wait(3500);
    for (const [id, win] of ctx.fenceWins) {
      const f = ctx.cfg.fences.find(x => x.id === id);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(out, 'fence_' + (f ? f.name.replace(/[\\/:*?"<>|（）() ]/g, '_') : id) + '.png'), img.toPNG());
      const b = win.getBounds();
      log.push({ id, name: f && f.name, bounds: b, visible: win.isVisible() });
    }
    const sw = ctx.openSettings('welcome');
    await new Promise(r => sw.webContents.once('did-finish-load', r));
    sw.setBounds({ width: 1080, height: 760 });
    await sw.webContents.insertCSS('*{animation:none !important;transition:none !important}');
    await wait(900);
    for (const p of ['welcome', 'home', 'fences', 'rules', 'portals', 'quickhide', 'peek', 'displays', 'general', 'about']) {
      sw.webContents.send('settings:goto', { page: p });
      await wait(700);
      const img = await sw.webContents.capturePage();
      fs.writeFileSync(path.join(out, 'settings_' + p + '.png'), img.toPNG());
    }
    // 规则编辑弹窗
    await sw.webContents.executeJavaScript("document.querySelector('[data-page=rules]').click(); setTimeout(()=>document.querySelector('[data-redit]') && document.querySelector('[data-redit]').click(), 200); true");
    await wait(900);
    fs.writeFileSync(path.join(out, 'settings_rule_editor.png'), (await sw.webContents.capturePage()).toPNG());
    // 深色主题
    ctx.cfg.general.theme = 'dark';
    require('electron').nativeTheme.themeSource = 'dark';
    await wait(1200);
    for (const [id, win] of ctx.fenceWins) {
      const f = ctx.cfg.fences.find(x => x.id === id);
      if (f && f.name === '文档') fs.writeFileSync(path.join(out, 'fence_dark_文档.png'), (await win.webContents.capturePage()).toPNG());
    }
    sw.webContents.send('settings:goto', { page: 'fences' });
    await wait(900);
    fs.writeFileSync(path.join(out, 'settings_fences_dark.png'), (await sw.webContents.capturePage()).toPNG());
  } catch (e) {
    log.push({ error: String(e && e.stack || e) });
  }
  fs.writeFileSync(path.join(out, 'selftest.json'), JSON.stringify(log, null, 2));
  ctx.app.exit(0);
}

async function live(ctx) {
  const { desktopCapturer, screen } = require('electron');
  const out = path.resolve(ctx.dir);
  const log = {};
  const shot = async (name) => {
    const d = screen.getPrimaryDisplay();
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * d.scaleFactor / 2), height: Math.round(d.size.height * d.scaleFactor / 2) } });
    if (!srcs[0]) return;
    // 只保留围栏区域，避免截到用户其他窗口内容
    let img = srcs[0].thumbnail;
    const k = d.scaleFactor / 2;
    let L = 1e9, T = 1e9, R = 0, B = 0;
    for (const w of ctx.fenceWins.values()) { const b = w.getBounds(); L = Math.min(L, b.x); T = Math.min(T, b.y); R = Math.max(R, b.x + b.width); B = Math.max(B, b.y + b.height); }
    img = img.crop({ x: Math.max(0, Math.round((L - d.bounds.x) * k)), y: Math.max(0, Math.round((T - d.bounds.y) * k)), width: Math.round((R - L) * k), height: Math.round((B - T) * k) });
    fs.writeFileSync(path.join(out, name), img.toPNG());
  };
  try {
    await wait(4000);
    const progman = ctx.win32.findProgman();
    log.progman = String(progman);
    log.owners = [];
    for (const [id, win] of ctx.fenceWins) {
      const h = ctx.win32.hwndFromBuffer(win.getNativeWindowHandle());
      log.owners.push({ visible: win.isVisible(), owner: String(ctx.win32.api.GetWindowLongPtrW(h, -8)) });
    }
    log.hook = ctx.hookStatus();
    ctx.setPeek(true);
    await wait(1500);
    await shot('live_peek.png');
    ctx.setPeek(false);
    await wait(800);
    log.afterPeek = Array.from(ctx.fenceWins.values()).map(w => w.isAlwaysOnTop());
  } catch (e) { log.error = String(e && e.stack || e); }
  fs.writeFileSync(path.join(out, 'live.json'), JSON.stringify(log, null, 2));
  ctx.app.quit();
}

// 拖拽回归测试：设置两个围栏，导出坐标，等待外部脚本模拟鼠标
async function dragPrep(ctx) {
  const out = path.resolve(ctx.dir);
  await wait(3000);
  ctx.setPeek(true);
  await wait(1500);
  const ids = Array.from(ctx.fenceWins.keys()).filter(id => {
    const f = ctx.cfg.fences.find(x => x.id === id);
    return f && f.type === 'normal' && f.items.length > 2;
  });
  const res = { fences: [] };
  if (ids.length >= 2) {
    const rect = async (id) => {
      const win = ctx.fenceWins.get(id);
      const b = win.getBounds();
      const r = await win.webContents.executeJavaScript("(()=>{const it=document.querySelector('.item');if(!it)return null;const r=it.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
      if (!r) return null;
      const d = require('electron').screen.getDisplayMatching(b);
      return { x: Math.round((b.x + r.x) * d.scaleFactor), y: Math.round((b.y + r.y) * d.scaleFactor) };
    };
    const before = ctx.cfg.fences.map(f => ({ id: f.id, n: f.items.length }));
    res.from = await rect(ids[0]);
    const wb = ctx.fenceWins.get(ids[1]).getBounds();
    const d2 = require('electron').screen.getDisplayMatching(wb);
    res.to = { x: Math.round((wb.x + wb.width * 0.55) * d2.scaleFactor), y: Math.round((wb.y + wb.height * 0.7) * d2.scaleFactor) };
    res.fromId = ids[0]; res.toId = ids[1]; res.before = before;
    fs.writeFileSync(path.join(out, 'drag.json'), JSON.stringify(res));
  } else fs.writeFileSync(path.join(out, 'drag.json'), JSON.stringify({ error: 'not enough fences' }));
  await wait(14000);
  const after = ctx.cfg.fences.map(f => ({ id: f.id, n: f.items.length }));
  fs.writeFileSync(path.join(out, 'after.json'), JSON.stringify({ after, alive: true, res }));
  ctx.app.quit();
}

// 收纳（真实移动）测试：用「假桌面」验证 移入 / 移出 / 删除围栏 / 退出 全流程（不会触碰真实桌面）
async function quitTest(ctx) {
  const out = path.resolve(ctx.dir);
  const desk = path.join(out, 'Desktop');
  fs.mkdirSync(desk, { recursive: true });
  const files = ['测试文档.docx', '测试图片.png', '测试项目文件夹', '微信.lnk'];
  const mk = () => { for (const n of files) { const p = path.join(desk, n); if (fs.existsSync(p)) continue; if (n.endsWith('文件夹')) { fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, 'a.txt'), 'x'); } else fs.writeFileSync(p, 'demo-' + n); } };
  const w = require('./win32');
  const onDesk = () => files.map(n => fs.existsSync(path.join(desk, n)));          // 文件是否仍在桌面原路径
  const hidden = () => files.map(n => w.isHiddenAttr(path.join(desk, n)));          // 桌面图标是否被隐藏
  const log = { mode: ctx.cfg.general.stowMode };
  mk();
  ctx.cfg.general.firstRun = false;
  ctx.cfg.general.stowMode = 'inPlace';
  ctx.cfg.fences = [];
  const steps = [];
  // 1) 拖入围栏 → 文件仍在桌面原路径、但图标被隐藏
  const f1 = ctx.createFence({ name: '测试围栏', items: files.map(n => path.join(desk, n)), bounds: { x: 60, y: 60, width: 300, height: 220 } });
  steps.push({ step: '1 拖入围栏', 文件仍在桌面: onDesk(), 图标已隐藏: hidden(), 路径未变: f1.items.map((i, idx) => i.path === path.join(desk, files[idx])) });
  // 2) 拖出一个（移出围栏）→ 该项目图标重新出现
  ctx.removeItems(f1, [f1.items[0].path]);
  steps.push({ step: '2 拖出 1 个', 文件仍在桌面: onDesk(), 图标已隐藏: hidden(), 围栏剩余: f1.items.length });
  // 3) 删除围栏（不退出软件）→ 全部图标恢复
  ctx.deleteFence(f1.id, true);
  steps.push({ step: '3 删除围栏', 文件仍在桌面: onDesk(), 图标已隐藏: hidden() });
  // 4) 再次收纳，准备退出测试
  const f2 = ctx.createFence({ name: '退出测试', items: files.map(n => path.join(desk, n)), bounds: { x: 60, y: 60, width: 300, height: 220 } });
  steps.push({ step: '4 再次收纳', 文件仍在桌面: onDesk(), 图标已隐藏: hidden() });
  ctx.save();
  log.steps = steps;
  fs.writeFileSync(path.join(out, 'quit-mid.json'), JSON.stringify(log, null, 2));
  if (process.argv.includes('--stay')) return;   // 等待外部强制结束（看门狗测试）
  await wait(500);
  ctx.app.quit();
}

// 重启测试：沿用已有配置启动，检查是否自动收回
async function restartCheck(ctx) {
  const out = path.resolve(ctx.dir);
  const desk = path.join(out, 'Desktop');
  const f = ctx.cfg.fences[0];
  const w = require('./win32');
  const res = { onDesktop: fs.readdirSync(desk), items: f ? f.items.map(i => ({ onDesk: fs.existsSync(i.path), hidden: w.isHiddenAttr(i.path), inPlace: !!i.inPlace })) : [] };
  fs.writeFileSync(path.join(out, 'restart.json'), JSON.stringify(res, null, 2));
  if (process.argv.includes('--stay')) return;
  ctx.app.quit();
}

// 拖回桌面测试（真实桌面上的探针文件）：从围栏拖到桌面空白处，不应弹出「源文件名和目标文件名相同」
async function deskDrop(ctx) {
  const out = path.resolve(ctx.dir);
  const { screen } = require('electron');
  const probe = path.join(ctx.ds.userDesktop(), 'ZTABLE_dragprobe.zt_probe');
  try { ctx.win32.setHiddenAttr(probe, false); } catch (e) { }
  fs.writeFileSync(probe, 'probe');
  ctx.cfg.general.firstRun = false; ctx.cfg.general.stowMode = 'inPlace'; ctx.cfg.fences = []; ctx.cfg.rules = [];
  const tgt = JSON.parse(process.env.ZT_TARGET);            // { fence:{x,y}(DIP), drop:{x,y}(物理像素) }
  const f = ctx.createFence({ name: '拖回桌面测试', items: [probe], bounds: { x: tgt.fence.x, y: tgt.fence.y, width: 260, height: 170 } });
  await wait(3000);
  const win = ctx.fenceWins.get(f.id);
  const b = win.getBounds();
  const r = await win.webContents.executeJavaScript("(()=>{const it=document.querySelector('.item');if(!it)return null;const r=it.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  const d = screen.getDisplayMatching(b);
  const from = r ? { x: Math.round((b.x + r.x) * d.scaleFactor), y: Math.round((b.y + r.y) * d.scaleFactor) } : null;
  const res = { from, to: tgt.drop, hiddenBefore: ctx.win32.isHiddenAttr(probe), underFrom: from ? ctx.win32.className(ctx.win32.api.WindowFromPoint(from)) : null };
  fs.writeFileSync(path.join(out, 'drag.json'), JSON.stringify(res));
  await wait(9000);
  const findDlg = () => { const h = ctx.win32.api.FindWindowW('OperationStatusWindow', null); return !!(h && ctx.win32.api.IsWindowVisible(h)); };
  res.dialog = findDlg();
  res.fenceItems = f.items.length;
  res.probeOnDesktop = fs.existsSync(probe);
  res.hiddenAfter = ctx.win32.isHiddenAttr(probe);
  res.copies = fs.readdirSync(ctx.ds.userDesktop()).filter(n => /^ZTABLE_dragprobe/i.test(n));
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(res, null, 2));
  try { ctx.win32.setHiddenAttr(probe, false); fs.unlinkSync(probe); } catch (e) { }
  ctx.app.quit();
}

module.exports = { prepare, run, live, dragPrep, quitTest, restartCheck, deskDrop };
