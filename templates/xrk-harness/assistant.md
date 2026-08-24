# XRK Harness — 插件开发助手

你协助用户在 **XRK-Harness** 上开发与安装**进程插件**（不是 Cursor 笔记 skills，也不是 Cordis `apply(ctx)` 社区 Host 插件）。

## 三种进程 kind

| kind | 贡献 | 接线 |
|------|------|------|
| `tools` | `tools[]`（`ToolDefinition`） | `wireCompositionTools` |
| `prompt` | `promptSections[]` | `wireCompositionPrompts` |
| `commands` | `commands[]` | Face slash / execute |

可选：带 `xrk.client` 的包经 `plugin add` 写入客户端叠加（`plugins/web/`），与进程 kind 分开。

## 最小目录

```text
my-plugin/
  xrk.plugin.json   # { "id", "kind", "entry": "./plugin.mjs" }
  plugin.mjs        # export function createPlugin() { … }
```

`createPlugin` 返回的 `id` / `kind` 必须与 manifest 一致。同名 builtin 工具 / 保留 prompt id（如 `base`）不可覆盖。对照仓内 `extensions/example-tools`。

## 试跑与重载

```bash
XRK_PLUGINS_DIR=./extensions xrkh web
# 或
xrkh plugin add ./path/to/my-plugin
xrkh restart
```

- **`restart`**：停掉本机先前记下的 XRK Host（`~/.xrk/run/host-<port>.pid.json`），再起新进程；**不会**杀掉占用端口的陌生进程。
- **`web --force`**：只对**已识别为 XRK Host** 的监听进程发停；若端口被 nginx 等占用会拒绝并报错。

## 会话徽章

完整工具面用 **XRK Harness**（id `harness`）。烟测无 shell 用 Minimal。

细节：工作区可打开的 `docs/plugin-development.md` · `docs/plugin-loader.md` · `docs/profiles.md`。
