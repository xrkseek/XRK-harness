/**
 * Synthetic user text injected when a step ends at the output-token cap and
 * Face opts into mid-turn resume (`autoContinueOnMaxTokens`).
 *
 * Plain「继续」left models (esp. delegated children) retrying the same giant
 * `write_file` / `apply_patch` until `autoContinueMaxRounds`, because
 * max-tokens keep/drop discards incomplete tool calls with no durable write
 * (RC.2 `sess_mwlyldoa_qnzuxq`: 10× continue while writing a 108-key profile).
 */
export const AUTO_CONTINUE_ON_MAX_TOKENS_TEXT =
  "继续。上一轮输出触顶（max-tokens）：若当时在拼 write_file / apply_patch 等工具参数，" +
  "该调用已被丢弃且未执行。请拆成更小的写入（分文件 / 分段 patch），不要一次塞超大内容；" +
  "已落盘的结果直接接着做，不要整段重写。";

/** @deprecated Prefer {@link AUTO_CONTINUE_ON_MAX_TOKENS_TEXT}. */
export const AUTO_CONTINUE_USER_TEXT = AUTO_CONTINUE_ON_MAX_TOKENS_TEXT;

/**
 * Mid-turn resume copy. When keep/drop recorded tool names, name them so the
 * model knows which call never ran.
 */
export function formatAutoContinueOnMaxTokensText(
  droppedToolNames?: readonly string[],
): string {
  const names = [
    ...new Set(
      (droppedToolNames ?? [])
        .map((n) => String(n ?? "").trim())
        .filter((n) => n.length > 0),
    ),
  ];
  if (names.length === 0) return AUTO_CONTINUE_ON_MAX_TOKENS_TEXT;
  return (
    `${AUTO_CONTINUE_ON_MAX_TOKENS_TEXT}` +
    ` 本轮被丢弃的工具调用：${names.join(", ")}。`
  );
}
