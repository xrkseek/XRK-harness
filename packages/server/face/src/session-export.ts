/**
 * GET/HEAD `/api/session.export` — ZIP of session JSONL (+ descendants, attachments).
 * Shell: dsh-session-log-export HEAD then browser download.
 */

import { readSessionEvents, toPackedJSONL, zstdCompressUtf8 } from "@xrkseek/core-session";
import { listImageRefs, type SessionEvent } from "@xrkseek/protocol";
import type { FaceRuntime } from "./context.js";
import { buildStoredZip, zipEntryName, type ZipStoreEntry } from "./zip-store.js";
import type { CostUsageProjection } from "./projections/units/cost-usage.js";
import { costMeterGetState } from "./cost-meter-store.js";
import { buildRolloutTraceState } from "./rollout-trace.js";

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

  const eventsBySession: Record<string, ReturnType<typeof readSessionEvents>> =
    {};
  for (const id of ids) {
    if (!sessionExists(runtime, id)) {
      missing.push(id);
      continue;
    }
    const events = readSessionEvents(runtime.store, id);
    eventsBySession[id] = events;
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

  const costBySession: Record<string, CostUsageProjection | null> = {};
  for (const id of ids) {
    if (!sessionExists(runtime, id)) {
      costBySession[id] = null;
      continue;
    }
    const snap = runtime.projections.snapshot(id);
    costBySession[id] =
      (snap.values.costUsage as CostUsageProjection | undefined) ?? null;
  }
  let ledger: Record<string, unknown> | null;
  try {
    const state = costMeterGetState();
    ledger = {
      today: {
        date: state.today.date,
        cost: state.today.cost,
        input: state.today.input,
        output: state.today.output,
        byModel: state.today.byModel,
        byProviderModel: state.today.byProviderModel,
      },
      month: {
        date: state.month.date,
        cost: state.month.cost,
        input: state.month.input,
        output: state.month.output,
        byModel: state.month.byModel,
        byProviderModel: state.month.byProviderModel,
      },
      total: {
        cost: state.total.cost,
        input: state.total.input,
        output: state.total.output,
        byModel: state.total.byModel,
        byProviderModel: state.total.byProviderModel,
      },
    };
  } catch {
    ledger = null;
  }
  entries.push({
    name: zipEntryName("cost.json"),
    data: Buffer.from(
      `${JSON.stringify(
        {
          product: "XRK-Harness",
          rootSessionId: rootId,
          sessions: costBySession,
          ledger,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  });

  const traceLinks =
    includeDescendants
      ? links
      : [...runtime.subagents.list(rootId)];
  const rolloutTrace = buildRolloutTraceState({
    rootSessionId: rootId,
    eventsBySession,
    links: traceLinks.map((link) => ({
      parentSessionId: link.parentSessionId,
      childSessionId: link.childSessionId,
      mode: link.mode,
      label: link.label,
    })),
  });
  entries.push({
    name: zipEntryName("trace/state.json"),
    data: Buffer.from(`${JSON.stringify(rolloutTrace, null, 2)}\n`, "utf8"),
  });

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
          costSidecar: "cost.json",
          rolloutTraceSidecar: "trace/state.json",
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
