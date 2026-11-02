'use strict';
// 快捷键字符串 <-> 虚拟键码
const NAMED = {
  Space: 0x20, Enter: 0x0D, Tab: 0x09, Esc: 0x1B, Backspace: 0x08, Delete: 0x2E, Insert: 0x2D,
  Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22, Left: 0x25, Up: 0x26, Right: 0x27, Down: 0x28,
  '`': 0xC0, '-': 0xBD, '=': 0xBB, '[': 0xDB, ']': 0xDD, '\\': 0xDC, ';': 0xBA, "'": 0xDE,
  ',': 0xBC, '.': 0xBE, '/': 0xBF, Pause: 0x13, PrintScreen: 0x2C
};
const VK2NAME = {};
Object.keys(NAMED).forEach(k => { VK2NAME[NAMED[k]] = k; });
for (let i = 0; i < 26; i++) VK2NAME[0x41 + i] = String.fromCharCode(65 + i);
for (let i = 0; i < 10; i++) { VK2NAME[0x30 + i] = String(i); VK2NAME[0x60 + i] = 'Num' + i; }
for (let i = 1; i <= 24; i++) VK2NAME[0x6F + i] = 'F' + i;

const MODIFIER_VKS = new Set([0x10, 0x11, 0x12, 0x5B, 0x5C, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5]);

function nameToVk(name) {
  if (!name) return 0;
  if (NAMED[name] != null) return NAMED[name];
  if (/^[A-Z]$/i.test(name)) return name.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(name)) return 0x30 + Number(name);
  let m = /^F(\d{1,2})$/i.exec(name);
  if (m) { const n = Number(m[1]); if (n >= 1 && n <= 24) return 0x6F + n; }
  m = /^Num(\d)$/i.exec(name);
  if (m) return 0x60 + Number(m[1]);
  return 0;
}

function parse(combo) {
  if (!combo || typeof combo !== 'string') return null;
  const parts = combo.split('+').map(s => s.trim()).filter(Boolean);
  const r = { win: false, ctrl: false, alt: false, shift: false, vk: 0 };
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'win' || l === 'super' || l === 'meta') r.win = true;
    else if (l === 'ctrl' || l === 'control') r.ctrl = true;
    else if (l === 'alt') r.alt = true;
    else if (l === 'shift') r.shift = true;
    else r.vk = nameToVk(p.length === 1 ? p.toUpperCase() : (p[0].toUpperCase() + p.slice(1)));
  }
  if (!r.vk) return null;
  if (!r.win && !r.ctrl && !r.alt && !(r.vk >= 0x70 && r.vk <= 0x87)) return null; // 必须带修饰键（F 键除外）
  return r;
}

function format(mods, vk) {
  const out = [];
  if (mods.win) out.push('Win');
  if (mods.ctrl) out.push('Ctrl');
  if (mods.alt) out.push('Alt');
  if (mods.shift) out.push('Shift');
  const n = VK2NAME[vk];
  if (!n) return null;
  out.push(n);
  return out.join('+');
}

module.exports = { parse, format, nameToVk, VK2NAME, MODIFIER_VKS };
