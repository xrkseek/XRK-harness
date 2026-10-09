/**
 * Turn-start `<session_capability>` — short two-axis snapshot for the model
 * (permission path gate × tool-surface badge). Orthogonal to collab board.
 */

import { readSessionEvents } from "@xrkseek/core-session";
import {
  effectiveApprovalPolicy,
  effectiveSandboxMode,
  foldPlanMode,
  pathAccessModeFromSandbox,
} from "@xrkseek/protocol";
import type { FaceRuntime } from "./context.js";
import { permissionSelectFromEvents } from "./permissions.js";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";
import { resolveAgentPresetProfile } from "./presets-catalog.js";
import { countExposures } from "@xrkseek/core-tools";

function toolSurfaceSummary(badge: string): string {
  const profile = resolveAgentPresetProfile(badge);
  const bits: string[] = ["fs"];
  if (profile.composition === "harness") bits.push("bash");
  if (profile.tools.web) bits.push("web");
  if (profile.tools.lsp) bits.push("lsp");
  if (profile.tools.pty) bits.push("pty");
  const sub =
    profile.subagents.mode === "off"
      ? "subagents=off"
      : `subagents=${profile.delegation}`;
  return `${badge} (${bits.join("+")} · ${sub})`;
}

/**
 * Compact machine-readable capability block (≤ ~200 chars ideal).
 */
export function formatSessionCapability(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  if (!runtime.store.has(sessionId)) return "";
  // Delegated children get identity from spawn preamble, not this fragment.
  if (runtime.subagents.getByChild(sessionId)) return "";

  const events = readSessionEvents(runtime.store, sessionId);
  const permission = permissionSelectFromEvents(events).currentValue;
  const sandbox = effectiveSandboxMode(events);
  const pathMode = pathAccessModeFromSandbox(sandbox);
  const approval = effectiveApprovalPolicy(events);
  const badge = effectiveSessionAgentPreset(runtime, sessionId);
  const allowN = runtime.pathAllowlist.count(sessionId);
  const planOn = foldPlanMode(events);
  const tools = runtime.tools?.list() ?? [];
  const counts = countExposures(tools);
  const expanded = runtime.toolDisclosure.count(sessionId);

  const lines = [
    `permission: ${permission} (path=${pathMode}) · approval=${approval}`,
    `tool_surface: ${toolSurfaceSummary(badge)}`,
    `path_allowlist: ${allowN} objects (session+settings)`,
    `tools: direct=${counts.direct} deferred=${counts.deferred} expanded=${expanded}`,
  ];
  if (planOn) lines.push("plan: on");
  return lines.join("\n");
}

export function createSessionCapabilityFragmentProvider(runtime: FaceRuntime): {
  readonly id: "session-capability";
  readonly phases: readonly ["turn-start"];
  produce(ctx: { readonly sessionId: string }): readonly {
    readonly id: string;
    readonly kind: "additional_context";
    readonly text: string;
    readonly phase: "turn-start";
    readonly priority: number;
  }[];
} {
  return {
    id: "session-capability",
    phases: ["turn-start"],
    produce({ sessionId }) {
      const value = formatSessionCapability(runtime, sessionId);
      if (!value) return [];
      return [
        {
          id: "additional_context.session_capability",
          kind: "additional_context",
          text: `<session_capability>\n${value}\n</session_capability>`,
          phase: "turn-start",
          // Ahead of collab board (8) so the self-snapshot is seen first.
          priority: 9,
        },
      ];
    },
  };
}
