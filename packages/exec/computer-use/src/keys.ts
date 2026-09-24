/**
 * Map model-facing key combos (ctrl+s, return, …) onto WinForms SendKeys.
 * Escape reserved SendKeys punctuation in bare character tokens.
 */

const NAMED: Record<string, string> = {
  return: "{ENTER}",
  enter: "{ENTER}",
  tab: "{TAB}",
  escape: "{ESC}",
  esc: "{ESC}",
  backspace: "{BACKSPACE}",
  bksp: "{BACKSPACE}",
  delete: "{DELETE}",
  del: "{DELETE}",
  space: " ",
  up: "{UP}",
  down: "{DOWN}",
  left: "{LEFT}",
  right: "{RIGHT}",
  home: "{HOME}",
  end: "{END}",
  pageup: "{PGUP}",
  pagedown: "{PGDN}",
  pgup: "{PGUP}",
  pgdn: "{PGDN}",
  insert: "{INSERT}",
};

for (let i = 1; i <= 12; i += 1) {
  NAMED[`f${i}`] = `{F${i}}`;
}

function escapeLiteral(ch: string): string {
  // SendKeys treats these as meta unless braced.
  if ("+^%~(){}".includes(ch)) return `{${ch}}`;
  if (ch === "[") return "{[}";
  if (ch === "]") return "{]}";
  return ch;
}

/**
 * Convert `ctrl+shift+s` / `return` into a SendKeys string.
 * Throws if the combo is empty or contains an unknown named key.
 */
export function mapKeysToSendKeys(keys: string): string {
  const raw = keys.trim();
  if (!raw) {
    throw new Error("keys must be a non-empty string");
  }
  const parts = raw.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("keys must be a non-empty string");
  }
  let mods = "";
  const keyParts: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") {
      mods += "^";
      continue;
    }
    if (lower === "alt") {
      mods += "%";
      continue;
    }
    if (lower === "shift") {
      mods += "+";
      continue;
    }
    if (lower === "win" || lower === "meta" || lower === "cmd") {
      throw new Error("win/meta keys are not supported via SendKeys");
    }
    const named = NAMED[lower];
    if (named !== undefined) {
      keyParts.push(named);
      continue;
    }
    if (part.length === 1) {
      keyParts.push(escapeLiteral(part));
      continue;
    }
    throw new Error(`unknown key token: ${part}`);
  }
  if (keyParts.length === 0) {
    throw new Error("keys must include a non-modifier key");
  }
  return `${mods}${keyParts.join("")}`;
}
