import type {
  PolicyDecision,
  PolicyEngine,
  PolicyRule,
  PolicySubjectKind,
  PolicyVerdict,
} from "./types.js";
import {
  allowProviderIdsOnly,
  allowToolNamesOnly,
  askHostOpenActions,
  askToolNames,
  denyHostOpenActions,
  denyMcpConnect,
  denyMcpResourceServers,
  denyOfficeConnect,
  denyProviderIds,
  denySidebarEmbedSchemes,
  denySidebarFsOps,
  denyToolNames,
} from "./rules.js";
import {
  createPolicyEngine,
  type CreatePolicyEngineOptions,
} from "./engine.js";
import {
  WhenExprError,
  compileWhenExpr,
  whenEnvFromSubject,
  type WhenEnv,
} from "./when-expr.js";

export const POLICY_RULESET_VERSION = 1 as const;

export type PolicyRuleAction = "deny" | "ask" | "allow-only";

export interface PolicyRulesetRuleJson {
  readonly id: string;
  readonly action: PolicyRuleAction;
  readonly reason?: string;
  readonly match: {
    readonly kind: PolicySubjectKind;
    /**
     * Name / id / action / scheme / op lists depending on kind.
     * Ignored for mcp.connect / office.connect deny-all rules.
     * Optional when `when` is set (deny/ask only).
     */
    readonly names?: readonly string[];
    /**
     * Restricted boolean expression over the subject (`name`, `args`, …).
     * Compiled at load; see `compileWhenExpr`. No second engine — filter only.
     */
    readonly when?: string;
  };
}

export interface PolicyRulesetJson {
  readonly version: 1;
  readonly defaults?: Partial<Record<PolicySubjectKind, PolicyVerdict>>;
  readonly rules?: readonly PolicyRulesetRuleJson[];
}

export class PolicyRulesetParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyRulesetParseError";
  }
}

const KINDS = new Set<PolicySubjectKind>([
  "tool.call",
  "provider.use",
  "mcp.connect",
  "mcp.resource",
  "host.open",
  "sidebar.embed",
  "sidebar.fs",
  "office.connect",
]);
const VERDICTS = new Set<PolicyVerdict>(["allow", "deny", "ask"]);
const ACTIONS = new Set<PolicyRuleAction>(["deny", "ask", "allow-only"]);

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseWhen(
  value: unknown,
  ruleId: string,
): ((env: WhenEnv) => boolean) | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new PolicyRulesetParseError(
      `rule ${ruleId}: match.when must be a non-empty string`,
    );
  }
  try {
    return compileWhenExpr(value);
  } catch (err) {
    if (err instanceof WhenExprError) {
      throw new PolicyRulesetParseError(`rule ${ruleId}: ${err.message}`);
    }
    throw err;
  }
}

function withWhen(
  rule: PolicyRule,
  when: ((env: WhenEnv) => boolean) | undefined,
): PolicyRule {
  if (when === undefined) return rule;
  return {
    id: rule.id,
    match(subject): PolicyDecision | undefined {
      if (!when(whenEnvFromSubject(subject))) return undefined;
      return rule.match(subject);
    },
  };
}

/** Kind-wide deny/ask used when `when` is set and `names` is omitted. */
function kindWide(
  kind: PolicySubjectKind,
  action: "deny" | "ask",
  opts: { readonly id: string; readonly reason?: string },
): PolicyRule {
  const reason = opts.reason ?? `${action} ${kind} (when)`;
  return {
    id: opts.id,
    match(subject): PolicyDecision | undefined {
      if (subject.kind !== kind) return undefined;
      return { verdict: action, reason, ruleId: opts.id };
    },
  };
}

function parseNames(value: unknown, ruleId: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PolicyRulesetParseError(
      `rule ${ruleId}: names must be a non-empty string array`,
    );
  }
  const names: string[] = [];
  for (const n of value) {
    if (typeof n !== "string" || !n.trim()) {
      throw new PolicyRulesetParseError(
        `rule ${ruleId}: names entries must be non-empty strings`,
      );
    }
    names.push(n.trim());
  }
  return names;
}

