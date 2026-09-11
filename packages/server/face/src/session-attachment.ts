/**
 * session.attachment — authorize read of attachment bytes by session event refs.
 */

import type { AttachmentStore } from "@xrkseek/attachment";
import { isAttachmentError } from "@xrkseek/attachment";
import type { SessionEvent } from "@xrkseek/protocol";
import { listFileRefs, listImageRefs } from "@xrkseek/protocol";

export function referencedAttachmentIds(
  events: readonly SessionEvent[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const ev of events) {
    if (ev.type === "user/message" || ev.type === "prompt/admitted") {
      for (const ref of listImageRefs(ev.content)) {
        ids.add(ref.attachmentId);
      }
      for (const ref of listFileRefs(ev.content)) {
        ids.add(ref.attachmentId);
      }
    }
  }
  return ids;
}

export async function readSessionAttachment(input: {
  readonly events: readonly SessionEvent[];
  readonly attachments: AttachmentStore;
  readonly attachmentId: string;
}): Promise<
  | {
      readonly ok: true;
      readonly value: {
        readonly attachment:
          | {
              readonly kind: "image";
              readonly attachmentId: string;
              readonly mediaType: string;
              readonly bytes: number;
              readonly width: number;
              readonly height: number;
              readonly name?: string;
            }
          | {
              readonly kind: "file";
              readonly attachmentId: string;
              readonly name: string;
              readonly bytes: number;
              readonly mediaType?: string;
            };
        readonly data: string;
      };
    }
  | { readonly ok: false; readonly code: string; readonly message: string }
> {
  const id = input.attachmentId.trim();
  if (!id) {
    return {
      ok: false,
      code: "invalid-payload",
      message: "attachmentId required",
    };
  }
  if (!referencedAttachmentIds(input.events).has(id)) {
    return {
      ok: false,
      code: "not-found",
      message: "attachment not referenced by this session",
    };
  }
  try {
    try {
      const stored = await input.attachments.readImage(id);
      return {
        ok: true,
        value: {
          attachment: { kind: "image", ...stored.ref },
          data: Buffer.from(stored.data).toString("base64"),
        },
      };
    } catch (imgErr) {
      if (!(isAttachmentError(imgErr) && imgErr.code === "NOT_FOUND")) {
        throw imgErr;
      }
    }
    const stored = await input.attachments.readFile(id);
    return {
      ok: true,
      value: {
        attachment: { kind: "file", ...stored.ref },
        data: Buffer.from(stored.data).toString("base64"),
      },
    };
  } catch (err) {
    if (isAttachmentError(err) && err.code === "NOT_FOUND") {
      return {
        ok: false,
        code: "not-found",
        message: "attachment bytes missing",
      };
    }
    throw err;
  }
}
