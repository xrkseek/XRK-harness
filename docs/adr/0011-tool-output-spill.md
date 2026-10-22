# ADR-0011: 子代理答案封顶 —— 落盘不截杀，读取靠命令

> **读者**：维护者 · 贡献者

- **Status:** Accepted
- **Date:** 2026-10-22
- **Tags:** subagent, spill, delegation, context-budget, face
- **Related:** [`docs/tool-output-bound.md`](../tool-output-bound.md) · [`.agents/context/subagents.md`](../../.agents/context/subagents.md) · [ADR-0003](./0003-session-long-loop-short.md) · `@xrkseek/spill` · `packages/server/face/src/adapt/subagent-answer-bound.ts`

## 背景

子代理是**独立会话**，不是免费线程。父会话派活出去，最终拿回来的只有子代理的**最后一轮正文**。这条通道在实现上曾被当成普通工具结果处理，于是撞上两件事：

1. **通道只有一寸宽。** 工具结果有 64 KiB 内联上限；后台子代理的完成通知走另一条路，旧实现硬截 **2000 字**。一份几千字的对比报告塞进去，出来的是半截句子。
2. **模型读不到路径，就会去折磨子代理。** 截断之后正文里只剩一句「全文已存至 `<路径>`」的 notice。实测里模型**经常无视 notice 里的路径**，它的默认反应不是 `read_file`，而是 `send_message` 回去叫子代理「把结论压缩到 800 字以内再说一遍」。

第二条是真问题。压缩重述意味着：

- 子代理把已经付过费的取证**扔掉细节重讲一遍** —— 双份 token，双份时间；
- 模型看不到被扔掉的是**什么**，于是拿着必然残缺的版本做判断；
- 最坏的情况，重述时把「这条我们本来就有」讲成「这条我们缺」。

一个真实事故：2026-10-22 派 3 个调研员分头取证 `codex` 与 `deepseek-harness` 的差距。3 份结果全部超通道长度被截，3 个都带着半截结论回来了。同一轮里那 3 个子代理还各自卡在免费路由 `model-retry attempt 18/20 of 30` + 60 s 退避 —— 父会话既拿不到结论，也读不到任何一份完整取证。

## 决策

**截断可以，丢内容不行。** 长答案整段落盘到 `~/.xrk/spill/tool-outputs/`，内联留 head/tail 预览 + 绝对路径；父会话要全文就自己去读文件。**不替模型省 token，也不替它决定它可以看多少。**

### 1. 前后台走同一条 bound

前台 `subagent` 的返回、后台 steer 进来的完成通知、`close_agent` 抢回的最后一轮正文、`wait_agent` 的超时 salvaged 预览 —— 四条路径**全部**过同一个 `boundChildAnswer`，内联上限统一 **UTF-8 12 000 字节**（≈ 中文 4 千字）：

```ts
// packages/server/face/src/adapt/subagent-answer-bound.ts
export const SUBAGENT_ANSWER_INLINE_BYTES = 12_000;

export function boundChildAnswer(parentSessionId, childSessionId, text) {
  if (!text || parseSpillLocator(text)) return text;      // 幂等
  const bound = boundToolResultContent({
    sessionId: parentSessionId,
    callId: `subagent-${childSessionId}`,
    toolName: "subagent",
    content: text,
    maxInlineBytes: SUBAGENT_ANSWER_INLINE_BYTES,
  });
  const body = typeof bound.content === "string" ? bound.content : text;
  return bound.spilled ? `${SPILL_READ_HINT}\n\n${body}` : body;
}
```

落盘文件名 `<parentSessionId>_subagent-<childSessionId>.txt`。

上限 12 000 而非 64 000 是为了**一次落盘**：子答案若按 64 KiB 内联，它会连同父会话那一步的工具结果 bound 再过一遍、被同一个机制落盘第二次。同一个字节上限也意味着 CJK 不会被更早腰斩 —— 字节口径对中英一视同仁。

### 2. 读取提示是命令，不是建议

notice 措辞由「完整输出已保存至 `<path>`」改成祈使句，直接顶掉「让子代理再说一遍」的第一反应：

```ts
const SPILL_READ_HINT =
  "The child's full answer is on disk. Read it with read_file (or grep) " +
  "before you answer — do not re-ask the child to restate it in fewer words.";
```

`tool description` 与返回正文**两处都写**。只有 notice 一层是不够的 —— 模型扫正文时把 notice 当噪声跳掉，就是这次事故的起点。

### 3. 幂等与终态

- 正文里已带 spill locator（`parseSpillLocator` 命中）时**原样返回**：子代理自己读文件再转述路径，不产生第二份落盘。
- 用户 Stop 子代理 → outcome 文案为 **`aborted by user`**（`subagent-notice.ts:84` `cause.kind === "user"`），**不是**失败。子会话与 transcript 保留，`send_message` 可续。抢回残局用 `close_agent`（停 + 回传截断后的最后答案）；只要正文曾超 12 KB 且已 spill，那份文件**还在磁盘上**。
- 异常 idle（`aborted` / `error`）走父会话 steer 通知（文案 `ended abnormally`），回传**截断预览**，不是完整正文；前台 one-shot 等待超时同理（10 分钟 salvaged 预览）。
- 短答案**原样透出，不落盘**。

