import type {
  MonotonicGuard,
  PreHandler,
  ToolPipelineContext,
} from "@xrkseek/core-tools";
import { createPolicyEngine } from "./engine.js";
import { denyToolNames } from "./rules.js";
import type { PolicyEngine } from "./types.js";

function toolSubject(ctx: ToolPipelineContext) {
  const args =
    ctx.args && typeof ctx.args === "object" && !Array.isArray(ctx.args)
      ? (ctx.args as Record<string, unknown>)
      : undefined;
  return {
    kind: "tool.call" as const,
    name: ctx.call.name,
    ...(args ? { args } : {}),
  };
}

/**
 * Pre-execute bridge: maps policy `ask` → pipeline `{ action: "ask" }`
 * (approval hook; default deny if unset).
 */
export function createPolicyToolPre(engine: PolicyEngine): PreHandler {
  return (ctx) => {
    const d = engine.evaluate(toolSubject(ctx));
    if (d.verdict === "allow") return { action: "continue", args: ctx.args };
    const reason = d.reason ?? `policy ${d.verdict}`;
    if (d.verdict === "ask") return { action: "ask", reason };
    return { action: "deny", reason };
  };
}

/**
 * Guard bridge: `allow`/`deny` only. `ask` is treated as `deny`
 * (use `createPolicyToolPre` when approval is wired).
 */
export function createPolicyToolGuard(engine: PolicyEngine): MonotonicGuard {
  return (ctx) => {
    const d = engine.evaluate(toolSubject(ctx));
    if (d.verdict === "allow") return "allow";
    if (d.verdict === "deny" || d.verdict === "ask") {
      ctx.denyReason =
        d.reason ??
        (d.verdict === "ask"
          ? "policy requires approval (ask via pre-execute)"
          : "denied by policy");
      return "deny";
    }
    return "abstain";
  };
}

/**
 * Back-compat denylist guard (same contract as `@xrkseek/core-tools`
 * `createPolicyToolCallGuard`). Prefer `createPolicyEngine` + rules for new code.
 */
export function createPolicyToolCallGuard(
  denylist: ReadonlySet<string> | readonly string[],
): MonotonicGuard {
  return createPolicyToolGuard(
    createPolicyEngine({ rules: [denyToolNames(denylist)] }),
  );
}
