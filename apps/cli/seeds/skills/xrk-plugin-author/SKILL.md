---
name: xrk-plugin-author
description: >-
  Scaffold an XRK process plugin (xrk.plugin.json + createPlugin) for
  tools/prompt/commands. Use when the user says 「写插件」「脚手架」
  「plugin.mjs」「extensions 插件」— after kind is decided (see xrk-plugin-kind).
---

# 进程插件

进程插件 = 本机目录里的 `xrk.plugin.json` + 入口模块，经 Host **restart** 后进工具面。  
不确定形态时先读 **`xrk-plugin-kind`**（默认往往是 MCP，不是本 skill）。

```
- [ ] 1. 确认 kind：`tools` | `prompt` | `commands`
- [ ] 2. 落盘目录：用户指定路径；常见 `extensions/<plugin-id>/`
- [ ] 3. 写 `xrk.plugin.json`（id / kind / 入口）与 `createPlugin` 实现，id 一致
- [ ] 4. 装载：`xrkh plugin add <dir>` 或 `XRK_PLUGINS_DIR=<父目录> xrkh web`
- [ ] 5. **`xrkh restart`**（或等价重启 Host）→ **`xrk-plugin-verify`**
```

## 最小形状

- `xrk.plugin.json`：声明 `id`、`kind`、入口文件  
- 入口：`createPlugin` 导出；`tools` kind 注册可调用工具  
- 细节以当前产品文档 **插件开发** 为准；不确定就打开文档对照，不要臆造字段

斜杠一键脚手架若环境提供 `/plugin-scaffold` → 可用，再人工核对 id/kind。

## 边界

| 做 | 不做 |
|----|------|
| 密钥走 Credentials | 把 API key 写进插件源码 |
| 改完 restart 再生效 | 假设热重载 |
| 工具描述写清参数与失败语义 | 空 description / 万能 catch |

装完验证 → **`xrk-plugin-verify`**。
