import type { FaceProjectionRegistry } from "./registry.js";
import { createTitleProjectionUnit } from "./units/title.js";
import { createSessionListMetadataUnit } from "./units/session-list-metadata.js";
import { createTodosProjectionUnit } from "./units/todos.js";
import { createPermissionsProjectionUnit } from "./units/permissions.js";
import { createPlanProjectionUnit } from "./units/plan.js";

/** Register Face default projection units. */
export function installDefaultFaceProjections(
  registry: FaceProjectionRegistry,
): { dispose(): void } {
  const offTitle = registry.register(createTitleProjectionUnit());
  const offMeta = registry.register(createSessionListMetadataUnit());
  const offTodos = registry.register(createTodosProjectionUnit());
  const offPerm = registry.register(createPermissionsProjectionUnit());
  const offPlan = registry.register(createPlanProjectionUnit());
  return {
    dispose() {
      offTitle();
      offMeta();
      offTodos();
      offPerm();
      offPlan();
    },
  };
}
