<p align="center">
  <img src="assets/mark128.png" width="96" height="96" alt="ZTABLE logo" />
</p>

<h1 align="center">ZTABLE</h1>

<p align="center">
  <strong>Windows 桌面整理工具 · A desktop organizer for Windows, inspired by Fences</strong><br/>
  把乱糟糟的桌面，收进整洁的「围栏」。<br/>
  <em>Tidy your desktop into clean, foldable "fences".</em>
</p>

<p align="center">
  Windows 10 (1903+) · Windows 11 &nbsp;|&nbsp; x64 · ARM64 &nbsp;|&nbsp; 纯本地运行，不联网 · No network, fully local
</p>

---

## ✨ 功能 Features

| # | 功能 Feature | 说明 Description |
|---|---|---|
| 1 | 桌面围栏 Fences | 在桌面拖出半透明选择框，按「软件 / 文档 / 图片 / 下载 / 项目」等分组收纳图标，避免满屏乱堆。Drag a translucent marquee on the desktop to group icons by category. |
| 2 | 自动归类 Auto-sort rules | 按文件类型、名称关键词、修改时间等规则，新快捷方式 / 新下载自动进入对应围栏。New shortcuts and downloads land in the right fence automatically. |
| 3 | 文件夹门户 Folder Portals | 把「下载 / 文档 / D 盘项目 / OneDrive」等任意文件夹镜像成一个桌面围栏，直接查看、打开文件。Mirror any folder (Downloads, Documents, OneDrive…) as a fence. |
| 4 | 快速隐藏 Quick hide | 双击桌面空白隐藏全部图标；可只隐藏部分围栏或排除某些图标。Double-click empty desktop to hide everything; exclude what you want to keep. |
| 5 | 卷起标题栏 Roll-up | 双击围栏标题收成一条标题条，再点展开。Double-click the title to roll the fence up into a title bar. |
| 6 | 外观自定义 Appearance | 大小、位置、颜色、透明度、圆角、标题样式、图标排序、深浅色；多显示器 / 4K / 高 DPI 独立配置。Full styling, per-display config. |
| 7 | 速览 Peek | 桌面被遮挡时按快捷键（默认 Win+Space）把围栏置顶。Hotkey (default Win+Space) raises all fences above other windows. |

> **收纳方式 Stow modes**：默认「原位收纳」——文件**保持在桌面原路径、不移动**，仅把桌面图标收起；也可切换为「移入收纳文件夹」。

---

## 📦 安装 Install

从 `dist/` 下载对应架构的安装包，双击运行：

- `ZTABLE_Setup_1.0.1_x64.exe` — 64 位 Windows（绝大多数电脑）
- `ZTABLE_Setup_1.0.1_arm64.exe` — ARM64 Windows

安装向导支持自定义安装路径，安装前需勾选同意用户隐私协议。

> 校验值见 `dist/SHA256.txt`。

## 🔨 从源码构建 Build from source

要求：Node.js ≥ 20、npm。国内网络建议使用镜像源。

```bash
npm install                       # 安装依赖
npm start                         # 本地运行
npm run dist                      # 打包 x64 安装包
npm run dist:arm64                # 打包 ARM64 安装包
```

> 构建依赖 Electron 与 electron-builder。若下载缓慢，可设置：
> `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
> `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`

## 🧭 系统要求 Requirements

- Windows 10 **1903 (build 18362)** 及以上，或 Windows 11
- 无需管理员权限（公共桌面快捷方式除外）
- 需要 .NET / 运行时：无（自带 Electron 运行时）

---

## 🏗 架构 Architecture

| 模块 | 职责 |
|---|---|
| `src/main.js` | 主进程：窗口管理、配置、围栏编排、生命周期 |
| `src/hook.js` | 独立钩子进程（`ELECTRON_RUN_AS_NODE`）：全局键鼠钩子、速览、双击隐藏、右键拖拽建围栏、拖放拦截、崩溃看门狗 |
| `src/win32.js` | Win32 原生绑定（`koffi` FFI 直调） |
| `src/desktopsvc.js` | 桌面/下载目录服务：隐藏属性、规则归类、目录监视 |
| `src/icons.js` | 高清系统图标与缩略图（含 EXIF 方向、长图裁切） |
| `renderer/` | 围栏窗口与设置页 UI |
| `build/` | 安装程序资源（NSIS 脚本、图标、协议） |

技术栈：**Electron + koffi（FFI 直调 Win32）+ electron-builder（NSIS）**。

## 🔒 隐私与数据安全 Privacy

- **纯本地运行**，不含任何网络请求，不上传任何数据。
- 配置保存在 `%APPDATA%\ZTABLE\config.json`。
- 收纳的桌面项目在任何时刻（拖出 / 删除围栏 / 退出 / 卸载 / 崩溃）都会自动还原到桌面——由独立看门狗进程兜底。

详见安装包内附的《用户隐私协议》（`assets/privacy.md`）。

---

## 📄 许可 License

[MIT](./LICENSE)

## 📝 变更记录 Changelog

见 [CHANGELOG.md](./CHANGELOG.md)。
