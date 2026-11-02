// 截取安装向导各页面（不执行安装）：node tools/shoot_installer.js 由 electron 运行
const { app, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
const w = require('../src/win32');
const { koffi, api } = w;
const user32 = koffi.load('user32.dll');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *hwnd, void *buf, int max)');
const EnumChildWindows = user32.func('int __stdcall EnumChildWindows(void *parent, void *cb, intptr_t l)');
const EnumProc = koffi.proto('int __stdcall ZT_ENUMPROC(void *hwnd, intptr_t l)');
const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(void *hwnd)');
const out = path.join(__dirname, 'shots', 'installer');
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function text(h) { const b = Buffer.alloc(1024); const n = GetWindowTextW(h, b, 500); return b.toString('utf16le', 0, n * 2); }
function children(parent) {
  const list = [];
  const cb = koffi.register((h) => { list.push({ h, cls: w.className(h), t: text(h) }); return 1; }, koffi.pointer(EnumProc));
  EnumChildWindows(parent, cb, 0);
  koffi.unregister(cb);
  return list;
}
async function capture(name) {
  const srcs = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1400, height: 1100 } });
  const s = srcs.find(x => /ZTABLE/.test(x.name) && /安装|Setup/.test(x.name)) || srcs.find(x => /ZTABLE/.test(x.name));
  if (s) fs.writeFileSync(path.join(out, name + '.png'), s.thumbnail.toPNG());
  return !!s;
}
app.whenReady().then(async () => {
  const exe = path.join(__dirname, '..', 'dist', 'ZTABLE_Setup_1.0.0.exe');
  const p = spawn(exe, [], { detached: false });
  let hwnd = null;
  for (let i = 0; i < 40 && !hwnd; i++) {
    await wait(500);
    let h = null;
    for (let k = 0; k < 200; k++) { h = api.FindWindowExW(null, h, '#32770', null); if (!h) break; if (/ZTABLE/.test(text(h))) { hwnd = h; break; } }
  }
  const log = { found: !!hwnd, title: hwnd ? text(hwnd) : null, pages: [] };
  if (hwnd) {
    const next = () => api.PostMessageW(hwnd, 0x0111, 1, 0);
    await wait(1200); log.pages.push(['welcome', await capture('1_welcome')]);
    next(); await wait(1000); log.pages.push(['license', await capture('2_license')]);
    const kids = children(hwnd);
    log.licenseCtrls = kids.filter(k => k.cls === 'Button').map(k => k.t);
    const cb = kids.find(k => k.cls === 'Button' && /同意/.test(k.t));
    if (cb) { api.SendMessageW(cb.h, 0x00F5, 0, 0); await wait(400); log.pages.push(['license_checked', await capture('3_license_checked')]); }
    for (let i = 4; i <= 6; i++) {
      next(); await wait(1500);
      log.pages.push(['page' + i, await capture(i + '_page')]);
      const texts = children(hwnd).map(k => k.cls + ':' + k.t).filter(x => x.length > 7);
      log['texts' + i] = texts.slice(0, 14);
      fs.writeFileSync(path.join(out, 'log.json'), JSON.stringify(log, null, 2));
      if (texts.some(x => /^Button:安装|Install/.test(x))) { log.stopAt = i; break; }
    }
  }
  if (process.argv.includes('--finish')) { api.SendMessageW(hwnd, 0x0111, 1, 0); await wait(20000); log.pages.push(['done', await capture('7_done')]); }
  try { process.kill(p.pid); } catch (e) { }
  spawn('taskkill', ['/F', '/IM', 'ZTABLE_Setup_1.0.0.exe']);
  fs.writeFileSync(path.join(out, 'log.json'), JSON.stringify(log, null, 2));
  await wait(500);
  app.exit(0);
});
