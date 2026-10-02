/**
 * Face `/auto-review` slash + projection live stats → dsh-compat HTTP store.
 */
import {
  readAutoReviewStats,
  syncAutoReviewSlashCommand,
} from "@xrkseek/server-http";

export function createAutoReviewBridgeFromHost(xrkHome: string): {
  readonly autoReviewSlashPersist: (args: string) => void;
  readonly readAutoReviewLiveStats: () => ReturnType<typeof readAutoReviewStats>;
} {
  return {
    autoReviewSlashPersist: (args) =>
      syncAutoReviewSlashCommand({ xrkHome }, args),
    readAutoReviewLiveStats: () => readAutoReviewStats({ xrkHome }),
  };
}
