'use strict';
// ZTABLE 输入钩子进程：低级键盘/鼠标钩子（全局快捷键、双击桌面空白、右键拖拽创建围栏）
// 以 ELECTRON_RUN_AS_NODE 方式运行，独占线程做消息泵，保证钩子响应及时、不拖慢系统输入。
const w = require('./win32');
const hk = require('./hotkeys');
const { koffi, api } = w;

const MARKER = 0x5A54424C; // 'ZTBL'
const WH_KEYBOARD_LL = 13, WH_MOUSE_LL = 14;
const QS_ALLINPUT = 0x04FF, MWMO_INPUTAVAILABLE = 0x4;

try { api.SetProcessDpiAwarenessContext(-4); } catch (e) { }
let accOk = true;
try { w.oleacc().CoInitializeEx(null, 0x2); } catch (e) { accOk = false; }

let cfg = { hotkeys: [], dblClick: true, rdrag: true };
let parsedHotkeys = [];
let capture = false;
const swallowUp = new Set();
const queue = [];

function send(msg) { try { if (process.send) process.send(msg); } catch (e) { } }
function log(s) { send({ type: 'log', msg: String(s) }); if (process.env.ZT_HOOKLOG) try { require('fs').appendFileSync(process.env.ZT_HOOKLOG, Date.now() + ' ' + s + '\n'); } catch (e) { } }

function applyConfig(c) {
  cfg = Object.assign(cfg, c || {});
  parsedHotkeys = [];
  for (const h of (cfg.hotkeys || [])) {
    const p = hk.parse(h.combo);
    if (p) parsedHotkeys.push(Object.assign({ id: h.id }, p));
  }
}

let graceful = false;
process.on('message', m => {
  if (!m || !m.type) return;
  if (m.type === 'config') applyConfig(m.config);
  else if (m.type === 'capture') { capture = true; }
  else if (m.type === 'cancelCapture') { capture = false; }
  else if (m.type === 'quit') { graceful = true; shutdown(); }
  else if (m.type === 'oleDrag') { log('oleDrag ' + m.on); oleDrag = m.on ? { hwnd: m.hwnd ? BigInt(m.hwnd) : null, at: Date.now() } : null; }
});
// 围栏图标正在进行系统拖放（OLE）时由主进程告知；用于拦截「放到桌面空白处」
let oleDrag = null;
// 看门狗：主进程崩溃或被强制结束时，按日志把桌面图标全部还原
function watchdogRestore() {
  const file = process.env.ZT_JOURNAL;
  if (!file) return;
  let j = null;
  try { j = JSON.parse(require('fs').readFileSync(file, 'utf8')); } catch (e) { return; }
  if (!j) return;
  let n = 0;
  for (const p of (j.paths || [])) { try { if (w.setHiddenAttr(p, false)) n++; } catch (e) { } }
  // 收纳在 ZTABLE 收纳文件夹里的桌面项目移回桌面
  const fs = require('fs'), path = require('path');
  const returned = [];
  for (const it of (j.stowed || [])) {
    try {
      if (!it.path || !fs.existsSync(it.path)) continue;
      const dir = (it.originDir && fs.existsSync(it.originDir)) ? it.originDir : path.dirname(it.origin);
      const name = path.basename(it.origin || it.path);
      let dst = path.join(dir, name);
      const ext = path.extname(name), base = path.basename(name, ext);
      for (let i = 2; fs.existsSync(dst) && i < 1000; i++) dst = path.join(dir, base + ' (' + i + ')' + ext);
      fs.renameSync(it.path, dst);
      returned.push({ from: it.path, to: dst });
      n++;
    } catch (e) { }
  }
  if (j.iconsHidden) { try { w.setDesktopIconsVisible(true); } catch (e) { } }
  try {
    for (const d of (process.env.ZT_DESKTOPS || '').split('|').filter(Boolean)) {
      api.SHChangeNotify(0x00001000, 0x0005 | 0x1000, d, null);
    }
  } catch (e) { }
  try { require('fs').writeFileSync(file, JSON.stringify({ paths: [], iconsHidden: false, stowed: [], parked: [], returned, restoredBy: 'watchdog', at: Date.now(), count: n })); } catch (e) { }
}
process.on('disconnect', () => { if (!graceful) watchdogRestore(); shutdown(); });

