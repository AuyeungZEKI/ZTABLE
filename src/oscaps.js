'use strict';
// 系统能力探测：Windows 10 (1903+) / Windows 11，x64 / ARM64
const os = require('os');

const parts = os.release().split('.').map(n => parseInt(n, 10) || 0); // 10.0.<build>
const build = parts[2] || 0;
const MIN_BUILD = 18362;           // Windows 10 1903

const caps = {
  build,
  arch: process.arch,                       // x64 / arm64
  isWin11: build >= 22000,
  supported: parts[0] >= 10 && build >= MIN_BUILD,
  acrylic: build >= 22621,                  // Win11 22H2：DWM 系统背景材质（亚克力/Mica）
  roundedCorners: build >= 22000,           // Win11：DWMWA_WINDOW_CORNER_PREFERENCE
  snapLayouts: build >= 22000,
  newDesktopTree: build >= 26100,           // Win11 24H2：SHELLDLL_DefView 固定在 Progman 下
  osName: build >= 22000 ? 'Windows 11' : 'Windows 10',
  minBuild: MIN_BUILD
};
caps.label = caps.osName + ' (build ' + build + ', ' + caps.arch + ')';

module.exports = caps;
