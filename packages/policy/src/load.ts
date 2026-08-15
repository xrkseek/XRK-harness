import { readFile } from "node:fs/promises";
import {
  createPolicyEngineFromRuleset,
  parsePolicyRuleset,
  type PolicyRulesetJson,
} from "./ruleset.js";
import type { PolicyEngine } from "./types.js";
import type { CreatePolicyEngineOptions } from "./engine.js";

/**
 * Load and parse a policy ruleset JSON file.
 * Does not watch for changes — reload by calling again.
 */
export async function loadPolicyRulesetFile(
  filePath: string,
): Promise<CreatePolicyEngineOptions> {
  const text = await readFile(filePath, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`policy ruleset ${filePath}: invalid JSON (${msg})`, {
      cause: err,
    });
  }
  try {
    return parsePolicyRuleset(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`policy ruleset ${filePath}: ${msg}`, { cause: err });
  }
}

/** Load file → create engine. */
export async function createPolicyEngineFromFile(
  filePath: string,
): Promise<PolicyEngine> {
  const text = await readFile(filePath, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`policy ruleset ${filePath}: invalid JSON (${msg})`, {
      cause: err,
    });
  }
  return createPolicyEngineFromRuleset(raw);
}

export type { PolicyRulesetJson };