// ===== 注入输入 =====
function mouseInput(flags) {
  const b = Buffer.alloc(40);
  b.writeUInt32LE(0, 0);
  b.writeUInt32LE(flags, 8 + 12);
  b.writeBigUInt64LE(BigInt(MARKER), 32);
  return b;
}
function keyInput(vk, up) {
  const b = Buffer.alloc(40);
  b.writeUInt32LE(1, 0);
  b.writeUInt16LE(vk, 8);
  b.writeUInt32LE(up ? 0x2 : 0, 8 + 4);
  b.writeBigUInt64LE(BigInt(MARKER), 8 + 16);
  return b;
}
function sendInputs(list) {
  const buf = Buffer.concat(list);
  api.SendInput(list.length, buf, 40);
}
// 吞掉 Win 组合键后注入一个无意义按键，阻止松开 Win 时弹出开始菜单
function suppressStartMenu() { sendInputs([keyInput(0xE8, false), keyInput(0xE8, true)]); }

// ===== 桌面命中测试 =====
const DESKTOP_ROOTS = new Set(['Progman', 'WorkerW']);
function desktopKind(hwnd) {
  if (!hwnd) return null;
  const cls = w.className(hwnd);
  if (cls === 'SysListView32') {
    const parent = api.GetParent(hwnd);
    if (w.className(parent) !== 'SHELLDLL_DefView') return null;
    const root = api.GetAncestor(hwnd, 2);
    if (!DESKTOP_ROOTS.has(w.className(root))) return null;
    return 'list';
  }
  if (cls === 'SHELLDLL_DefView' || cls === 'WorkerW' || cls === 'Progman') {
    const root = api.GetAncestor(hwnd, 2);
    if (!DESKTOP_ROOTS.has(w.className(root))) return null;
    return 'bg';
  }
  return null;
}

const varBuf = Buffer.alloc(24);

// 跳过 ZTABLE 自己的窗口（拖拽图像、围栏）与不可见/被隐藏的窗口，找出光标下真正的目标顶层窗口
const u32 = koffi.load('user32.dll');
const GetTopWindow = u32.func('void * __stdcall GetTopWindow(void *h)');
const GetWindowZ = u32.func('void * __stdcall GetWindow(void *h, uint32 cmd)');
const GetWindowThreadProcessId = u32.func('uint32 __stdcall GetWindowThreadProcessId(void *h, _Out_ uint32 *pid)');
let dwmGet = null;
try { dwmGet = koffi.load('dwmapi.dll').func('int32 __stdcall DwmGetWindowAttribute(void *h, uint32 a, _Out_ uint32 *v, uint32 n)'); } catch (e) { }
const MAIN_PID = Number(process.env.ZT_MAINPID || 0);

