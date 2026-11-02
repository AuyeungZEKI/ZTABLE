'use strict';
// ZTABLE - Win32 原生绑定（koffi）。主进程与钩子进程共用。
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const shell32 = koffi.load('shell32.dll');

const POINT = koffi.struct('ZT_POINT', { x: 'int32', y: 'int32' });
const RECT = koffi.struct('ZT_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const MSLLHOOKSTRUCT = koffi.struct('ZT_MSLLHOOKSTRUCT', {
  pt: POINT, mouseData: 'uint32', flags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t'
});
const KBDLLHOOKSTRUCT = koffi.struct('ZT_KBDLLHOOKSTRUCT', {
  vkCode: 'uint32', scanCode: 'uint32', flags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t'
});
const WINDOWPOS = koffi.struct('ZT_WINDOWPOS', {
  hwnd: 'void *', hwndInsertAfter: 'void *', x: 'int32', y: 'int32', cx: 'int32', cy: 'int32', flags: 'uint32'
});
const SHELLEXECUTEINFOW = koffi.struct('ZT_SHELLEXECUTEINFOW', {
  cbSize: 'uint32', fMask: 'uint32', hwnd: 'void *', lpVerb: 'str16', lpFile: 'str16',
  lpParameters: 'str16', lpDirectory: 'str16', nShow: 'int32', hInstApp: 'void *', lpIDList: 'void *',
  lpClass: 'str16', hkeyClass: 'void *', dwHotKey: 'uint32', hIconOrMonitor: 'void *', hProcess: 'void *'
});

const HOOKPROC = koffi.proto('intptr_t __stdcall ZT_HOOKPROC(int nCode, uintptr_t wParam, void *lParam)');
const RELEASEPROC = koffi.proto('uint32 __stdcall ZT_RELEASE(void *self)');

const api = {
  // user32
  SetWindowsHookExW: user32.func('void * __stdcall SetWindowsHookExW(int idHook, ZT_HOOKPROC *lpfn, void *hmod, uint32 tid)'),
  CallNextHookEx: user32.func('intptr_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, void *lParam)'),
  UnhookWindowsHookEx: user32.func('int __stdcall UnhookWindowsHookEx(void *hhk)'),
  MsgWaitForMultipleObjectsEx: user32.func('uint32 __stdcall MsgWaitForMultipleObjectsEx(uint32 n, void *handles, uint32 ms, uint32 mask, uint32 flags)'),
  PeekMessageW: user32.func('int __stdcall PeekMessageW(void *msg, void *hwnd, uint32 min, uint32 max, uint32 remove)'),
  TranslateMessage: user32.func('int __stdcall TranslateMessage(void *msg)'),
  DispatchMessageW: user32.func('intptr_t __stdcall DispatchMessageW(void *msg)'),
  WindowFromPoint: user32.func('void * __stdcall WindowFromPoint(ZT_POINT pt)'),
  GetClassNameW: user32.func('int __stdcall GetClassNameW(void *hwnd, void *buf, int max)'),
  GetParent: user32.func('void * __stdcall GetParent(void *hwnd)'),
  GetAncestor: user32.func('void * __stdcall GetAncestor(void *hwnd, uint32 flags)'),
  FindWindowW: user32.func('void * __stdcall FindWindowW(str16 cls, str16 name)'),
  FindWindowExW: user32.func('void * __stdcall FindWindowExW(void *parent, void *after, str16 cls, str16 name)'),
  SendMessageW: user32.func('intptr_t __stdcall SendMessageW(void *hwnd, uint32 msg, uintptr_t w, intptr_t l)'),
  SendMessageTimeoutW: user32.func('intptr_t __stdcall SendMessageTimeoutW(void *hwnd, uint32 msg, uintptr_t w, intptr_t l, uint32 flags, uint32 timeout, _Out_ uintptr_t *result)'),
  PostMessageW: user32.func('int __stdcall PostMessageW(void *hwnd, uint32 msg, uintptr_t w, intptr_t l)'),
  IsWindowVisible: user32.func('int __stdcall IsWindowVisible(void *hwnd)'),
  IsWindow: user32.func('int __stdcall IsWindow(void *hwnd)'),
  SetWindowLongPtrW: user32.func('void * __stdcall SetWindowLongPtrW(void *hwnd, int idx, void *value)'),
  GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(void *hwnd, int idx)'),
  SetWindowPos: user32.func('int __stdcall SetWindowPos(void *hwnd, void *after, int x, int y, int cx, int cy, uint32 flags)'),
  GetWindowRect: user32.func('int __stdcall GetWindowRect(void *hwnd, _Out_ ZT_RECT *rc)'),
  GetDoubleClickTime: user32.func('uint32 __stdcall GetDoubleClickTime()'),
  GetSystemMetrics: user32.func('int __stdcall GetSystemMetrics(int idx)'),
  SendInput: user32.func('uint32 __stdcall SendInput(uint32 n, void *inputs, int cb)'),
  GetCursorPos: user32.func('int __stdcall GetCursorPos(_Out_ ZT_POINT *pt)'),
  GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
  SetProcessDpiAwarenessContext: user32.func('int __stdcall SetProcessDpiAwarenessContext(intptr_t ctx)'),
  GetAsyncKeyState: user32.func('int16 __stdcall GetAsyncKeyState(int vk)'),
  // kernel32
  GetModuleHandleW: kernel32.func('void * __stdcall GetModuleHandleW(str16 name)'),
  GetCurrentThreadId: kernel32.func('uint32 __stdcall GetCurrentThreadId()'),
  GetFileAttributesW: kernel32.func('uint32 __stdcall GetFileAttributesW(str16 path)'),
  SetFileAttributesW: kernel32.func('int __stdcall SetFileAttributesW(str16 path, uint32 attrs)'),
  // shell32
  SHChangeNotify: shell32.func('void __stdcall SHChangeNotify(int32 evt, uint32 flags, str16 item1, void *item2)'),
  ShellExecuteExW: shell32.func('bool __stdcall ShellExecuteExW(_Inout_ ZT_SHELLEXECUTEINFOW *info)')
};

