/**
 * 奇创 (向阳空间) orchestration tools — thin alias over shared binder.
 */

import type { ToolRegistry } from "@xrkseek/core-tools";
import type { FaceRuntime } from "./context.js";
import { bindWorkspaceOrchestrateTools } from "./workspace-orchestrate-tools.js";

export interface BindXiangyangWorkspaceToolsOptions {
  readonly runtime: FaceRuntime;
  readonly sessionId: string;
}

/** Register workspace_list / workspace_create / workspace_session_prompt for 奇创. */
export function bindXiangyangWorkspaceTools(
  tools: ToolRegistry,
  options: BindXiangyangWorkspaceToolsOptions,
): void {
  bindWorkspaceOrchestrateTools(tools, {
    runtime: options.runtime,
    sessionId: options.sessionId,
    mode: "qichuang",
  });
}