// ===== 拖放「吸收窗」=====
// 一个不注册任何拖放目标的透明小窗口。拖到桌面空白处松开时把它垫在光标下面，
// 系统拖放会落到「无目标」处（DROPEFFECT_NONE），资源管理器收不到这次放下。
let sinkHwnd = null;
function ensureSink() {
  if (sinkHwnd) return sinkHwnd;
  try {
    const k32 = koffi.load('kernel32.dll');
    const GetProcAddress = k32.func('void * __stdcall GetProcAddress(void *m, str name)');
    const LoadLibraryW = k32.func('void * __stdcall LoadLibraryW(str16 n)');
    const WNDCLASSEXW = koffi.struct('ZT_WNDCLASSEXW', {
      cbSize: 'uint32', style: 'uint32', lpfnWndProc: 'void *', cbClsExtra: 'int', cbWndExtra: 'int', hInstance: 'void *',
      hIcon: 'void *', hCursor: 'void *', hbrBackground: 'void *', lpszMenuName: 'str16', lpszClassName: 'str16', hIconSm: 'void *'
    });
    const RegisterClassExW = u32.func('uint16 __stdcall RegisterClassExW(ZT_WNDCLASSEXW *wc)');
    const CreateWindowExW = u32.func('void * __stdcall CreateWindowExW(uint32 ex, str16 cls, str16 name, uint32 style, int x, int y, int w, int h, void *parent, void *menu, void *inst, void *param)');
    const SetLayeredWindowAttributes = u32.func('int __stdcall SetLayeredWindowAttributes(void *h, uint32 key, uint8 alpha, uint32 flags)');
    const hinst = api.GetModuleHandleW(null);
    const defProc = GetProcAddress(LoadLibraryW('user32.dll'), 'DefWindowProcW');
    RegisterClassExW({ cbSize: koffi.sizeof(WNDCLASSEXW), style: 0, lpfnWndProc: defProc, cbClsExtra: 0, cbWndExtra: 0, hInstance: hinst,
      hIcon: null, hCursor: null, hbrBackground: null, lpszMenuName: null, lpszClassName: 'ZTABLE_DropSink', hIconSm: null });
    // WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE ; WS_POPUP
    sinkHwnd = CreateWindowExW(0x00080000 | 0x80 | 0x8 | 0x08000000, 'ZTABLE_DropSink', 'ZTABLE', 0x80000000, -32000, -32000, 1, 1, null, null, hinst, null);
    if (sinkHwnd) SetLayeredWindowAttributes(sinkHwnd, 0, 1, 0x2 /* LWA_ALPHA */);
  } catch (e) { log('sink ' + e.message); sinkHwnd = null; }
  return sinkHwnd;
}
function showSink(pt) {
  const h = ensureSink(); if (!h) return false;
  // HWND_TOPMOST, SWP_NOACTIVATE | SWP_SHOWWINDOW
  api.SetWindowPos(h, -1n, pt.x - 40, pt.y - 40, 80, 80, 0x0010 | 0x0040);
  return true;
}
function hideSink() { if (sinkHwnd) api.SetWindowPos(sinkHwnd, null, -32000, -32000, 1, 1, 0x0010 | 0x0080 /* HIDEWINDOW */ | 0x0004); }
function mouseMoveRel(dx, dy) {
  const b = Buffer.alloc(40);
  b.writeUInt32LE(0, 0); b.writeInt32LE(dx, 8); b.writeInt32LE(dy, 12);
  b.writeUInt32LE(0x0001, 20); b.writeBigUInt64LE(BigInt(MARKER), 32);
  return b;
}
function foreignTopAt(pt) {
  let h = GetTopWindow(null);
  for (let i = 0; h && i < 2000; i++, h = GetWindowZ(h, 2 /* GW_HWNDNEXT */)) {
    if (!api.IsWindowVisible(h)) continue;
    const rc = {};
    if (!api.GetWindowRect(h, rc)) continue;
    if (pt.x < rc.left || pt.x >= rc.right || pt.y < rc.top || pt.y >= rc.bottom) continue;
    const ex = Number(api.GetWindowLongPtrW(h, -20));
    if (ex & 0x20 /* WS_EX_TRANSPARENT */) continue;
    if (dwmGet) { const c = [0]; try { if (dwmGet(h, 14 /* DWMWA_CLOAKED */, c, 4) === 0 && c[0]) continue; } catch (e) { } }
    const pid = [0]; GetWindowThreadProcessId(h, pid);
    if (MAIN_PID && (pid[0] === MAIN_PID || pid[0] === process.pid)) continue;
    return h;
  }
  return null;
}
function isBlankAt(pt, hwnd, kind) {
  if (kind !== 'list') return true;
  if (accOk) {
    try {
      varBuf.fill(0);
      const out = [null];
      const hr = w.oleacc().AccessibleObjectFromPoint(pt, out, varBuf);
      if (hr === 0) {
        const vt = varBuf.readUInt16LE(0);
        let blank = null;
        if (vt === 3) blank = varBuf.readInt32LE(8) === 0;
        else if (vt === 9) { blank = false; w.comRelease(varBuf.readBigUInt64LE(8)); }
        w.comRelease(out[0]);
        if (blank !== null) return blank;
      }
    } catch (e) { accOk = false; log('acc fail ' + e.message); }
  }
  try {
    const r = [0];
    api.SendMessageTimeoutW(hwnd, 0x103D /* LVM_GETHOTITEM */, 0, 0, 0x2, 200, r);
    return Number(BigInt.asIntN(32, BigInt(r[0]))) === -1;
  } catch (e) { return false; }
}

// ===== 键盘钩子 =====
function curMods() {
  const d = vk => (api.GetAsyncKeyState(vk) & 0x8000) !== 0;
  return { win: d(0x5B) || d(0x5C), ctrl: d(0x11), alt: d(0x12), shift: d(0x10) };
}

