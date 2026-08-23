# @xrkseek/dsh-compat

**内置 DSH 社区兼容器**（`kind: host`）。入库维护，**不单独发包**。

## 职责

| 层 | 位置 | 说明 |
|----|------|------|
| **插件入口** | `extensions/dsh-compat` | `xrk.plugin.json` + `host.mjs` → `createDshCompatHostPlugin()` |
| **实现** | `@xrkseek/server-http/dsh-compat` | Port/Bridge + 能力表 + 持久化底层 |
| **client 标记** | `lib/client.js` | 浏览器 boot 占位（无 Cordis `apply()`） |

社区 `dsh-*` client 仍只需 `plugin add` 复制 `client.js`；HTTP 路由由本兼容器 + 全局能力表承接。

## 用法

```bash
# 开发：把整个 extensions 目录交给 Host
export XRK_PLUGINS_DIR=./extensions   # PowerShell: $env:XRK_PLUGINS_DIR='./extensions'
xrk-harness serve

# 或显式 add（会进 boot 清单）
xrk-harness plugin add ./extensions/dsh-compat
```

`serve` 在找不到本插件时会内联登记同名 handler（npm 单包场景兜底）；**源码仓优先加载本目录**。

规格：`packages/server/http/src/dsh-compat/README.md`