function ruleFromJson(raw: unknown, index: number): PolicyRule {
  if (!isObject(raw)) {
    throw new PolicyRulesetParseError(`rules[${index}]: expected object`);
  }
  const id = raw.id;
  if (typeof id !== "string" || !id.trim()) {
    throw new PolicyRulesetParseError(`rules[${index}]: missing string id`);
  }
  const action = raw.action;
  if (typeof action !== "string" || !ACTIONS.has(action as PolicyRuleAction)) {
    throw new PolicyRulesetParseError(
      `rule ${id}: action must be deny|ask|allow-only`,
    );
  }
  const reason =
    raw.reason === undefined
      ? undefined
      : typeof raw.reason === "string"
        ? raw.reason
        : (() => {
            throw new PolicyRulesetParseError(`rule ${id}: reason must be string`);
          })();

  if (!isObject(raw.match)) {
    throw new PolicyRulesetParseError(`rule ${id}: missing match object`);
  }
  const kind = raw.match.kind;
  if (typeof kind !== "string" || !KINDS.has(kind as PolicySubjectKind)) {
    throw new PolicyRulesetParseError(
      `rule ${id}: match.kind must be a known PolicySubjectKind`,
    );
  }

  const opts = {
    id,
    ...(reason !== undefined ? { reason } : {}),
  };
  const when = parseWhen(raw.match.when, id);
  const finish = (rule: PolicyRule): PolicyRule => withWhen(rule, when);

  if (kind === "mcp.connect") {
    if (action !== "deny") {
      throw new PolicyRulesetParseError(
        `rule ${id}: mcp.connect only supports action deny`,
      );
    }
    return finish(denyMcpConnect(opts));
  }

  if (kind === "office.connect") {
    if (action !== "deny") {
      throw new PolicyRulesetParseError(
        `rule ${id}: office.connect only supports action deny`,
      );
    }
    return finish(denyOfficeConnect(opts));
  }

  if (raw.match.names === undefined) {
    if (when === undefined || action === "allow-only") {
      throw new PolicyRulesetParseError(
        `rule ${id}: names must be a non-empty string array`,
      );
    }
    return finish(kindWide(kind as PolicySubjectKind, action, opts));
  }

  const names = parseNames(raw.match.names, id);

  if (kind === "mcp.resource") {
    if (action !== "deny") {
      throw new PolicyRulesetParseError(
        `rule ${id}: mcp.resource only supports action deny`,
      );
    }
    return finish(denyMcpResourceServers(names, opts));
  }

  if (kind === "host.open") {
    if (action === "allow-only") {
      throw new PolicyRulesetParseError(
        `rule ${id}: host.open does not support allow-only (use deny or ask)`,
      );
    }
    if (action === "ask") return finish(askHostOpenActions(names, opts));
    return finish(denyHostOpenActions(names, opts));
  }

  if (kind === "sidebar.embed") {
    if (action !== "deny") {
      throw new PolicyRulesetParseError(
        `rule ${id}: sidebar.embed only supports action deny`,
      );
    }
    return finish(denySidebarEmbedSchemes(names, opts));
  }

  if (kind === "sidebar.fs") {
    if (action !== "deny") {
      throw new PolicyRulesetParseError(
        `rule ${id}: sidebar.fs only supports action deny`,
      );
    }
    return finish(denySidebarFsOps(names, opts));
  }

  if (kind === "tool.call") {
    if (action === "deny") return finish(denyToolNames(names, opts));
    if (action === "ask") return finish(askToolNames(names, opts));
    return finish(allowToolNamesOnly(names, opts));
  }

  // provider.use
  if (action === "ask") {
    throw new PolicyRulesetParseError(
      `rule ${id}: provider.use does not support ask (use deny or allow-only)`,
    );
  }
  if (action === "deny") return finish(denyProviderIds(names, opts));
  return finish(allowProviderIdsOnly(names, opts));
}

/**
 * Parse a policy ruleset JSON document into engine options.
 */
export function parsePolicyRuleset(value: unknown): CreatePolicyEngineOptions {
  if (!isObject(value)) {
    throw new PolicyRulesetParseError("expected object");
  }
  const version = value.version;
  if (version !== 1 && version !== POLICY_RULESET_VERSION) {
    throw new PolicyRulesetParseError(
      `unsupported version ${String(version)} (expected 1)`,
    );
  }

  let defaults: CreatePolicyEngineOptions["defaults"];
  if (value.defaults !== undefined) {
    if (!isObject(value.defaults)) {
      throw new PolicyRulesetParseError("defaults must be an object");
    }
    const d: Partial<Record<PolicySubjectKind, PolicyVerdict>> = {};
    for (const [k, v] of Object.entries(value.defaults)) {
      if (!KINDS.has(k as PolicySubjectKind)) {
        throw new PolicyRulesetParseError(`defaults: unknown kind ${k}`);
      }
      if (typeof v !== "string" || !VERDICTS.has(v as PolicyVerdict)) {
        throw new PolicyRulesetParseError(
          `defaults.${k}: must be allow|deny|ask`,
        );
      }
      d[k as PolicySubjectKind] = v as PolicyVerdict;
    }
    defaults = d;
  }

  const rulesRaw = value.rules;
  const rules: PolicyRule[] = [];
  if (rulesRaw !== undefined) {
    if (!Array.isArray(rulesRaw)) {
      throw new PolicyRulesetParseError("rules must be an array");
    }
    for (let i = 0; i < rulesRaw.length; i++) {
      rules.push(ruleFromJson(rulesRaw[i], i));
    }
  }

  return {
    ...(defaults ? { defaults } : {}),
    ...(rules.length ? { rules } : {}),
  };
}

/** Build an engine from a parsed/unknown JSON document. */
export function createPolicyEngineFromRuleset(value: unknown): PolicyEngine {
  return createPolicyEngine(parsePolicyRuleset(value));
}
