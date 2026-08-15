import type {
  PolicyEngine,
  PolicyRule,
  PolicySubjectKind,
  PolicyVerdict,
} from "./types.js";
import {
  allowProviderIdsOnly,
  allowToolNamesOnly,
  askToolNames,
  denyMcpConnect,
  denyProviderIds,
  denyToolNames,
} from "./rules.js";
import {
  createPolicyEngine,
  type CreatePolicyEngineOptions,
} from "./engine.js";

export const POLICY_RULESET_VERSION = 1 as const;

export type PolicyRuleAction = "deny" | "ask" | "allow-only";

export interface PolicyRulesetRuleJson {
  readonly id: string;
  readonly action: PolicyRuleAction;
  readonly reason?: string;
  readonly match: {
    readonly kind: PolicySubjectKind;
    /** Required for tool.call / provider.use (name lists). Ignored for mcp.connect deny. */
    readonly names?: readonly string[];
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
]);
const VERDICTS = new Set<PolicyVerdict>(["allow", "deny", "ask"]);
const ACTIONS = new Set<PolicyRuleAction>(["deny", "ask", "allow-only"]);

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
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
      `rule ${id}: match.kind must be tool.call|provider.use|mcp.connect`,
    );
  }

  const opts = {
    id,
    ...(reason !== undefined ? { reason } : {}),
  };

  if (kind === "mcp.connect") {
    if (action !== "deny") {
      throw new PolicyRulesetParseError(
        `rule ${id}: mcp.connect only supports action deny`,
      );
    }
    return denyMcpConnect(opts);
  }

  const names = parseNames(raw.match.names, id);

  if (kind === "tool.call") {
    if (action === "deny") return denyToolNames(names, opts);
    if (action === "ask") return askToolNames(names, opts);
    return allowToolNamesOnly(names, opts);
  }

  // provider.use
  if (action === "ask") {
    throw new PolicyRulesetParseError(
      `rule ${id}: provider.use does not support ask (use deny or allow-only)`,
    );
  }
  if (action === "deny") return denyProviderIds(names, opts);
  return allowProviderIdsOnly(names, opts);
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
