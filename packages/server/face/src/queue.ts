import type { AdmitReceipt } from "@xrkseek/core-session";

/**
 * Authoritative `session/queue` item — shape matches DSH
 * `QueuedInboxItem` (host/apiproxy events.ts): id · placement · message.
 */

export type QueuePlacement = "queued" | "steering" | "context";

export interface FaceQueueMessage {
  readonly id: string;
  readonly role: "user";
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly source: {
    readonly kind: "user";
    readonly rpcId?: string;
  };
}

export interface FaceQueueItem {
  readonly id: string;
  readonly placement: QueuePlacement;
  readonly message: FaceQueueMessage;
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
      message: {
        id: a.admitId,
        role: "user",
        content: [{ type: "text", text: a.content }],
        source: {
          kind: "user",
          ...(rpcId !== undefined ? { rpcId } : {}),
        },
      },
    };
  });
}
