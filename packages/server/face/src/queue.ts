import type { AdmitReceipt } from "@xrkseek/core-session";
import { asContentBlocks } from "@xrkseek/protocol";

/**
 * Authoritative `session/queue` item: id · placement · message.
 */

export type QueuePlacement = "queued" | "steering" | "context";

export interface FaceQueueMessage {
  readonly id: string;
  readonly role: "user";
  readonly content: readonly (
    | { readonly type: "text"; readonly text: string }
    | {
        readonly type: "image";
        readonly attachment: {
          readonly attachmentId: string;
          readonly mediaType: string;
          readonly bytes: number;
          readonly width: number;
          readonly height: number;
          readonly name?: string;
        };
      }
  )[];
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
        content: asContentBlocks(a.content).map((block) =>
          block.type === "text"
            ? { type: "text" as const, text: block.text }
            : { type: "image" as const, attachment: { ...block.attachment } },
        ),
        source: {
          kind: "user",
          ...(rpcId !== undefined ? { rpcId } : {}),
        },
      },
    };
  });
}
