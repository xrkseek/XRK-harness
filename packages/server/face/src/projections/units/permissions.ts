import type { SessionEvent } from "@xrkseek/protocol";
import {
  EMPTY_PERMISSION_KNOBS,
  applyPermissionKnobEvent,
  type PermissionKnobState,
} from "@xrkseek/protocol";
import type { ProjectionDefinition } from "../registry.js";
import {
  derivePermissionSelect,
  type PermissionSelect,
  type PermissionSelectOption,
} from "../../permissions.js";

/**
 * DSH `permissions` projection: fold knob events; view = select options + current.
 */
export function createPermissionsProjectionUnit(): ProjectionDefinition<
  "permissions",
  PermissionKnobState,
  PermissionSelect
> {
  return {
    key: "permissions",
    stateVersion: 1,
    init: () => EMPTY_PERMISSION_KNOBS,
    apply(state, event: SessionEvent): PermissionKnobState {
      return applyPermissionKnobEvent(state, event);
    },
    view: (state) => derivePermissionSelect(state),
    parse(value: unknown): PermissionSelect {
      if (!value || typeof value !== "object") {
        throw new Error("permissions projection must be PermissionSelect");
      }
      const v = value as {
        options?: unknown;
        currentValue?: unknown;
      };
      if (typeof v.currentValue !== "string" || !Array.isArray(v.options)) {
        throw new Error("permissions projection shape invalid");
      }
      const options: PermissionSelectOption[] = [];
      for (const row of v.options) {
        if (!row || typeof row !== "object") {
          throw new Error("permissions option invalid");
        }
        const o = row as Record<string, unknown>;
        if (typeof o.value !== "string" || typeof o.name !== "string") {
          throw new Error("permissions option invalid");
        }
        options.push({
          value: o.value,
          name: o.name,
          ...(typeof o.description === "string"
            ? { description: o.description }
            : {}),
        });
      }
      return { options, currentValue: v.currentValue };
    },
  };
}
