import type { AdmitReceipt } from "@xrkseek/core-session";

export type QueuePlacement = "queued" | "steering";

export interface FaceQueueItem {
  readonly id: string;
  readonly placement: QueuePlacement;
  readonly content: string;
  readonly rpcId?: string;
}

export function toQueueItems(
  pending: readonly AdmitReceipt[],
  admitToRpc: ReadonlyMap<string, string>,
): FaceQueueItem[] {
  return pending.map((a) => {
    const rpcId = admitToRpc.get(a.admitId);
    return {
      id: a.admitId,
      placement: a.delivery === "steer" ? "steering" : "queued",
      content: a.content,
      ...(rpcId !== undefined ? { rpcId } : {}),
    };
  });
}
