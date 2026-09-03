/**
 * GET/HEAD `/api/session.export` — ZIP of session JSONL (+ descendants, attachments).
 * Shell: dsh-session-log-export HEAD then browser download.
 */

import { readSessionEvents, toPackedJSONL, zstdCompressUtf8 } from "@xrkseek/core-session";
import { listImageRefs, type SessionEvent } from "@xrkseek/protocol";
import type { FaceRuntime } from "./context.js";
import { buildStoredZip, zipEntryName, type ZipStoreEntry } from "./zip-store.js";

export const SESSION_EXPORT_PATHS = [
  "/api/session.export",
  "/api/face/session.export",
] as const;

export function isSessionExportPath(pathname: string): boolean {
  return (SESSION_EXPORT_PATHS as readonly string[]).includes(pathname);
}

export function sessionExportFilename(sessionId: string): string {
  return `xrk-session-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_")}.zip`;
}

function sessionExists(runtime: FaceRuntime, sessionId: string): boolean {
  return runtime.store.has(sessionId);
}

function collectDescendants(
  runtime: FaceRuntime,
  rootId: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const link of runtime.subagents.list(id)) {
      if (seen.has(link.childSessionId)) continue;
      seen.add(link.childSessionId);
      out.push(link.childSessionId);
      queue.push(link.childSessionId);
    }
  }
  return out;
}

function mediaTypeExt(mediaType: string): string {
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/webp") return "webp";
  if (mediaType === "image/gif") return "gif";
  return "bin";
}

function attachmentIdsFromEvents(events: readonly SessionEvent[]): string[] {
  const ids = new Set<string>();
  for (const e of events) {
    if (e.type === "user/message" || e.type === "prompt/admitted") {
      for (const ref of listImageRefs(e.content)) ids.add(ref.attachmentId);
    }
  }
  return [...ids];
}

export async function buildSessionExportZip(
  runtime: FaceRuntime,
  rootId: string,
  includeDescendants: boolean,
): Promise<Buffer> {
  const ids = includeDescendants
    ? [rootId, ...collectDescendants(runtime, rootId)]
    : [rootId];
  const entries: ZipStoreEntry[] = [];
  const missing: string[] = [];
  const links = includeDescendants
    ? ids.flatMap((id) => [...runtime.subagents.list(id)])
    : [];
  const attachmentIds = new Set<string>();

  for (const id of ids) {
    if (!sessionExists(runtime, id)) {
      missing.push(id);
      continue;
    }
    const events = readSessionEvents(runtime.store, id);
    const packed = toPackedJSONL(events);
    entries.push({
      name: zipEntryName(`sessions/${id}.jsonl`),
      data: Buffer.from(packed, "utf8"),
    });
    entries.push({
      name: zipEntryName(`sessions/${id}.jsonl.zst`),
      data: zstdCompressUtf8(packed),
    });
    for (const aid of attachmentIdsFromEvents(events)) attachmentIds.add(aid);
  }
  if (runtime.attachments) {
    for (const aid of attachmentIds) {
      try {
        const stored = await runtime.attachments.readImage(aid);
        const ext = mediaTypeExt(stored.ref.mediaType);
        entries.push({
          name: zipEntryName(`attachments/${aid}.${ext}`),
          data: stored.data,
        });
      } catch {
        missing.push(`attachment:${aid}`);
      }
    }
  }

  entries.unshift({
    name: "manifest.json",
    data: Buffer.from(
      `${JSON.stringify(
        {
          product: "XRK-Harness",
          rootSessionId: rootId,
          includeDescendants,
          exportedAt: Date.now(),
          sessions: ids,
          sessionEncoding: "text-chunks+jsonl",
          sessionCompressedSidecar: "zstd",
          missing,
          subagents: links,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  });

  return buildStoredZip(entries);
}
