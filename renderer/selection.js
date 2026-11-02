'use strict';
const s = document.getElementById('s');
window.zt.on('sel:size', (d) => {
  s.textContent = `${d.w} × ${d.h}` + (d.ok ? '  · 松手创建围栏' : '');
  s.style.background = d.ok ? '#2563EB' : '#1F2430';
});
