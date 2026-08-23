/**
 * Face `/auto-review` slash → dsh-compat HTTP persistence bridge.
 */
import { syncAutoReviewSlashCommand } from "@xrkseek/server-http";

export function createAutoReviewBridgeFromHost(xrkHome: string): {
  readonly autoReviewSlashPersist: (args: string) => void;
} {
  return {
    autoReviewSlashPersist: (args) =>
      syncAutoReviewSlashCommand({ xrkHome }, args),
  };
}
