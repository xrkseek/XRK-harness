# @xrkseek/core-system-prompt

| API | 作用 |
|-----|------|
| `assembleThreeLayers` | 骨架 system（+ workspaceBlocks）· 历史 · skeleton user · volatile user |
| `createSystemPromptAssembler` | 分段 system 字符串（preset persona） |
| `createOutboundPipeline` / `createDefaultOutbound` | 出站链：slash → assemble → toolPair → compaction → window → invariant |

**注意：** 出站默认 `slashRecipeStep` 仍为 noop；传入 `createDefaultOutbound({ resolveSlash })` 或用 `createSlashRecipeStep`。热路径 slash 在 agent-loop `assemble.resolveSlash`。真 compaction 在 agent-loop；recipe 解析在 `@xrkseek/workspace`。

易变层不得进入 system（保 prompt cache）— 有单测锁定。
