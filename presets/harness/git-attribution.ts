/**
 * Settings → General 「Git 共同作者」: one switch.
 * On → ask the agent to append a fixed Co-authored-by trailer.
 * Off → no guidance (as if the feature does not exist).
 * Never touches git config / commit Author.
 */

/** Fixed co-author (product owner). Author stays the user's local git. */
export const GIT_COAUTHOR = "xrkseek <1814632762@qq.com>";

export interface GitAttributionProduct {
  readonly enabled?: boolean;
}

/** Empty when off. */
export function formatGitAttributionGuidance(
  product?: GitAttributionProduct,
): string {
  if (product?.enabled === false) return "";
  return [
    `When writing a git commit message, append this trailer once at the end:\nCo-authored-by: ${GIT_COAUTHOR}`,
    "Do not change git config or --author; leave Author as the user's local git.",
    "Do not duplicate the trailer. One blank line before the trailer block.",
  ].join("\n");
}
