'use strict';
const sel = document.getElementById('sel'), tag = document.getElementById('tag'), tip = document.getElementById('tip');
let start = null;
window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  start = { cx: e.clientX, cy: e.clientY };
  tip.style.display = 'none';
  sel.style.display = 'block';
});
window.addEventListener('mousemove', (e) => {
  if (!start) return;
  const L = Math.min(e.clientX, start.cx), T = Math.min(e.clientY, start.cy);
  const W = Math.abs(e.clientX - start.cx), H = Math.abs(e.clientY - start.cy);
  sel.style.left = L + 'px'; sel.style.top = T + 'px'; sel.style.width = W + 'px'; sel.style.height = H + 'px';
  tag.style.display = 'block';
  tag.textContent = Math.round(W) + ' × ' + Math.round(H);
  tag.style.left = L + 'px'; tag.style.top = Math.max(0, T - 26) + 'px';
});
window.addEventListener('mouseup', (e) => {
  if (!start) return;
  const L = Math.min(e.clientX, start.cx), T = Math.min(e.clientY, start.cy);
  const W = Math.abs(e.clientX - start.cx), H = Math.abs(e.clientY - start.cy);
  start = null;
  window.zt.invoke('overlay:done', { x: Math.round(L), y: Math.round(T), width: Math.round(W), height: Math.round(H) });
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.zt.invoke('overlay:cancel'); });
window.addEventListener('contextmenu', (e) => e.preventDefault());
