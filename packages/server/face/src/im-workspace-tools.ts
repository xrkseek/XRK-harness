/**
 * IM orchestration tools — thin alias over shared binder.
 * Host still binds `subagent` for IM; `workspace_id` on subagent is IM-only.
 */

import type { ToolRegistry } from "@xrkseek/core-tools";
import type { FaceRuntime } from "./context.js";
import { bindWorkspaceOrchestrateTools } from "./workspace-orchestrate-tools.js";

export interface BindImWorkspaceToolsOptions {
  readonly runtime: FaceRuntime;
  readonly sessionId: string;
}

/** Register workspace_list / workspace_create / workspace_session_prompt for IM. */
export function bindImWorkspaceTools(
  tools: ToolRegistry,
  options: BindImWorkspaceToolsOptions,
): void {
  bindWorkspaceOrchestrateTools(tools, {
    runtime: options.runtime,
    sessionId: options.sessionId,
    mode: "im",
  });
}
