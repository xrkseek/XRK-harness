/**
 * Built-in Host slash-command description localization.
 * Canonical English copy lives in {@link en}; Face must emit the same strings
 * for a row to translate with the UI locale.
 */
import { en, type CommandKey } from "./locales.ts";

/** Locale keys for the canonical first-party Host command descriptions. */
export const HOST_DESCRIPTION_KEYS = new Map<string, CommandKey>([
  ["compact", "description.compact"],
  ["export", "description.export"],
  ["feedback", "description.feedback"],
  ["goal", "description.goal"],
  ["permission", "description.permission"],
  ["plan", "description.plan"],
  ["mcp", "description.mcp"],
  ["status", "description.status"],
  ["model", "description.model"],
  ["theme", "description.theme"],
  ["skills", "description.skills"],
  ["auto-review", "description.auto-review"],
]);

/**
 * Translate exact built-in Host copy while preserving scoped or third-party
 * descriptors verbatim.
 * @param name - command name without the leading slash.
 * @param description - Host or override description text.
 * @param translate - `command`-namespace translator for the active locale.
 */
export function localizeHostCommandDescription(
  name: string,
  description: string,
  translate: (key: CommandKey) => string,
): string {
  const key = HOST_DESCRIPTION_KEYS.get(name);
  return key !== undefined && description === en[key]
    ? translate(key)
    : description;
}
