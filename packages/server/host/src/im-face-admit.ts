/**
 * Admit IM bridge inbound rows into Face `ws_im` (create + prompt).
 * Outbound to IM is tool-only (`im_send`) — admit does not wait for or
 * auto-forward assistant text. Without Face the messaging bridge still
 * persists messages only.
 */
import { randomUUID } from "node:crypto";
import type { AttachmentStore } from "@xrkseek/attachment";
import type { ContentBlock } from "@xrkseek/protocol";
import {
  dispatchFaceMethod,
  ensureImWorkspace,
  IM_AGENT_PRESET_ID,
  IM_WORKSPACE_ID,
  type FaceRuntime,
} from "@xrkseek/server-face";
import {
  bindImSession,
  imChatKey,
  isImNewSessionCommand,
  lookupImSession,
  normalizeImAttachments,
  type ImAttachment,
  type ImMessageRow,
} from "@xrkseek/server-http";

async function ensureImSession(
  face: FaceRuntime,
  sessionId: string,
  label: string,
): Promise<void> {
  await ensureImWorkspace(face);
  if (face.store.has(sessionId)) {
    face.workspaces.attachSession(sessionId, IM_WORKSPACE_ID);
    return;
  }
  const created = await dispatchFaceMethod(
    face,
    "session.create",
    `im-c-${Date.now().toString(36)}`,
    {
      sessionId,
      label,
      workspaceId: IM_WORKSPACE_ID,
      agentPreset: IM_AGENT_PRESET_ID,
    },
  );
  if (created.result.ok) return;
  if (face.store.has(sessionId)) {
    face.workspaces.attachSession(sessionId, IM_WORKSPACE_ID);
    return;
  }
  throw new Error(
    created.result.ok === false
      ? created.result.error.message
      : `session.create failed for ${sessionId}`,
  );
}

function rowAttachments(row: ImMessageRow): ImAttachment[] {
  if (row.attachments?.length) return [...row.attachments];
  return normalizeImAttachments(row.raw ?? {});
}

function attachmentHandleLine(att: ImAttachment): string {
  const parts = [`kind=${att.kind}`];
  if (att.name) parts.push(`name=${att.name}`);
  if (att.mediaType) parts.push(`mediaType=${att.mediaType}`);
  if (att.attachmentId) parts.push(`attachmentId=${att.attachmentId}`);
  if (att.url) parts.push(`url=${att.url}`);
  if (att.path) parts.push(`path=${att.path}`);
  if (typeof att.bytes === "number") parts.push(`bytes=${att.bytes}`);
  if (att.caption) parts.push(`caption=${att.caption}`);
  return parts.join(" ");
}

async function tryImageBlock(
  store: AttachmentStore | undefined,
  att: ImAttachment,
): Promise<ContentBlock | undefined> {
  if (!store || !att.attachmentId) return undefined;
  if (att.kind !== "image") return undefined;
  try {
    const stored = await store.readImage(att.attachmentId);
    return { type: "image", attachment: stored.ref };
  } catch {
    return undefined;
  }
}

async function tryFileBlock(
  store: AttachmentStore | undefined,
  att: ImAttachment,
): Promise<ContentBlock | undefined> {
  if (!store || !att.attachmentId) return undefined;
  try {
    const stored = await store.readFile(att.attachmentId);
    return { type: "file", attachment: stored.ref };
  } catch {
    return undefined;
  }
}

/**
 * Build Face prompt content from an inbound IM row (text + media).
 * Prefer AttachmentStore refs; otherwise emit reader text + modelOnly handles.
 */
export async function imInboundContentBlocks(
  row: ImMessageRow,
  attachmentsStore?: AttachmentStore,
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  const text = row.text.trim();
  if (text) {
    blocks.push({ type: "text", text });
  }
  const attachments = rowAttachments(row);
  for (const att of attachments) {
    const image = await tryImageBlock(attachmentsStore, att);
    if (image) {
      blocks.push(image);
      continue;
    }
    const file = await tryFileBlock(attachmentsStore, att);
    if (file) {
      blocks.push(file);
      continue;
    }
    // No in-process bytes: optional reader caption + model-only locator.
    const label = att.caption?.trim() || att.name?.trim();
    if (label && label !== text) {
      blocks.push({ type: "text", text: label });
    }
    blocks.push({
      type: "text",
      text: attachmentHandleLine(att),
      modelOnly: true,
    });
  }
  if (blocks.length === 0) {
    blocks.push({ type: "text", text: text || "[empty IM message]" });
  }
  return blocks;
}

/**
 * Resolve/create Face session for an inbound IM row and queue the content.
 * Does not auto-send any assistant reply — the model must call `im_send`.
 */
export async function admitImInboundToFace(
  face: FaceRuntime,
  row: ImMessageRow,
  options?: {
    readonly xrkHome?: string;
  },
): Promise<{
  readonly sessionId: string;
  readonly chatKey: string;
  readonly skippedPrompt?: boolean;
}> {
  const xrkHome = options?.xrkHome;
  const raw = row.raw ?? {};
  const chatKey = imChatKey(row.channel, raw, row.botId);
  const forceNew = isImNewSessionCommand(row.text);
  const existing = forceNew ? undefined : lookupImSession(xrkHome, chatKey);
  const binding = bindImSession(xrkHome, {
    chatKey,
    channel: row.channel,
    ...(existing
      ? { sessionId: existing.sessionId }
      : { sessionId: `im-${randomUUID()}` }),
  });
  const sessionId = binding.sessionId;
  const label = `im:${row.channel}:${chatKey.split(":").slice(1).join(":")}`;
  await ensureImSession(face, sessionId, label);

  if (forceNew) {
    return { sessionId, chatKey, skippedPrompt: true };
  }

  const content = await imInboundContentBlocks(row, face.attachments);
  const prompted = await dispatchFaceMethod(
    face,
    "session.prompt",
    `im-p-${row.id}`,
    {
      sessionId,
      mode: "queue",
      content,
    },
  );
  if (!prompted.result.ok) {
    throw new Error(
      prompted.result.ok === false
        ? prompted.result.error.message
        : `session.prompt failed for ${sessionId}`,
    );
  }
  return { sessionId, chatKey };
}

export function createImFaceAdmitHook(options: {
  readonly face: FaceRuntime;
  readonly xrkHome?: string;
}): (row: ImMessageRow) => Promise<void> {
  const face = options.face;
  return async (row) => {
    if (row.direction !== "inbound") return;
    await admitImInboundToFace(
      face,
      row,
      options.xrkHome !== undefined ? { xrkHome: options.xrkHome } : undefined,
    );
  };
}
