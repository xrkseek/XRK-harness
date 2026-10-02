---
name: codegraph-retrieval
description: >-
  用 CodeGraph 知识图谱检索代替 grep+read 摸索：explore/node/callers/impact 一把取回符号
  源码 + 调用链 + 影响面。用户说「先装 codegraph」「用 codegraph 查」「大项目检索」，
  或任务涉及陌生模块的定位/调用链/改动影响面时使用。
---

# CodeGraph 检索

> 本仓已建索引：`.codegraph/`（2,954 文件 / 37,121 节点 / 175,152 边 / ~196 MB SQLite）。
> MCP `codegraph`（工具 `codegraph_explore`）已挂进 Host Settings；CLI `codegraph` 在 PATH。

## 什么时候用

**默认用于**：定位符号在哪、这个功能怎么跑、改这里会影响谁、blast radius。
本仓 2,954 个源文件，`grep` + 逐个 `read_file` 的摸索成本远高于一次图查询。

**不要用于**：配置 / Markdown / YAML / 测试快照等未索引内容（`docs/`、`*.json`、`*.md`），
以及「刚改完的文件」——索引比写入慢约 1 秒，改完先 `codegraph sync`。

## 首选：MCP 工具

```
codegraph_explore { query: "<问题或符号名>" }
```

一次调用返回：相关符号的**逐行原文源码**（按文件分组，可直接当 Read 用）+ 它们之间的调用链
（含 grep 跟不动的动态派发：回调、React re-render、JSX children）+ 影响面摘要。

- 问「X 怎么工作」／「X 到 Y 的流程」→ 直接把两端符号名写进 query。
- 读一个能点名的文件/符号 → 把路径或符号名写进 query，别另外 Read。
- 输出头部有 `⚠️ ... edited since the last index sync` → 只有被点名的那几个文件要 Read 复核。

MCP 未挂上（本 turn 工具表里没有 `mcp__codegraph__*`，或报 not indexed）→ 走 CLI，输出同形。

## CLI（永远可用）

```powershell
codegraph status                      # 索引统计 / 是否最新
codegraph sync                        # 补索引（改完文件先 sync 再查）
codegraph explore "<符号名或问题>" --max-files 3
codegraph node <Symbol>               # 一个符号的源码 + 调用/被调
codegraph query <text>                # 模糊搜符号
codegraph callers <Symbol>            # 谁调用了它
codegraph callees <Symbol>            # 它调用了谁
codegraph impact <Symbol>             # 改动影响面
codegraph affected <file...>          # 改了这些文件会影响哪些测试
codegraph files                       # 索引到的项目结构
```

## 本机 / 本仓的坑

- **工作区路径含中文**（`Desktop\主仓库\XRK-harness`）：MCP 已在 args 里用 `--path` 钉死，
  搬仓要改 `settings_mutate ns=mcp` 那条 `codegraph` server。
- **MCP 走共享 daemon**（`\\.\pipe\codegraph-*`，`.codegraph/daemon.pid`），
  所以多个 turn / 子进程共用一个索引；索引卡死才需要 `codegraph unlock`。
- **PowerShell 一行语法错 → 整段解析期失败**：长脚本写 `.tmp/*.ps1` 再
  `powershell -File` 执行（无 BOM UTF-8，脚本内不放中文字面量）。
- 版本：CLI/server 1.6.0，1.6.1 可用（`codegraph upgrade`，**升级前问用户**）。

## 反模式

- ❌ 先 `grep` 一圈再 `read_file` 逐个读 —— 图里已有答案。
- ❌ 把「找代码」委派给只读子代理让它自己 grep —— 自己查，一两次 explore 就够。
- ❌ 拿 codegraph 结果再 grep 复核 —— 它来自完整 AST 解析，复核更慢更不准。
- ❌ 对未索引文件（配置 / 文档）硬套 explore。

## 委派时

子代理拿不到 MCP 的 initialize 说明，prompt 里必须点名：
「用 `codegraph explore "<...>"` 查（CLI），不要 grep+read 摸索」。