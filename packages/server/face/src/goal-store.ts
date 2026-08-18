/**
 * Face `goals/*` — Host-computed `goal` projection + Typert remotes.
 * Creation is `/goal` (commands/execute) or `goals/create`; dock mutates via CAS.
 */

import { readFileSync } from "node:fs";
import { admitPrompt, listPendingAdmits } from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import type { FaceRpcResult } from "./types.js";
import { tryWriteJsonSidecar } from "./json-sidecar.js";

export const DEFAULT_MAX_GOAL_ROUNDS = 8;
export const GOAL_OBJECTIVE_MAX_CHARS = 4000;

export type GoalPhase = "active" | "paused" | "blocked" | "complete";
export type GoalActivation = "armed" | "disarmed";

export interface GoalRef {
  readonly id: string;
  readonly revision: number;
}

export interface GoalView {
  readonly id: string;
  readonly revision: number;
  readonly objective: string;
  readonly phase: GoalPhase;
  readonly activation: GoalActivation;
  readonly maxGoalRounds: number;
  readonly roundsStarted: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly blockedReason?: { readonly code: string; readonly message: string };
}

export type GoalProjectionValue = { readonly goal: GoalView } | null;

type MutableGoal = {
  -readonly [K in keyof GoalView]: GoalView[K];
};

function sessionExists(runtime: FaceRuntime, sessionId: string): boolean {
  return runtime.store.has(sessionId);
}

function fail(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): FaceRpcResult<never> {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } };
}

const PHASES = new Set<GoalPhase>([
  "active",
  "paused",
  "blocked",
  "complete",
]);

export class FaceGoalStore {
  private readonly bySession = new Map<string, MutableGoal>();
  private readonly persistPath: string | undefined;
  private runtime: FaceRuntime | undefined;

  constructor(persistPath?: string) {
    this.persistPath = persistPath;
    if (persistPath) this.load();
  }

  bind(runtime: FaceRuntime): void {
    this.runtime = runtime;
    let pruned = false;
    for (const sessionId of [...this.bySession.keys()]) {
      if (!sessionExists(runtime, sessionId)) {
        this.bySession.delete(sessionId);
        pruned = true;
        continue;
      }
      this.publish(sessionId, false);
    }
    if (pruned) this.save();
  }

  get(sessionId: string): GoalView | undefined {
    const row = this.bySession.get(sessionId);
    return row ? { ...row } : undefined;
  }

  onTurnEnd(sessionId: string): void {
    const runtime = this.runtime;
    const goal = this.bySession.get(sessionId);
    if (!runtime || !goal) return;
    if (goal.phase !== "active" || goal.activation !== "armed") return;
    if (listPendingAdmits(runtime.store.get(sessionId).events, sessionId).length > 0) {
      runtime.drain.wake(sessionId);
      return;
    }
    if (goal.roundsStarted >= goal.maxGoalRounds) {
      goal.phase = "blocked";
      goal.activation = "disarmed";
      goal.blockedReason = {
        code: "max-rounds",
        message: `goal reached maxGoalRounds (${goal.maxGoalRounds})`,
      };
      goal.updatedAt = Date.now();
      this.publish(sessionId);
      return;
    }
    this.startRound(sessionId, goal, `Continue the current goal until it is done.\n\nGoal: ${goal.objective}`);
    this.publish(sessionId);
  }

