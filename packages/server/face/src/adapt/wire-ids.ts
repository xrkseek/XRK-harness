/**
 * Session-scoped turn/step counters for Face wire (numeric, order of first seen).
 * Prefer this over hashing string ids so trajectory location math stays monotonic.
 */

export class FaceWireIdMaps {
  private readonly turns = new Map<string, Map<string, number>>();
  private readonly steps = new Map<string, Map<string, number>>();
  private readonly turnCount = new Map<string, number>();
  private readonly stepCount = new Map<string, number>();
  /** Log length last successfully primed — skip full rewalk on soft reopens. */
  private readonly primedLen = new Map<string, number>();

  turn(sessionId: string, turnId: string): number {
    let byTurn = this.turns.get(sessionId);
    if (!byTurn) {
      byTurn = new Map();
      this.turns.set(sessionId, byTurn);
    }
    const hit = byTurn.get(turnId);
    if (hit !== undefined) return hit;
    const n = (this.turnCount.get(sessionId) ?? 0) + 1;
    this.turnCount.set(sessionId, n);
    byTurn.set(turnId, n);
    return n;
  }

  step(sessionId: string, turnId: string, stepId: string): number {
    const key = `${turnId}\0${stepId}`;
    let byStep = this.steps.get(sessionId);
    if (!byStep) {
      byStep = new Map();
      this.steps.set(sessionId, byStep);
    }
    const hit = byStep.get(key);
    if (hit !== undefined) return hit;
    const countKey = `${sessionId}\0${turnId}`;
    const n = (this.stepCount.get(countKey) ?? 0) + 1;
    this.stepCount.set(countKey, n);
    byStep.set(key, n);
    return n;
  }

  /**
   * Number every turn/step in durable log order. History must call this
   * before wiring a tail page — otherwise the first `turn/start` in the
   * window becomes wire `1`, and a later loadOlder assigns the real first
   * 轮次 a late number (the 0.5.11 opener showing as 第 5 轮).
   *
   * Append-friendly: same length is a no-op; growth only walks the new
   * suffix; shrink / replace clears and rewalks (append-only logs never shrink).
   */
  primeFromLog(sessionId: string, events: readonly { readonly type: string; readonly turnId?: string; readonly stepId?: string }[]): void {
    const len = events.length;
    const prev = this.primedLen.get(sessionId) ?? 0;
    if (prev === len) return;
    let from = 0;
    if (prev > 0 && prev < len) {
      from = prev;
    } else {
      this.clear(sessionId);
    }
    for (let i = from; i < len; i++) {
      const event = events[i]!;
      if (event.type === "turn/start" && typeof event.turnId === "string") {
        this.turn(sessionId, event.turnId);
      } else if (
        event.type === "step/start"
        && typeof event.turnId === "string"
        && typeof event.stepId === "string"
      ) {
        this.step(sessionId, event.turnId, event.stepId);
      }
    }
    this.primedLen.set(sessionId, len);
  }

  /**
   * Drop every session-scoped bucket for one session. Called on session
   * eviction so long-running hosts do not retain turn/step counters for
   * evicted sessions (per-session entries would otherwise accumulate forever).
   */
  clear(sessionId: string): void {
    this.turns.delete(sessionId);
    this.steps.delete(sessionId);
    this.turnCount.delete(sessionId);
    this.primedLen.delete(sessionId);
    // stepCount keys are `${sessionId}\0${turnId}`; sweep all belonging to the session.
    const prefix = `${sessionId}\0`;
    for (const key of this.stepCount.keys()) {
      if (key.startsWith(prefix)) this.stepCount.delete(key);
    }
  }
}
