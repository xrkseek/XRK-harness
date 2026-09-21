import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { parse as parseToml } from "smol-toml";
import {
  createPolicyEngine,
  type CreatePolicyEngineOptions,
} from "./engine.js";
import {
  parsePolicyRuleset,
  type PolicyRulesetJson,
} from "./ruleset.js";
import type { PolicyEngine } from "./types.js";

export type PolicyRulesetFileFormat = "json" | "yaml" | "toml";

/** Detect format from path extension (default json). */
export function policyRulesetFormatFromPath(
  filePath: string,
): PolicyRulesetFileFormat {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".yaml" || ext === ".yml") return "yaml";
  if (ext === ".toml") return "toml";
  return "json";
}

/**
 * Decode ruleset text into a plain object for {@link parsePolicyRuleset}.
 * Same schema for JSON / YAML / TOML — no second engine.
 */
export function decodePolicyRulesetText(
  text: string,
  format: PolicyRulesetFileFormat,
  label = "policy ruleset",
): unknown {
  try {
    if (format === "yaml") {
      const raw = yaml.load(text);
      if (raw === undefined || raw === null) {
        throw new Error("empty YAML document");
      }
      return raw;
    }
    if (format === "toml") {
      return parseToml(text);
    }
    return JSON.parse(text) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${label}: invalid ${format.toUpperCase()} (${msg})`, {
      cause: err,
    });
  }
}

/**
 * Load and parse a policy ruleset file (`.json` / `.yaml` / `.yml` / `.toml`).
 * Host watches `XRK_POLICY_FILE` and reloads via the same function.
 */
export async function loadPolicyRulesetFile(
  filePath: string,
): Promise<CreatePolicyEngineOptions> {
  const text = await readFile(filePath, "utf8");
  const format = policyRulesetFormatFromPath(filePath);
  const raw = decodePolicyRulesetText(
    text,
    format,
    `policy ruleset ${filePath}`,
  );
  try {
    return parsePolicyRuleset(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`policy ruleset ${filePath}: ${msg}`, { cause: err });
  }
}

/** Load file → create engine (any supported format). */
export async function createPolicyEngineFromFile(
  filePath: string,
): Promise<PolicyEngine> {
  return createPolicyEngine(await loadPolicyRulesetFile(filePath));
}

export type { PolicyRulesetJson };
