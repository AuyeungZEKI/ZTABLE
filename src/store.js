'use strict';
// 配置存储：%APPDATA%\ZTABLE\config.json（防抖写入 + 原子替换 + 备份）
const fs = require('fs');
const path = require('path');

const DEFAULT_STYLE = {
  accent: '#3B82F6',      // 主题色（标题条/强调）
  bg: 'auto',             // 背景色：auto 跟随深浅色
  opacity: 0.62,          // 背景不透明度 0.05~1
  radius: 12,             // 圆角
  blur: false,            // 毛玻璃
  titleStyle: 'bar',      // bar 色条 / minimal 简约 / line 细线 / hidden 悬停显示
  titleAlign: 'left',     // left / center / right
  titleSize: 13,
  titleBold: true,
  iconSize: 48,
  labelLines: 2,
  sort: 'manual',         // manual / name / type / mtime / size
  textColor: 'auto',
  contentOpacity: 1
};

function defaults() {
  return {
    version: 1,
    general: {
      firstRun: true,
      autoStart: true,
      theme: 'system',          // system / light / dark
      hideOriginals: false,     // 旧版「隐藏」模式（1.0.1 起改为移动到收纳文件夹）
      stowMode: 'inPlace',      // inPlace = 文件留在桌面原路径、仅隐藏桌面图标；move = 移动到收纳文件夹
      returnOnQuit: true,       // 退出 ZTABLE 时把收纳的项目放回桌面，下次启动自动收回
      storeRoot: '',            // 收纳文件夹（move 模式使用，空 = 桌面同级的「ZTABLE 收纳」）
      rightDragCreate: true,    // 桌面右键拖拽创建围栏
      snap: true,               // 吸附网格
      watchDownloads: true      // 监视下载文件夹
    },
    quickHide: {
      dblClick: true,
      hideIcons: true,
      hideFences: true,
      excludes: []
    },
    peek: { dim: true, dimOpacity: 0.35 },
    hotkeys: { peek: 'Win+Space', quickHide: '', newFence: '' },
    displays: {},
    fences: [],
    rules: [],
    hidden: []
  };
}

function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out = Object.assign({}, base);
    if (over && typeof over === 'object') {
      for (const k of Object.keys(over)) {
        out[k] = (k in base) ? deepMerge(base[k], over[k]) : over[k];
      }
    }
    return out;
  }
  return over === undefined ? base : over;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'config.json');
    this.data = defaults();
    this.timer = null;
    this.listeners = [];
  }
  load() {
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch (e) { }
    let raw = null;
    for (const f of [this.file, this.file + '.bak']) {
      try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); break; } catch (e) { raw = null; }
    }
    this.data = deepMerge(defaults(), raw || {});
    for (const fence of this.data.fences) normalizeFence(fence);
    return this.data;
  }
  save(immediate) {
    clearTimeout(this.timer);
    const write = () => {
      try {
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
        if (fs.existsSync(this.file)) { try { fs.copyFileSync(this.file, this.file + '.bak'); } catch (e) { } }
        fs.renameSync(tmp, this.file);
      } catch (e) { console.error('save failed', e); }
    };
    if (immediate) write(); else this.timer = setTimeout(write, 400);
  }
}

function normalizeFence(f) {
  f.style = Object.assign({}, DEFAULT_STYLE, f.style || {});
  if (!Array.isArray(f.items)) f.items = [];
  if (!f.type) f.type = 'normal';
  if (!f.bounds) f.bounds = { x: 80, y: 80, width: 340, height: 250 };
  if (f.rolledUp == null) f.rolledUp = false;
  if (f.locked == null) f.locked = false;
  if (f.keepOnQuickHide == null) f.keepOnQuickHide = false;
  return f;
}

module.exports = { Store, defaults, DEFAULT_STYLE, normalizeFence };
