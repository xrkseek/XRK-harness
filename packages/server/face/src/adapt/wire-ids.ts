/**
 * Session-scoped turn/step counters for DSH wire (numeric, order of first seen).
 * Prefer this over hashing string ids so trajectory location math stays monotonic.
 */

export class FaceWireIdMaps {
  private readonly turns = new Map<string, Map<string, number>>();
  private readonly steps = new Map<string, Map<string, number>>();
  private readonly turnCount = new Map<string, number>();
  private readonly stepCount = new Map<string, number>();

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
}