let dwmApi = null;
function setCornerPreference(hwnd, pref) { // 0 默认 1 不圆角 2 圆角 3 小圆角
  try {
    if (!dwmApi) dwmApi = koffi.load('dwmapi.dll').func('int32 __stdcall DwmSetWindowAttribute(void *hwnd, uint32 attr, _In_ int32 *value, uint32 size)');
    return dwmApi(hwnd, 33, [pref], 4) === 0;
  } catch (e) { return false; }
}

let oleaccApi = null;
function oleacc() {
  if (oleaccApi) return oleaccApi;
  const lib = koffi.load('oleacc.dll');
  const ole32 = koffi.load('ole32.dll');
  oleaccApi = {
    AccessibleObjectFromPoint: lib.func('int32 __stdcall AccessibleObjectFromPoint(ZT_POINT pt, _Out_ void **ppacc, void *pvarChild)'),
    CoInitializeEx: ole32.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 flags)')
  };
  return oleaccApi;
}

function comRelease(ptr) {
  try {
    if (!ptr) return;
    const vtbl = koffi.decode(ptr, 'void *');
    const rel = koffi.decode(vtbl, 2 * 8, 'void *');
    koffi.call(rel, RELEASEPROC, ptr);
  } catch (e) { /* ignore */ }
}

const classBuf = Buffer.alloc(512);
function className(hwnd) {
  if (!hwnd) return '';
  classBuf.fill(0);
  const n = api.GetClassNameW(hwnd, classBuf, 256);
  return n > 0 ? classBuf.toString('utf16le', 0, n * 2) : '';
}

function hwndFromBuffer(buf) {
  if (!buf) return null;
  return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
}

// ===== 桌面窗口定位 =====
function findProgman() {
  return api.FindWindowW('Progman', null);
}

function findDefView() {
  const progman = findProgman();
  if (progman) {
    const dv = api.FindWindowExW(progman, null, 'SHELLDLL_DefView', null);
    if (dv) return dv;
  }
  let w = null;
  for (let i = 0; i < 64; i++) {
    w = api.FindWindowExW(null, w, 'WorkerW', null);
    if (!w) break;
    const dv = api.FindWindowExW(w, null, 'SHELLDLL_DefView', null);
    if (dv) return dv;
  }
  return null;
}

function findDesktopListView() {
  const dv = findDefView();
  if (!dv) return null;
  return api.FindWindowExW(dv, null, 'SysListView32', null);
}

function desktopIconsVisible() {
  const lv = findDesktopListView();
  if (!lv) return true;
  return !!api.IsWindowVisible(lv);
}