function kbProc(nCode, wParam, lParam) {
  try {
    if (nCode === 0) {
      const k = koffi.decode(lParam, w.KBDLLHOOKSTRUCT);
      const injected = (k.flags & 0x10) !== 0;
      const vk = k.vkCode;
      const down = wParam === 0x100 || wParam === 0x104;
      const up = wParam === 0x101 || wParam === 0x105;
      if (!injected && !hk.MODIFIER_VKS.has(vk)) {
        if (up && swallowUp.has(vk)) { swallowUp.delete(vk); return 1; }
        if (down) {
          if (swallowUp.has(vk)) return 1; // 自动重复
          const mods = curMods();
          if (capture) {
            if (vk === 0x1B && !mods.win && !mods.ctrl && !mods.alt && !mods.shift) {
              capture = false; send({ type: 'captured', combo: null });
            } else {
              const combo = hk.format(mods, vk);
              capture = false;
              send({ type: 'captured', combo: combo });
            }
            swallowUp.add(vk);
            if (mods.win) queue.push({ type: 'suppressStart' });
            return 1;
          }
          for (const h of parsedHotkeys) {
            if (h.vk === vk && h.win === mods.win && h.ctrl === mods.ctrl && h.alt === mods.alt && h.shift === mods.shift) {
              swallowUp.add(vk);
              if (mods.win) queue.push({ type: 'suppressStart' });
              send({ type: 'hotkey', id: h.id });
              return 1;
            }
          }
        }
      }
    }
  } catch (e) { log('kb ' + e.message); }
  return api.CallNextHookEx(null, nCode, wParam, lParam);
}

// ===== 鼠标钩子 =====
let rstate = null;      // 右键拖拽状态
let lastBlankClick = null;
const dblTime = api.GetDoubleClickTime();
const dblCx = Math.max(4, api.GetSystemMetrics(36));
const dblCy = Math.max(4, api.GetSystemMetrics(37));
let lastMoveSent = 0;

function mouseProc(nCode, wParam, lParam) {
  try {
    if (nCode === 0) {
      const m = koffi.decode(lParam, w.MSLLHOOKSTRUCT);
      const ours = Number(m.dwExtraInfo) === MARKER;
      const injected = (m.flags & 0x1) !== 0;
      if (!ours) {
        const pt = { x: m.pt.x, y: m.pt.y };
        if (wParam === 0x0200) { // MOVE
          if (rstate && rstate.phase !== 'passthrough') {
            const dx = pt.x - rstate.start.x, dy = pt.y - rstate.start.y;
            rstate.last = pt;
            if (!rstate.dragging && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
              rstate.moved = true;
              if (rstate.blank === true) startDrag();
            }
            if (rstate.dragging) {
              const now = Date.now();
              if (now - lastMoveSent > 12) {
                lastMoveSent = now;
                send({ type: 'rdrag-move', x0: rstate.start.x, y0: rstate.start.y, x: pt.x, y: pt.y });
              }
            }
          }
        } else if (wParam === 0x0202 && oleDrag && Date.now() - oleDrag.at < 120000) { // LBUTTONUP：围栏拖放中松开
          // 松开在桌面上 → 吞掉松开事件、用 Esc 取消系统拖放，再补发松开；ZTABLE 自行把项目放回桌面
          // （否则资源管理器会把文件「移动到它本来所在的桌面文件夹」，弹出「源文件名和目标文件名相同」）
          const top = foreignTopAt(pt);
          const cls = top ? w.className(top) : '';
          log('lup during drag top=' + cls);
          if (DESKTOP_ROOTS.has(cls)) {
            oleDrag = null;
            queue.push({ type: 'deskdrop', pt: pt });
            return 1;
          }
        } else if (wParam === 0x0201 && !injected && cfg.dblClick) { // LBUTTONDOWN
          const hwnd = api.WindowFromPoint(pt);
          const kind = desktopKind(hwnd);
          if (kind) queue.push({ type: 'lcheck', pt: pt, hwnd: hwnd, kind: kind, time: m.time });
          else lastBlankClick = null;
        } else if (wParam === 0x0204 && !injected && cfg.rdrag) { // RBUTTONDOWN
          const hwnd = api.WindowFromPoint(pt);
          const kind = desktopKind(hwnd);
          if (kind) {
            rstate = { phase: 'pending', start: pt, last: pt, hwnd: hwnd, kind: kind, blank: null, dragging: false, moved: false };
            queue.push({ type: 'rcheck', state: rstate });
            return 1;
          }
        } else if (wParam === 0x0205 && !injected && rstate) { // RBUTTONUP
          const st = rstate;
          rstate = null;
          if (st.dragging) {
            send({ type: 'rdrag-end', x0: st.start.x, y0: st.start.y, x: pt.x, y: pt.y });
            return 1;
          }
          if (st.phase === 'passthrough') return api.CallNextHookEx(null, nCode, wParam, lParam);
          queue.push({ type: 'inject', inputs: [0x0008, 0x0010] });
          return 1;
        }
      }
    }
  } catch (e) { log('mouse ' + e.message); }
  return api.CallNextHookEx(null, nCode, wParam, lParam);
}

