import {
  createPolicyEngine,
  type PolicyEngine,
  type PolicyRule,
} from "@xrkseek/policy";
import type { RegisteredPlugin } from "./types.js";

export interface AppliedPluginPolicyRule {
  readonly pluginId: string;
  readonly ruleId: string;
}

/**
 * `kind: "policy"` plugins contribute ordered {@link PolicyRule} rows merged
 * before {@link createPolicyEngine} in presets. Reserved kind — no runtime wire
 * beyond rule collection until Host policy reload is defined.
 */
export function isPolicyPlugin(
  plugin: RegisteredPlugin,
): plugin is RegisteredPlugin & { readonly kind: "policy" } {
  return plugin.kind === "policy";
}

/** Collect plugin policy rules in registration order (first plugin wins on rule id clashes at evaluate time). */
export function collectPolicyRules(
  plugins: readonly RegisteredPlugin[],
): readonly PolicyRule[] {
  const rules: PolicyRule[] = [];
  for (const plugin of plugins) {
    if (!isPolicyPlugin(plugin)) continue;
    rules.push(...(plugin.policyRules ?? []));
  }
  return rules;
}

/**
 * Merge explicit base rules with `kind: "policy"` plugin contributions.
 * Presets pass the result to `createPolicyEngine({ rules })` when no custom engine is supplied.
 */
export function wireCompositionPolicy(
  options: {
    readonly baseRules?: readonly PolicyRule[];
    readonly plugins?: readonly RegisteredPlugin[];
  } = {},
): readonly PolicyRule[] {
  return [
    ...(options.baseRules ?? []),
    ...collectPolicyRules(options.plugins ?? []),
  ];
}

/**
 * Explicit `engine` wins; else merge plugin `policyRules` into a new engine.
 * Returns `undefined` when no rules are configured.
 */
export function createPolicyEngineFromPlugins(
  options: {
    readonly engine?: PolicyEngine;
    readonly baseRules?: readonly PolicyRule[];
    readonly plugins?: readonly RegisteredPlugin[];
  } = {},
): PolicyEngine | undefined {
  if (options.engine !== undefined) return options.engine;
  const rules = wireCompositionPolicy({
    ...(options.baseRules !== undefined ? { baseRules: options.baseRules } : {}),
    ...(options.plugins !== undefined ? { plugins: options.plugins } : {}),
  });
  if (rules.length === 0) return undefined;
  return createPolicyEngine({ rules });
}

/** Inventory helper: which policy rules each plugin registered. */
export function applyPolicyPlugins(
  plugins: readonly RegisteredPlugin[],
): { readonly applied: readonly AppliedPluginPolicyRule[] } {
  const applied: AppliedPluginPolicyRule[] = [];
  for (const plugin of plugins) {
    if (!isPolicyPlugin(plugin)) continue;
    for (const rule of plugin.policyRules ?? []) {
      applied.push({ pluginId: plugin.id, ruleId: rule.id });
    }
  }
  return { applied };
}
