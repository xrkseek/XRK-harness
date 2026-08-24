# @xrkseek/dsh-compat

> **读者 / Audience**：维护者 · 集成试用 / Maintainers · Local integrators

内置社区插件 **Host 兼容器**（`kind: host`）。本目录为进程入口；实现位于 `@xrkseek/server-http/dsh-compat`（自研底层，可整夹迁出，见 `PACKAGE.md`）。

Built-in community **Host adapter** (`kind: host`). This directory is the process entry; implementation lives at `@xrkseek/server-http/dsh-compat` (first-party underlying layer; extractable per `PACKAGE.md`).

| 层 / Layer | 位置 / Location |
|----|------|
| 插件入口 / Plugin entry | 本目录 `xrk.plugin.json` + `host.mjs` |
| 实现 / Implementation | `@xrkseek/server-http/dsh-compat` |
| Client 标记 / Client stub | `lib/client.js`（boot placeholder） |

```bash
export XRK_PLUGINS_DIR=./extensions   # PowerShell: $env:XRK_PLUGINS_DIR='./extensions'
xrkh serve
# or: xrkh plugin add ./extensions/dsh-compat
```

规格 / Spec：`packages/server/http/src/dsh-compat/README.md`。
