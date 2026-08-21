import type { SessionEvent } from "@xrkseek/protocol";
import {
  EMPTY_PLAN_UNIT,
  applyPlanUnitEvent,
  viewPlanProjection,
  type PlanProjection,
  type PlanUnitState,
} from "@xrkseek/protocol";
import type { ProjectionDefinition } from "../registry.js";

/**
 * DSH `plan` projection: fold `/plan` command/run + `plan/mode`.
 * `pending` is true while an outstanding selection differs from logged active.
 */
export function createPlanProjectionUnit(): ProjectionDefinition<
  "plan",
  PlanUnitState,
  PlanProjection
> {
  return {
    key: "plan",
    stateVersion: 1,
    init: () => EMPTY_PLAN_UNIT,
    apply(state, event: SessionEvent): PlanUnitState {
      return applyPlanUnitEvent(state, event);
    },
    wire: {
      view: (state) => viewPlanProjection(state),
      parse(value: unknown): PlanProjection {
        if (!value || typeof value !== "object") {
          throw new Error("plan projection must be PlanProjection");
        }
        const v = value as { active?: unknown; pending?: unknown };
        if (typeof v.active !== "boolean" || typeof v.pending !== "boolean") {
          throw new Error("plan projection shape invalid");
        }
        return { active: v.active, pending: v.pending };
      },
    },
  };
}
