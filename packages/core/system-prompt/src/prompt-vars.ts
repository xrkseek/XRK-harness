/**
 * Strict `{{name}}` prompt variables (DSH system-prompt semantics).
 * Tool schema / SDK sections set `interpolate: false` so literal `{{…}}` in
 * descriptions survives render.
 */

/** Own-property variable names: lowercase letter, then [a-z0-9_]. */
export const PROMPT_VARIABLE_NAME = /^[a-z][a-z0-9_]*$/;

/** Complete simple group at the start of a slice. */
const GROUP_AT = /^\{\{([^{}]*)\}\}/;

export interface PromptVarSection {
  readonly name: string;
  readonly text: string;
  /**
   * When false, keep `{{…}}` literally (generated tool docs / PTC SDK).
   * Default true.
   */
  readonly interpolate?: boolean;
}

/**
 * Interpolate one section or throw on malformed / unknown / undefined refs.
 * A lone `{{` with no later `}}` stays prose; substituted values are not rescanned.
 */
export function interpolatePromptText(
  text: string,
  variables: Record<string, string | undefined>,
  where: string,
): string {
  let result = "";
  let last = 0;
  for (let open = text.indexOf("{{"); open >= 0; open = text.indexOf("{{", last)) {
    const group = GROUP_AT.exec(text.slice(open));
    if (group === null) {
      if (text.indexOf("}}", open + 2) >= 0) {
        throw new Error(
          `malformed prompt variable reference at "${text.slice(open, open + 16)}…" in ${where} (references are complete simple {{name}} groups)`,
        );
      }
      result += text.slice(last, open + 2);
      last = open + 2;
      continue;
    }
    const name = group[0].slice(2, -2);
    if (!PROMPT_VARIABLE_NAME.test(name)) {
      throw new Error(
        `malformed prompt variable reference "{{${name}}}" in ${where} (variable names match ${String(PROMPT_VARIABLE_NAME)})`,
      );
    }
    if (!Object.hasOwn(variables, name)) {
      const known = Object.keys(variables);
      throw new Error(
        `unknown prompt variable "{{${name}}}" in ${where}; registered variables: ${known.length > 0 ? known.join(", ") : "(none)"}`,
      );
    }
    const value = variables[name];
    if (value === undefined) {
      throw new Error(
        `prompt variable "{{${name}}}" has no value for this assembly (${where})`,
      );
    }
    result += text.slice(last, open) + value;
    last = open + group[0].length;
  }
  return result + text.slice(last);
}

/**
 * Drop empty sections, join with blank lines. Sections with `interpolate: false`
 * retain literal braces (tools:sdk / tool schema documentation).
 */
export function renderPromptSections(
  sections: readonly PromptVarSection[],
  variables: Record<string, string | undefined> = {},
): string {
  return sections
    .map((section) =>
      section.interpolate === false
        ? section.text
        : interpolatePromptText(
            section.text,
            variables,
            `section "${section.name}"`,
          ),
    )
    .filter((text) => text.length > 0)
    .join("\n\n");
}
