# 基线清单落地复核表（主控侧独立核查，2026-10-22）

> 方法：对基线 `方案.md` §3 全部条目 + 内核真缺口，逐条在本仓 `git grep` 查证。
> **结论：基线是过期的。P0 6 条已落地（含通知 U1/`os-notify.ts`）、P1 多数已落地。真正还缺的是 chord/leader、Ctrl+R、tmTheme、看板、elicitation、agents overview、resume 配置、流式补丁等长尾。**
> **注意**：下方「仍缺 P0#1 系统通知」行已过期（2026-10-22 后 U1 落地）；勿再当 todo。`.tmp/compare/方案.md` 已删，以 `2026-10-22-status.md` 为准。

## 已落地（基线误报为"待做"，实际已有等价实现）

| 基线编号 | 事项 | 本仓证据（路径:行号） |
| --- | --- | --- |
| P0#2 | 多代理 alt+←/→ 快切 | `packages/client/ui-layout/src/client/AppFrame.tsx:50/253-256` `nextSubagentCycleTarget`；`locales.ts:28-29/70-71` |
| P0#3 | 常量时间比较 | `packages/server/host/src/index.ts:3118` `timingSafeStringEqual(key, expected)`；另有 `packages/server/face/src/wire/loopback.ts:5/29`、`packages/server/http/src/dsh-compat/mobile-access-auth.ts:181/281`、`packages/a2a/src/inbound.ts:94` |
| P0#4 | env 脱敏覆盖非 PTY 路径 | `packages/exec/subprocess/src/index.ts:13/29-34` 导入 `childEnv`/`scrubbedParentEnv`，`:175-176` `env: childEnv(opts.env)`；原 env 模块在 `packages/exec/subprocess/src/env.ts`（与 `exec/pty/src/env.ts` 同源） |
| P0#6 | 补丁三级降级匹配 | `packages/exec/fs/src/edit-text.ts:4/11` `EditMatchTier = "exact" \| "rstrip" \| "trim"`；`:44/156/160/241/254` 分档 + `EditAmbiguousError` |
| P1#9 | 策略 DSL（受限表达式） | `packages/policy/src/when-expr.ts:2/289/400` 专用受限布尔表达式求值器；`packages/policy/src/ruleset.ts:50/109` `match.when` |
| P1#11 | 命令面板 frecency | `packages/client/ui-commands/src/client/command-frecency.ts:2/6-7/10/16-18` |
| P1#13 | 快捷键面板多列自适应 | `packages/client/ui-primitives/src/ShortcutsPanel.module.css:44-49` `column-count: 1` + `max-height: min(50vh,360px)`；`:51-56` `@media (min-width:800px)` → `column-count: 2` + `min(60vh,480px)`；`:58-62` `@media (min-width:1280px)` → `column-count: 3`；`:64-66` `.group { break-inside: avoid }` |
| P1#14 | 扫描预算硬上限 | `packages/workspace/src/scan-guards.ts:52-54/65-71/87/94` `ScanBudget{maxRoots,maxDirs,maxEntries,maxFileBytes}` |
| P1#15 | symlink no-follow 打开 | `packages/exec/fs/src/open-nofollow.ts:2/17/72` `O_NOFOLLOW` + fstat/lstat inode 复核；`packages/exec/fs/src/index.ts:28/65` 导出 |
| P1#16 | W3C trace context | `packages/llm/llm/src/trace-context.ts:14/26/51/58-59` `traceparent` + `tracestate` |
| P1#16a | hooks 4 事件点 | `packages/server/loader/src/shell-hooks.ts:23-24/37-40/59-62` `SessionEnd`/`Interrupt`/`PreModelRequest`/`PostModelRequest`（自陈对齐 codex 14 类事件面） |
| P1#16b | 技能动态选择器 | `packages/workspace/src/skill-select.ts:58/105` `selectSkillsForBudget(skills, maxChars, query)`；`packages/workspace/src/durable-inject.ts:14/109`；`packages/workspace/tests/skill-select.test.ts:46-48` |
| P1#16c | guardian 判据成文 | `packages/server/http/src/dsh-compat/auto-review-classifier.ts:40-54` 风险词汇表（unknown/high/critical + 授权未知）、"按实际效果而非自述评估"、fail-closed |

## 仍缺（基线成立，至今未落地）

| 基线编号 | 事项 | 零命中搜索词（本仓 `packages` + `apps`） |
| --- | --- | --- |
| ~~P0#1~~ | ~~系统通知~~ → **已落地** `packages/client/.../os-notify.ts` + `new Notification(`（见 status U1） | — |

| P2#18 | 输入历史 Ctrl+R 反向增量搜索 | `reverseSearch` / `searchHistory` / `historySearch` |
| P2#19 | 自定义高亮主题发现 | `tmTheme` |
| P2#17 | 用量 / 花费仪表盘呈现面 | `usageDashboard` / `analyticsDashboard` / `costDashboard` |
| P2#20 | transcript 键盘选区 / 屏幕阅读器探测 | `SelectionUnit` / `preferredColumn` / `screenReader` |
| P2#21 | 流式增量补丁解析 | `streamingParser` / `streaming_parser` |
| P2#23a | Mermaid 渲染 | `mermaid`（唯一命中 `packages/server/http/src/sidebar/bundle-chunk-stub.ts:27` 是 DSH 兼容懒加载占位 chunk 名，非真实现） |
| P2#23b | MCP elicitation | `elicitation` / `ElicitRequest` |
| P2#23g | daemon 级 agents overview（冻结只读快照） | `agentsOverview` / `frozenSnapshot` |
| P2#23h | resume 恢复当时配置（模型/权限/工作目录） | `resumeConfig` / `restoreSessionConfig` |

## 需再核（基线未给行号，本轮未逐条验证）

P0#5 错误响应头透传 · P1#8 Esc 回溯状态机 · P1#10 权限档案 extends + 代理身份（`ed25519` 仅命中 SSH 测试配置 `packages/server/face/tests/ssh-remote-peek.test.ts:28/38`，非子代理身份签名 → 判定**仍缺**）· P1#12 主题预览事务 · P2#22 进程加固 · P2#23c 外部 agent 配置级迁移 · P2#23d 会话 recap · P2#23e 目录信任授予 · P2#23f 逻辑文本分离 + 失效快捷键抑制 · P2#23i MCP DCR + redirect 白名单 · P2#23j 实时语音有界帧 · 内核#9 可编程执行策略 DSL（Starlark 路线）· 内核#29 RPC 级 trace 跨 RPC 透传

## 结论

- **基线的 P0/P1 段基本已被后续开发消化**（16 条里 12 条已落地）。基线不可直接当待办清单用。
- 本轮真正要找的增量，来自 **codex +164 提交** 与 **DSH 3698 文件 / +149k 行** 带来的新机制。
