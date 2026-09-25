/**
 * Per-session model selection sidecar (DSH session metadata parity).
 * Survives Host restart; distinct from Settings `agent-default-model`.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FaceModelSelection } from "./model-catalog.js";

const VERSION = 1 as const;

interface PersistShape {
  readonly version: typeof VERSION;
  readonly selections: Record<string, FaceModelSelection>;
}

function atomicWrite(filePath: string, text: string): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, filePath);
}

export function sessionModelsPath(productHome: string): string {
  return path.join(productHome, "session-models.json");
}

/** Load all persisted session overrides (empty map when missing/corrupt). */
export function loadSessionModelSelections(
  filePath: string,
): Map<string, FaceModelSelection> {
  const out = new Map<string, FaceModelSelection>();
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as PersistShape;
    if (raw?.version !== VERSION || !raw.selections || typeof raw.selections !== "object") {
      return out;
    }
    for (const [id, sel] of Object.entries(raw.selections)) {
      const sessionId = id.trim();
      const provider = String(sel?.provider ?? "").trim();
      const model = String(sel?.model ?? "").trim();
      if (!sessionId || !provider || !model) continue;
      out.set(sessionId, {
        provider,
        model,
        ...(typeof sel.reasoningEffort === "string" && sel.reasoningEffort.trim()
          ? { reasoningEffort: sel.reasoningEffort.trim() }
          : {}),
      });
    }
  } catch {
    /* missing or unreadable — cold start */
  }
  return out;
}

/** Persist one session override (merge into the file). */
export function saveSessionModelSelection(
  filePath: string,
  sessionId: string,
  selection: FaceModelSelection,
): void {
  const id = sessionId.trim();
  if (!id) return;
  const map = loadSessionModelSelections(filePath);
  map.set(id, {
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort
      ? { reasoningEffort: selection.reasoningEffort }
      : {}),
  });
  const selections: Record<string, FaceModelSelection> = {};
  for (const [k, v] of map) selections[k] = v;
  const body: PersistShape = { version: VERSION, selections };
  atomicWrite(filePath, `${JSON.stringify(body, null, 2)}\n`);
}
