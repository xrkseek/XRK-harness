# @xrkseek/core-system-prompt

| API                                                | 作用                                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `assembleThreeLayers`                              | 骨架 system（+ workspaceBlocks）· 历史 · 当前 user 消息（volatile 折叠在其尾缀）；**tools 按 name 字典序**      |
| `createSystemPromptAssembler`                      | 分段 system 字符串（preset persona）；可选 `variable` / 段上 `interpolate: false`                               |
| `renderPromptSections` · `interpolatePromptText`   | 严格 `{{name}}` 插值；`tools:sdk` 等工具文档段应 `interpolate: false`，避免说明里的双花括号破坏提示词 / PTC SDK |
| `createOutboundPipeline` / `createDefaultOutbound` | 出站链：slash → assemble → toolPair · compaction · window · invariant                                           |

骨架人设是单一 `persona` 字符串（agent-loop `assemble.persona` 可为其函数形）；**没有** `personaPrefix` / `personaSuffix` 配置轴。分段靠 assembler 的 `id`/`order`，不是部署级前后缀拆分。

**注意：** 出站默认 `slashRecipeStep` 仍为 noop；传入 `createDefaultOutbound({ resolveSlash })` 或用 `createSlashRecipeStep`。热路径 slash 在 agent-loop `assemble.resolveSlash`。真 compaction 在 agent-loop；recipe 解析在 `@xrkseek/workspace`。

易变层不得进入 system（保 prompt cache）— 有单测锁定。时钟与 session id 只作为**当前 user 消息的尾缀**出现，**绝不单独成一条 user 消息**；一次 step 若没有人类内容（同 turn 的后续 step，agent-loop 传零宽占位符），就**不追加任何消息**——这样 `[current message]` 与每秒时钟既不挪动对话前缀，模型也不会把纯标记当作用户发言去回话（防线：`hasHumanUserText` / `isMetadataOnlyUserMessage`）。