  create(
    sessionId: string,
    objective: string,
    maxGoalRounds?: number,
  ): FaceRpcResult<{ ref: GoalRef }> {
    const runtime = this.requireRuntime();
    const trimmed = objective.trim();
    if (!sessionId) return fail("invalid-payload", "agentId required");
    if (!trimmed) return fail("invalid-payload", "objective required");
    if (trimmed.length > GOAL_OBJECTIVE_MAX_CHARS) {
      return fail("invalid-payload", "objective too long");
    }
    if (!sessionExists(runtime, sessionId)) {
      return fail("session-not-found", sessionId, { sessionId });
    }
    const existing = this.bySession.get(sessionId);
    if (existing && existing.phase !== "complete") {
      return fail("session-conflict", "a goal is already active", {
        sessionId,
      });
    }
    const now = Date.now();
    const cap =
      typeof maxGoalRounds === "number" &&
      Number.isInteger(maxGoalRounds) &&
      maxGoalRounds > 0
        ? maxGoalRounds
        : DEFAULT_MAX_GOAL_ROUNDS;
    const goal: MutableGoal = {
      id: `goal_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      revision: 1,
      objective: trimmed,
      phase: "active",
      activation: "armed",
      maxGoalRounds: cap,
      roundsStarted: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.bySession.set(sessionId, goal);
    this.startRound(sessionId, goal, trimmed);
    this.publish(sessionId);
    return { ok: true, value: { ref: { id: goal.id, revision: goal.revision } } };
  }

  edit(
    sessionId: string,
    ref: GoalRef,
    patch: { objective?: string; maxGoalRounds?: number },
  ): FaceRpcResult<GoalView> {
    const hit = this.mutate(sessionId, ref, (goal) => {
      if (patch.objective !== undefined) {
        const trimmed = patch.objective.trim();
        if (!trimmed) return fail("invalid-payload", "objective required");
        if (trimmed.length > GOAL_OBJECTIVE_MAX_CHARS) {
          return fail("invalid-payload", "objective too long");
        }
        goal.objective = trimmed;
      }
      if (patch.maxGoalRounds !== undefined) {
        if (!Number.isInteger(patch.maxGoalRounds) || patch.maxGoalRounds < 1) {
          return fail("invalid-payload", "maxGoalRounds must be a positive integer");
        }
        goal.maxGoalRounds = patch.maxGoalRounds;
      }
      return undefined;
    });
    return hit;
  }

  pause(sessionId: string, ref: GoalRef): FaceRpcResult<GoalView> {
    return this.mutate(sessionId, ref, (goal) => {
      if (goal.phase === "complete") {
        return fail("session-conflict", "completed goal cannot be paused", {
          sessionId,
        });
      }
      goal.phase = "paused";
      goal.activation = "disarmed";
      return undefined;
    });
  }

  resume(sessionId: string, ref: GoalRef): FaceRpcResult<GoalView> {
    return this.mutate(sessionId, ref, (goal) => {
      if (goal.phase === "complete") {
        return fail("session-conflict", "completed goal cannot be resumed", {
          sessionId,
        });
      }
      goal.phase = "active";
      goal.activation = "armed";
      delete goal.blockedReason;
      this.startRound(
        sessionId,
        goal,
        `Resume the current goal.\n\nGoal: ${goal.objective}`,
      );
      return undefined;
    });
  }

  complete(sessionId: string, ref: GoalRef): FaceRpcResult<GoalView> {
    return this.mutate(sessionId, ref, (goal) => {
      goal.phase = "complete";
      goal.activation = "disarmed";
      return undefined;
    });
  }

  clear(sessionId: string, ref: GoalRef): FaceRpcResult<GoalRef> {
    const runtime = this.requireRuntime();
    if (!sessionId) return fail("invalid-payload", "agentId required");
    if (!sessionExists(runtime, sessionId)) {
      return fail("session-not-found", sessionId, { sessionId });
    }
    const current = this.bySession.get(sessionId);
    if (!current) {
      return fail("session-conflict", "no current goal", { sessionId });
    }
    if (current.id !== ref.id || current.revision !== ref.revision) {
      return fail("session-conflict", "goal revision mismatch", { sessionId });
    }
    this.bySession.delete(sessionId);
    this.publish(sessionId);
    return { ok: true, value: { id: ref.id, revision: ref.revision } };
  }

  private startRound(sessionId: string, goal: MutableGoal, content: string): void {
    const runtime = this.requireRuntime();
    goal.roundsStarted += 1;
    goal.updatedAt = Date.now();
    admitPrompt(runtime.store, sessionId, content);
    runtime.drain.wake(sessionId);
  }

  private mutate(
    sessionId: string,
    ref: GoalRef,
    apply: (goal: MutableGoal) => FaceRpcResult<never> | undefined,
  ): FaceRpcResult<GoalView> {
    const runtime = this.requireRuntime();
    if (!sessionId) return fail("invalid-payload", "agentId required");
    if (!sessionExists(runtime, sessionId)) {
      return fail("session-not-found", sessionId, { sessionId });
    }
    const current = this.bySession.get(sessionId);
    if (!current) {
      return fail("session-conflict", "no current goal", { sessionId });
    }
    if (current.id !== ref.id || current.revision !== ref.revision) {
      return fail("session-conflict", "goal revision mismatch", { sessionId });
    }
    const rejected = apply(current);
    if (rejected) return rejected;
    current.revision += 1;
    current.updatedAt = Date.now();
    this.publish(sessionId);
    return { ok: true, value: { ...current } };
  }

  private publish(sessionId: string, persist = true): void {
    const runtime = this.requireRuntime();
    const goal = this.bySession.get(sessionId);
    const value: GoalProjectionValue = goal ? { goal: { ...goal } } : null;
    const seq = runtime.seq.next(sessionId);
    runtime.projections.setSidecar(sessionId, "goal", value, seq);
    if (persist) this.save();
  }

  private load(): void {
    const file = this.persistPath;
    if (!file) return;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as {
        goals?: Record<string, unknown>;
      };
      if (!raw.goals || typeof raw.goals !== "object") return;
      for (const [sessionId, row] of Object.entries(raw.goals)) {
        const goal = parseGoal(row);
        if (!goal || !sessionId) continue;
        this.bySession.set(sessionId, goal);
      }
    } catch {
      /* missing / corrupt sidecar → empty */
    }
  }

  private save(): void {
    const file = this.persistPath;
    if (!file) return;
    const goals: Record<string, GoalView> = {};
    for (const [id, goal] of this.bySession) goals[id] = { ...goal };
    tryWriteJsonSidecar(file, { goals });
  }

  private requireRuntime(): FaceRuntime {
    if (!this.runtime) throw new Error("FaceGoalStore is not bound");
    return this.runtime;
  }
}

function parseGoal(raw: unknown): MutableGoal | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.objective !== "string") return undefined;
  if (typeof o.revision !== "number" || o.revision < 1) return undefined;
  if (typeof o.phase !== "string" || !PHASES.has(o.phase as GoalPhase)) {
    return undefined;
  }
  const activation = o.activation === "disarmed" ? "disarmed" : "armed";
  const maxGoalRounds =
    typeof o.maxGoalRounds === "number" && o.maxGoalRounds > 0
      ? o.maxGoalRounds
      : DEFAULT_MAX_GOAL_ROUNDS;
  const roundsStarted =
    typeof o.roundsStarted === "number" && o.roundsStarted >= 0
      ? o.roundsStarted
      : 0;
  const createdAt = typeof o.createdAt === "number" ? o.createdAt : Date.now();
  const updatedAt = typeof o.updatedAt === "number" ? o.updatedAt : createdAt;
  const blocked =
    o.blockedReason &&
    typeof o.blockedReason === "object" &&
    typeof (o.blockedReason as { code?: unknown }).code === "string" &&
    typeof (o.blockedReason as { message?: unknown }).message === "string"
      ? {
          code: (o.blockedReason as { code: string }).code,
          message: (o.blockedReason as { message: string }).message,
        }
      : undefined;
  return {
    id: o.id,
    revision: o.revision,
    objective: o.objective,
    phase: o.phase as GoalPhase,
    activation,
    maxGoalRounds,
    roundsStarted,
    createdAt,
    updatedAt,
    ...(blocked ? { blockedReason: blocked } : {}),
  };
}
