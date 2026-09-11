# @xrkseek/client-ui-open-in-app

[English](README.md) | 中文

会话顶栏 **「在应用中打开」** 分裂按钮：把当前会话 workspace 目录交由 Face 探测到的编辑器 / 终端 / 文件管理器打开。可用性来自 Face `host.listOpenInApps`；启动走 `host.openInApp`。Face 回空列表、会话无 cwd、非 loopback，或 `host.describe.canOpenPath` 为假时不渲染。

SSH / 远程启动的 Host 回空列表（与对照基线 open-in-app Host 包同一决策）。目录为固定白名单且只列已验证启动器——不做全盘扫描。
