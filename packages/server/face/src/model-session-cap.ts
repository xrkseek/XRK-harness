/**
 * Per-route (provider + model) concurrent session ceiling.
 * Parent and subagent sessions count equally; routes are independent
 * (provider A / model X ≠ provider B / model X).
 *
 * "Live" means drain-active only. Blank composers and idle history do not
 * hold the slot — otherwise New Session dies once the store has more than
 * `max` past chats (or accumulated empty tabs) on the default free model.
 * Parallel admits still cannot overshoot via `reserveModelSessionSlot`
 * pending credits across `await` gaps.
 */

import type { FaceRuntime } from "./context.js";
import {
  buildFaceModelCatalog,
  resolveSessionModelSelection,
  type FaceModelSelection,
} from "./model-catalog.js";

/** Global default when neither model row nor agent-loop override is set. */
export const DEFAULT_MAX_CONCURRENT_MODEL_SESSIONS = 5;

/** In-flight admits that have not yet appeared on `store.list()`. */
const pendingByRoute = new Map<string, number>();

export function routeKey(provider: string, model: string): string {
  return `${provider.trim()}\0${model.trim()}`;
}

function loopDefaultCap(runtime: FaceRuntime): number {
  const loop = runtime.settingsNamespaces.view("agent-loop").value as Record<
    string,
    unknown
  >;
  const raw = loop.maxConcurrentModelSessions;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.min(64, Math.floor(raw));
  }
  return DEFAULT_MAX_CONCURRENT_MODEL_SESSIONS;
}

/** Catalog row override for one provider/model, else undefined. */
export function catalogModelSessionCap(
  runtime: FaceRuntime,
  provider: string,
  model: string,
): number | undefined {
  const { groups } = buildFaceModelCatalog(runtime);
  const group = groups.find((g) => g.id === provider);
  const row = group?.models.find((m) => m.id === model) as
    | { readonly maxConcurrentSessions?: number }
    | undefined;
  const raw = row?.maxConcurrentSessions;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.min(64, Math.floor(raw));
  }
  return undefined;
}

/** Effective ceiling for this provider/model route. */
export function resolveModelSessionCap(
  runtime: FaceRuntime,
  provider: string,
  model: string,
): number {
  return (
    catalogModelSessionCap(runtime, provider, model) ?? loopDefaultCap(runtime)
  );
}

function isLiveSession(runtime: FaceRuntime, sessionId: string): boolean {
  if (!runtime.store.has(sessionId)) return false;
  if (runtime.workspaces.isArchived(sessionId)) return false;
  return runtime.drain.isActive(sessionId);
}

function pendingOnRoute(provider: string, model: string): number {
  return pendingByRoute.get(routeKey(provider, model)) ?? 0;
}

/** Live sessions whose effective route is this provider/model. */
export function countSessionsUsingModel(
  runtime: FaceRuntime,
  provider: string,
  model: string,
): number {
  const p = provider.trim();
  const m = model.trim();
  if (!p || !m) return 0;
  let n = 0;
  for (const id of runtime.store.list()) {
    if (!isLiveSession(runtime, id)) continue;
    const sel = resolveSessionModelSelection(runtime, id);
    if (sel.provider === p && sel.model === m) n += 1;
  }
  return n;
}

export interface ModelSessionQuota {
  readonly provider: string;
  readonly model: string;
  readonly using: number;
  readonly max: number;
  readonly slotsFree: number;
}

export function resolveModelSessionQuota(
  runtime: FaceRuntime,
  selection: FaceModelSelection,
): ModelSessionQuota {
  const provider = selection.provider.trim();
  const model = selection.model.trim();
  const max = resolveModelSessionCap(runtime, provider, model);
  const using =
    countSessionsUsingModel(runtime, provider, model) +
    pendingOnRoute(provider, model);
  return {
    provider,
    model,
    using,
    max,
    slotsFree: Math.max(0, max - using),
  };
}

function occupancy(
  runtime: FaceRuntime,
  provider: string,
  model: string,
  excludeSessionId?: string,
): number {
  let using = 0;
  for (const id of runtime.store.list()) {
    if (excludeSessionId && id === excludeSessionId) continue;
    if (!isLiveSession(runtime, id)) continue;
    const sel = resolveSessionModelSelection(runtime, id);
    if (sel.provider === provider && sel.model === model) using += 1;
  }
  return using + pendingOnRoute(provider, model);
}

function capMessage(
  provider: string,
  model: string,
  using: number,
  max: number,
): string {
  return (
    `model session cap: ${provider}/${model} already has ${using}/${max} live sessions ` +
    `(running; default ${DEFAULT_MAX_CONCURRENT_MODEL_SESSIONS}; set maxConcurrentSessions on the model or agent-loop.maxConcurrentModelSessions)`
  );
}

/**
 * Error text when opening one more session on this route would exceed the cap.
 * `excludeSessionId` ignores a session that already holds a slot (reuse / switch).
 */
export function modelSessionCapProblem(
  runtime: FaceRuntime,
  selection: FaceModelSelection,
  options?: { readonly excludeSessionId?: string },
): string | undefined {
  const provider = selection.provider.trim();
  const model = selection.model.trim();
  if (!provider || !model) return undefined;
  const max = resolveModelSessionCap(runtime, provider, model);
  const using = occupancy(runtime, provider, model, options?.excludeSessionId);
  if (using >= max) return capMessage(provider, model, using, max);
  return undefined;
}

export type ModelSessionCapDetails = {
  readonly provider: string;
  readonly model: string;
  readonly using: number;
  readonly max: number;
};

export type ModelSessionSlot =
  | { readonly ok: true; readonly release: () => void }
  | {
      readonly ok: false;
      readonly problem: string;
      readonly details: ModelSessionCapDetails;
    };

/**
 * Atomically check + hold one pending credit for this route until `release`.
 * Call `release` after the session is live (or on any failure before that).
 */
export function reserveModelSessionSlot(
  runtime: FaceRuntime,
  selection: FaceModelSelection,
  options?: { readonly excludeSessionId?: string },
): ModelSessionSlot {
  const provider = selection.provider.trim();
  const model = selection.model.trim();
  if (!provider || !model) {
    return { ok: true, release: () => undefined };
  }
  const max = resolveModelSessionCap(runtime, provider, model);
  const using = occupancy(runtime, provider, model, options?.excludeSessionId);
  if (using >= max) {
    return {
      ok: false,
      problem: capMessage(provider, model, using, max),
      details: { provider, model, using, max },
    };
  }
  const key = routeKey(provider, model);
  pendingByRoute.set(key, (pendingByRoute.get(key) ?? 0) + 1);
  let held = true;
  return {
    ok: true,
    release: () => {
      if (!held) return;
      held = false;
      const n = pendingByRoute.get(key) ?? 0;
      if (n <= 1) pendingByRoute.delete(key);
      else pendingByRoute.set(key, n - 1);
    },
  };
}

/** Test helper — drop in-flight credits between cases. */
export function resetModelSessionCapPendingForTests(): void {
  pendingByRoute.clear();
}
