import type { PolicyDecision, PolicyRule, PolicySubject } from "./types.js";

function asSet(names: ReadonlySet<string> | readonly string[]): Set<string> {
  return names instanceof Set ? new Set(names) : new Set(names);
}

/** Deny listed tool names (`tool.call`). */
export function denyToolNames(
  names: ReadonlySet<string> | readonly string[],
  options?: { readonly id?: string; readonly reason?: string },
): PolicyRule {
  const set = asSet(names);
  const id = options?.id ?? "deny-tools";
  const reason = options?.reason ?? "tool on denylist";
  return {
    id,
    match(subject: PolicySubject): PolicyDecision | undefined {
      if (subject.kind !== "tool.call") return undefined;
      if (!set.has(subject.name)) return undefined;
      return { verdict: "deny", reason, ruleId: id };
    },
  };
}

/** Allow only listed tool names; other tools deny. */
export function allowToolNamesOnly(
  names: ReadonlySet<string> | readonly string[],
  options?: { readonly id?: string; readonly reason?: string },
): PolicyRule {
  const set = asSet(names);
  const id = options?.id ?? "allow-tools-only";
  const reason = options?.reason ?? "tool not on allowlist";
  return {
    id,
    match(subject: PolicySubject): PolicyDecision | undefined {
      if (subject.kind !== "tool.call") return undefined;
      if (set.has(subject.name)) {
        return { verdict: "allow", ruleId: id };
      }
      return { verdict: "deny", reason, ruleId: id };
    },
  };
}

/** Require approval (`ask`) for listed tools. */
export function askToolNames(
  names: ReadonlySet<string> | readonly string[],
  options?: { readonly id?: string; readonly reason?: string },
): PolicyRule {
  const set = asSet(names);
  const id = options?.id ?? "ask-tools";
  const reason = options?.reason ?? "tool requires approval";
  return {
    id,
    match(subject: PolicySubject): PolicyDecision | undefined {
      if (subject.kind !== "tool.call") return undefined;
      if (!set.has(subject.name)) return undefined;
      return { verdict: "ask", reason, ruleId: id };
    },
  };
}

/** Deny listed LLM provider ids (`provider.use`). */
export function denyProviderIds(
  ids: ReadonlySet<string> | readonly string[],
  options?: { readonly id?: string; readonly reason?: string },
): PolicyRule {
  const set = asSet(ids);
  const id = options?.id ?? "deny-providers";
  const reason = options?.reason ?? "provider on denylist";
  return {
    id,
    match(subject: PolicySubject): PolicyDecision | undefined {
      if (subject.kind !== "provider.use") return undefined;
      if (!set.has(subject.providerId)) return undefined;
      return { verdict: "deny", reason, ruleId: id };
    },
  };
}

/** Allow only listed providers; others deny. */
export function allowProviderIdsOnly(
  ids: ReadonlySet<string> | readonly string[],
  options?: { readonly id?: string; readonly reason?: string },
): PolicyRule {
  const set = asSet(ids);
  const id = options?.id ?? "allow-providers-only";
  const reason = options?.reason ?? "provider not on allowlist";
  return {
    id,
    match(subject: PolicySubject): PolicyDecision | undefined {
      if (subject.kind !== "provider.use") return undefined;
      if (set.has(subject.providerId)) {
        return { verdict: "allow", ruleId: id };
      }
      return { verdict: "deny", reason, ruleId: id };
    },
  };
}

/** Explicit deny for any mcp.connect (redundant with default, useful as documented rule). */
export function denyMcpConnect(options?: {
  readonly id?: string;
  readonly reason?: string;
}): PolicyRule {
  const id = options?.id ?? "deny-mcp-connect";
  const reason =
    options?.reason ?? "mcp.connect denied (MCP client not shipped)";
  return {
    id,
    match(subject: PolicySubject): PolicyDecision | undefined {
      if (subject.kind !== "mcp.connect") return undefined;
      return { verdict: "deny", reason, ruleId: id };
    },
  };
}