// 切换「显示桌面图标」（等同右键桌面 > 查看 > 显示桌面图标）
function setDesktopIconsVisible(visible) {
  const cur = desktopIconsVisible();
  if (cur === !!visible) return true;
  const dv = findDefView();
  if (!dv) return false;
  api.SendMessageTimeoutW(dv, 0x0111, 0x7402, 0, 0x0002, 1500, [0]);
  return true;
}

const FILE_ATTRIBUTE_HIDDEN = 0x2;
const INVALID_ATTR = 0xFFFFFFFF;
function isHiddenAttr(p) {
  const a = api.GetFileAttributesW(p);
  if (a === INVALID_ATTR) return null;
  return (a & FILE_ATTRIBUTE_HIDDEN) !== 0;
}
function setHiddenAttr(p, hidden) {
  const a = api.GetFileAttributesW(p);
  if (a === INVALID_ATTR) return false;
  const na = hidden ? (a | FILE_ATTRIBUTE_HIDDEN) : (a & ~FILE_ATTRIBUTE_HIDDEN);
  if (na === a) return true;
  const ok = api.SetFileAttributesW(p, na >>> 0) !== 0;
  if (ok) {
    try { api.SHChangeNotify(0x00000800 /* SHCNE_ATTRIBUTES */, 0x0005 /* SHCNF_PATHW */, p, null); } catch (e) { }
    try { api.SHChangeNotify(0x00002000 /* SHCNE_UPDATEITEM */, 0x0005, p, null); } catch (e) { }
  }
  return ok;
}
function notifyDirUpdated(dir) {
  try { api.SHChangeNotify(0x00001000 /* SHCNE_UPDATEDIR */, 0x0005, dir, null); } catch (e) { }
}

function shellExec(verb, p, dir) {
  const info = {
    cbSize: koffi.sizeof(SHELLEXECUTEINFOW), fMask: 0x0000000C, hwnd: null, lpVerb: verb,
    lpFile: p, lpParameters: null, lpDirectory: dir || null, nShow: 1, hInstApp: null, lpIDList: null,
    lpClass: null, hkeyClass: null, dwHotKey: 0, hIconOrMonitor: null, hProcess: null
  };
  return api.ShellExecuteExW(info) !== 0;
}
function showProperties(p) { return shellExec('properties', p); }

// 判断屏幕物理坐标处是否为桌面（图标层/壁纸层）
function isDesktopAt(pt) {
  const h = api.WindowFromPoint(pt);
  if (!h) return false;
  const cls = className(h);
  if (!['SysListView32', 'SHELLDLL_DefView', 'WorkerW', 'Progman'].includes(cls)) return false;
  const root = api.GetAncestor(h, 2);
  const rc = className(root);
  return rc === 'Progman' || rc === 'WorkerW';
}

// 把窗口的所有者设为 Progman：Win+D「显示桌面」时仍保留在桌面上
function attachToDesktop(hwnd) {
  const progman = findProgman();
  if (!progman || !hwnd) return false;
  api.SetWindowLongPtrW(hwnd, -8 /* GWLP_HWNDPARENT */, progman);
  return true;
}
function detachFromDesktop(hwnd) {
  if (!hwnd) return;
  api.SetWindowLongPtrW(hwnd, -8, null);
}

const HWND_BOTTOM = 1n;
const SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_NOOWNERZORDER = 0x200;
function sendToBottom(hwnd) {
  if (!hwnd) return;
  api.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
}

// WM_WINDOWPOSCHANGING 中强制保持底层
function forceBottomInWindowPos(lParamBuf) {
  try {
    const ptr = hwndFromBuffer(lParamBuf);
    if (!ptr) return;
    const wp = koffi.decode(ptr, WINDOWPOS);
    if (wp.flags & SWP_NOZORDER) return;
    koffi.encode(ptr, 8, 'void *', HWND_BOTTOM);
  } catch (e) { /* ignore */ }
}

module.exports = {
  koffi, api, oleacc, comRelease, POINT, RECT, MSLLHOOKSTRUCT, KBDLLHOOKSTRUCT, HOOKPROC,
  className, hwndFromBuffer, findProgman, findDefView, findDesktopListView, desktopIconsVisible,
  setDesktopIconsVisible, isHiddenAttr, setHiddenAttr, notifyDirUpdated, showProperties, shellExec, isDesktopAt,
  attachToDesktop, detachFromDesktop, setCornerPreference, sendToBottom, forceBottomInWindowPos
};
