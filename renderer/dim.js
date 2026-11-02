'use strict';
const q = new URLSearchParams(location.search);
const op = parseFloat(q.get('opacity') || '0.35');
const hk = q.get('hotkey') || '';
document.body.style.background = `rgba(8,10,14,${op})`;
if (hk) {
  const t = document.getElementById('t');
  t.innerHTML = `速览模式 · 再次按下 <kbd>${hk}</kbd> 或 <kbd>Esc</kbd> 退出`;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.zt.invoke('app:exitPeek'); });
document.addEventListener('mousedown', () => window.zt.invoke('app:exitPeek'));