function startDrag() {
  rstate.dragging = true;
  send({ type: 'rdrag-start', x0: rstate.start.x, y0: rstate.start.y, x: rstate.last.x, y: rstate.last.y });
}

function processQueue() {
  while (queue.length) {
    const j = queue.shift();
    try {
      if (j.type === 'suppressStart') suppressStartMenu();
      else if (j.type === 'inject') sendInputs(j.inputs.map(f => mouseInput(f)));
      else if (j.type === 'deskdrop') {
        // 把吸收窗垫到光标下 → 抖动一下光标让系统拖放重新识别目标 → 再补发松开左键
        const ok = showSink(j.pt);
        sendInputs([mouseMoveRel(1, 0)]);
        setTimeout(() => {
          try { sendInputs([mouseMoveRel(-1, 0)]); } catch (e) { }
          setTimeout(() => {
            try { sendInputs([mouseInput(0x0004)]); } catch (e) { }
            setTimeout(hideSink, 300);
          }, 60);
        }, 60);
        log('deskdrop sink=' + ok);
        send({ type: 'deskdrop', x: j.pt.x, y: j.pt.y });
      }
      else if (j.type === 'rcheck') {
        const st = j.state;
        if (rstate !== st) continue; // 已松开
        const blank = isBlankAt(st.start, st.hwnd, st.kind);
        if (rstate !== st) continue;
        if (!blank) { st.phase = 'passthrough'; sendInputs([mouseInput(0x0008)]); }
        else { st.blank = true; if (st.moved) startDrag(); }
      } else if (j.type === 'lcheck') {
        const blank = isBlankAt(j.pt, j.hwnd, j.kind);
        if (!blank) { lastBlankClick = null; continue; }
        const lb = lastBlankClick;
        if (lb && (j.time - lb.time) <= dblTime && Math.abs(j.pt.x - lb.pt.x) <= dblCx && Math.abs(j.pt.y - lb.pt.y) <= dblCy) {
          lastBlankClick = null;
          send({ type: 'dblclick', x: j.pt.x, y: j.pt.y });
        } else lastBlankClick = { pt: j.pt, time: j.time };
      }
    } catch (e) { log('queue ' + e.message); }
  }
}

// ===== 安装钩子 & 消息泵 =====
const kbCb = koffi.register(kbProc, koffi.pointer(w.HOOKPROC));
const msCb = koffi.register(mouseProc, koffi.pointer(w.HOOKPROC));
const hmod = api.GetModuleHandleW(null);
const hKb = api.SetWindowsHookExW(WH_KEYBOARD_LL, kbCb, hmod, 0);
const hMs = api.SetWindowsHookExW(WH_MOUSE_LL, msCb, hmod, 0);
send({ type: 'ready', keyboard: !!hKb, mouse: !!hMs, acc: accOk });

const msg = Buffer.alloc(48);
let running = true;
function pump() {
  if (!running) return;
  const end = Date.now() + 40;
  while (Date.now() < end) {
    api.MsgWaitForMultipleObjectsEx(0, null, 10, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
    while (api.PeekMessageW(msg, null, 0, 0, 1)) {
      api.TranslateMessage(msg);
      api.DispatchMessageW(msg);
    }
    if (queue.length) processQueue();
  }
  setImmediate(pump);
}
setImmediate(pump);

function shutdown() {
  if (!running) return;
  running = false;
  try { if (hKb) api.UnhookWindowsHookEx(hKb); } catch (e) { }
  try { if (hMs) api.UnhookWindowsHookEx(hMs); } catch (e) { }
  process.exit(0);
}
