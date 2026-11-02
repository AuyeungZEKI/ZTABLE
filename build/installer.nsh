; ============================================================
;  ZTABLE 安装界面定制（electron-builder NSIS / MUI2）
; ============================================================

!include "WinVer.nsh"
!include "x64.nsh"

; ---------- 系统版本检查：Windows 10 1903 (18362) 及以上 ----------
!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP|MB_OK "ZTABLE 需要 Windows 10（1903 及以上）或 Windows 11。$\r$\n$\r$\n当前系统版本过低，安装已取消。"
    Quit
  ${EndIf}
  ${IfNot} ${AtLeastBuild} 18362
    MessageBox MB_ICONSTOP|MB_OK "ZTABLE 需要 Windows 10 1903（内部版本 18362）或更高版本。$\r$\n$\r$\n请先通过 Windows 更新升级系统后再安装。"
    Quit
  ${EndIf}
!macroend

; ---------- 全局视觉 ----------
SetFont /LANG=2052 "Microsoft YaHei UI" 9
SetFont "Microsoft YaHei UI" 9
!define MUI_BGCOLOR "FFFFFF"
!define MUI_TEXTCOLOR "1F2430"
!define MUI_HEADER_TRANSPARENT_TEXT
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "确定要退出 ZTABLE 安装程序吗？"
!define MUI_UNABORTWARNING

; ---------- 欢迎页 ----------
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装 ZTABLE 桌面整理"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "ZTABLE 帮你把满屏图标收进半透明围栏，让 Windows 11 桌面井井有条。$\r$\n$\r$\n  ·  桌面围栏 / 分区：右键拖出选择框即可创建$\r$\n  ·  自动归类：新快捷方式、新下载自动入栏$\r$\n  ·  文件夹门户：把任意文件夹镜像到桌面$\r$\n  ·  双击桌面空白快速隐藏、双击标题卷起$\r$\n  ·  Win + 空格 速览：被窗口挡住也能一键看到$\r$\n$\r$\n点击「下一步」继续。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

; ---------- 用户隐私协议（必须勾选同意才能继续） ----------
!define MUI_PAGE_HEADER_TEXT "用户隐私协议"
!define MUI_PAGE_HEADER_SUBTEXT "安装 ZTABLE 前，请阅读并同意以下协议。"
!define MUI_LICENSEPAGE_TEXT_TOP "请滚动阅读完整的《ZTABLE 用户隐私协议》。"
!define MUI_LICENSEPAGE_TEXT_BOTTOM "ZTABLE 完全在本机运行，不联网、不收集任何个人数据。勾选同意后方可继续安装。"
!define MUI_LICENSEPAGE_CHECKBOX
!define MUI_LICENSEPAGE_CHECKBOX_TEXT "我已阅读并同意《ZTABLE 用户隐私协议》"

; ---------- 安装位置页 ----------
!define MUI_DIRECTORYPAGE_TEXT_TOP "ZTABLE 将安装到下列文件夹。你可以点击「浏览」选择其他位置（例如 D:\Program Files\ZTABLE）。$\r$\n$\r$\n提示：安装到 C:\Program Files 等系统目录时，可能需要管理员权限。"
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "安装位置"

; ---------- 完成页 ----------
!define MUI_FINISHPAGE_TITLE "ZTABLE 已准备就绪"
!define MUI_FINISHPAGE_TITLE_3LINES
!define MUI_FINISHPAGE_TEXT "ZTABLE 已安装到你的电脑，运行后常驻在任务栏托盘区。$\r$\n$\r$\n小提示：在桌面空白处按住右键拖拽，即可框出你的第一个围栏。"
!define MUI_FINISHPAGE_RUN_TEXT "立即运行 ZTABLE"
!define MUI_FINISHPAGE_LINK "查看用户隐私协议"
!define MUI_FINISHPAGE_LINK_LOCATION "$INSTDIR\resources\privacy.txt"

; ---------- 卸载 ----------
!define MUI_UNCONFIRMPAGE_TEXT_TOP "将从你的电脑中移除 ZTABLE。收纳在围栏中的桌面项目会全部移回桌面，你的文件不会受到任何影响。"

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; 还原所有被隐藏的桌面图标与「显示桌面图标」状态
    DetailPrint "正在把收纳的项目放回桌面…"
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --restore' $0
    ; 移除开机自启
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ZTABLE"
  ${endIf}
!macroend