## 后果

- 父会话对 spill 文件**只读**。`spill/tool-outputs` 属 Host 可读根（`hostReadableRoots` 默认 `{XRK_HOME}`，含 spill / attachments / memories）。
- 磁盘有界：单文件 8 MiB，`~/.xrk/spill` 总量 256 MiB，超 7 天的文件下次落盘时清 —— 常量在 `packages/util/home-paths/src/spill-budget.ts:9/12/15`（`SPILL_MAX_FILE_BYTES` · `SPILL_MAX_TOTAL_BYTES` · `SPILL_MAX_AGE_MS`），先按年龄删，仍超总量则从最旧继续删，不跟随符号链接。
- **空目录是常态。** 子代理正常跑完、答案 ≤12 KB 时**不会**生成 spill 文件；`spill/tool-outputs` 为空或不存在都不表示配置坏了。别为「答案短」去翻盘。
- 后台通知的旧 **2000 字硬截**取消，与前后台同一 bound，后台不再天然少一块。
- 模型若仍无视 `read_file` 提示、坚持叫子代理压缩重述，属于**提示层失效**，不是本契约的授权 —— 该修措辞或改成强制注入，而不是回头提高内联上限。

## 不是 spill 的情况（别去翻 tool-outputs）

| 现象 | 去哪找 | 说明 |
|------|--------|------|
| 子代理正常跑完，答案不长 | 父会话里该次 `subagent` / `wait_agent` 工具结果正文，或后台 steer 完成通知全文 | **≤12 KB 不写盘**，目录空/不存在是常态 |
| 子代理停在半句，但 `turn/end.reason.kind === "completed"` | 该子会话事件日志 / `sessions.db` | 模型层截断，不因「答不完整」自动落盘 |
| 用户 Stop 父会话级联停子 | 无 completion notice（已 suppress） | 手动停父不回传 |
| 只有 `~/.xrk/spill/` 没有 `tool-outputs/` | — | 尚未发生过超限写盘 |

---

# ADR-0011: Child-Answer Bound — spill, don't kill; read, don't re-ask

> **Audience**: Maintainers · Contributors

- **Status:** Accepted · **Date:** 2026-10-22

## Context

A subagent is a separate session, not a free thread. The parent receives **only its final turn**. Two ceilings used to sit on that channel: tool results at 64 KiB inline, background completion notices **hard-clipped at 2 000 chars**. A few-thousand-character audit report came back as a half sentence.

The real damage was the second-order behavior. A truncation marker saying "full content saved to `<path>`" is routinely skipped — the model treats it as noise. Its reflex is not `read_file`, it is `send_message` back to the child: "compress to 800 words and restate." That re-pays for work already done, and the parent then reasons over a summary whose losses it cannot see.

One concrete incident (2026-10-22): three researchers dispatched to audit gaps against `codex` and `deepseek-harness`; all three results exceeded the channel, all three came back truncated, and all three were simultaneously stuck in free-route `model-retry 18/20 of 30` with 60 s backoff.

## Decision

**Truncate, never lose.** Long answers spill whole to `~/.xrk/spill/tool-outputs/`; inline keeps a head/tail preview plus the absolute path. The parent reads the file if it wants the full text. **We do not save the model tokens for it, and we do not decide how much it is allowed to see.**

1. **One bound for foreground and background.** Foreground returns, steered completion notices, `close_agent` salvage, and `wait_agent` timeout previews all pass through `boundChildAnswer` at **UTF-8 12 000 bytes** (≈ 4 k CJK chars), one spill per over-limit result. 12 KB rather than 64 KB exists so a child answer is not spilled twice by the tool-result bound downstream; a byte ceiling also means CJK is not cut earlier than Latin.
2. **The hint is a command.** `SPILL_READ_HINT` tells the parent to `read_file` before answering and explicitly forbids asking the child to restate shorter. It is written into both the `tool description` and the return body — notice text alone loses to a model scanning past it.
3. **Idempotent and terminal.** A body already carrying a spill locator is returned untouched. User Stop reads as `aborted by user`, not failure: child session and transcript are kept, `send_message` resumes, `close_agent` salvages the last answer, and a spilled body remains on disk regardless. Short answers pass through with no file.

## Consequences

- The spill tree is **read-only** for the parent and sits under `hostReadableRoots` (default `{XRK_HOME}`).
- Disk is bounded: 8 MiB per file, 256 MiB total, 7-day age prune (`packages/util/home-paths/src/spill-budget.ts`); age first, then oldest; symlinks not followed.
- **An empty directory is normal.** A child that finishes under 12 KB writes nothing; a missing `tool-outputs` is not a misconfiguration.
- The background notice's old 2 000-char clip is gone; background and foreground share one ceiling.
- If a model still ignores `read_file` and orders the child to compress, that is a **prompt-layer failure** — fix the wording or force the injection, do not raise the inline ceiling.
