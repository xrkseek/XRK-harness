---
name: xrk-plugin
description: >-
  Choosing, authoring, and verifying an XRK extension: MCP first, then a
  process plugin (tools / prompt / commands), or a client UI overlay. Covers
  xrk.plugin.json scaffolding, the restart-then-verify loop, and what to redo
  after a git pull. Use when the user says 「写插件」「用哪种插件」「要不要 MCP」
  「改 UI 还是加工具」「plugin.mjs」「装好了吗」「工具看不到」「plugins vs MCP」.
---

# 扩展插件

> 一句话：**能挂 MCP 就别写插件；非得写，就按 kinds 写最小形状，restart 后再验。**
> 插件没有可靠热重载——这条决定了本技能后半段的全部步骤。

## 一、先选形态

给模型一个新**外部能力**，默认走 **设置 → 插件 → MCP**（见 `xrk-capability-attach`）。进程插件只在「必须落在本机目录、不值得起 MCP 进程」时才用。

| 用户要什么 | 选 | 去哪 |
|---|---|---|
| 接已有 / 可起的 MCP 服务器 | **MCP Settings** | `xrk-capability-attach` |
| 本机简单自有函数给模型调 | `kind: tools` | 本文 §二 |
| 追加 system 段 | `kind: prompt` | 本文 §二 |
| 斜杠命令 | `kind: commands` 或用户 recipes | 本文 §二 / 自建 recipe |
| **改壳 UI** | client 叠加（**不是** tools） | 社区插件 / client 文档 |

三条判据，命中即定：

- 已经是 MCP 包 → 直接挂，**不要**再包一层 tools 插件。
- 单函数、要进当前仓库目录、不想起 MCP 进程 → tools 插件。
- 只想改界面 → client 叠加，写成 tools 是形态错误。

## 二、写进程插件

进程插件 = 本机目录里的 `xrk.plugin.json` + 入口模块，经 Host **restart** 后进工具面。

```
- [ ] 1. 确认 kind：tools | prompt | commands
- [ ] 2. 定目录：用户指定路径，常见 `extensions/<plugin-id>/`
- [ ] 3. 写 `xrk.plugin.json`（id / kind / 入口）与 `createPlugin` 导出，**id 必须一致**
- [ ] 4. 装载：`xrkh plugin add <dir>`，或 `XRK_PLUGINS_DIR=<父目录> xrkh web`
- [ ] 5. 重启 Host → §三 验证
```

最小形状：manifest 只声明 `id`、`kind`、入口；入口导出 `createPlugin`，`tools` kind 在其中注册可调用工具。字段以产品文档**插件开发**为准——**不确定就查文档，不要臆造字段**。

环境若提供 `/plugin-scaffold`，可一键出骨架，出来后人工核对 id 与 kind。

## 三、验证（不可跳过）

```
- [ ] 1. manifest 的 id/kind 与 createPlugin() 一致
- [ ] 2. `xrkh plugin add <目录>`（若尚未登记）
- [ ] 3. `xrkh restart`（或带 XRK_PLUGINS_DIR 的 web/serve 重启）
- [ ] 4. `xrkh plugin list` + 新会话里确认工具名出现
- [ ] 5. 仍没有 → 查徽章 / policy deny / 是否装错目录
```

**`git pull` 之后做什么**

| 变了什么 | 做什么 |
|---|---|
| 仅插件 JS / manifest | restart |
| lock / package.json 依赖 | 先按项目惯例装依赖，再 restart |
| 只改了无关文件 | 不必 reinstall |

## 铁律

| 做 | 不做 |
|---|---|
| 密钥走 Credentials | 把 API key 写进插件源码 |
| 改完 restart 再生效 | 假设有热重载 |
| 工具 description 写清参数与失败语义 | 空 description / 万能 try-catch |
| MCP 问题查 Settings 行 | 拿 restart 硬砸 MCP 问题 |

## 反模式

- 一律脚手架进程插件，从没考虑过 MCP。
- 用 tools 插件去改 UI。
- 没 restart 就断言「插件坏了」。
- 反复 `--force` 杀进程当排障。
