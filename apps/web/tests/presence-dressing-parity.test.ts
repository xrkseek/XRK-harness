import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The picker list and the Host whitelist must carry the same ids in the same
 * order.
 *
 * They live in different packages (`ui-plan` renders the picker, `face`
 * sanitises what the wire accepts), so an id added to one alone looks selected
 * in the panel and then reads back as `none`: `applyFromState` in
 * `presence-settings-runtime` runs the stored pick through `parseSlotPick`,
 * which drops anything the client list does not carry. `brand-xrk` shipped
 * exactly that way — selectable, persisted, never rendered.
 */
const DRESSING = "packages/server/face/src/presence-dressing.ts";
const SETTINGS = "packages/client/ui-plan/src/presence-settings.ts";

function constList(src: string, name: string): string[] {
  const start = src.indexOf(`export const ${name} = [`);
  if (start < 0) throw new Error(`missing ${name}`);
  const end = src.indexOf("] as const", start);
  if (end < 0) throw new Error(`unterminated ${name}`);
  return [
    ...src
      .slice(start, end)
      .matchAll(/'([a-zA-Z0-9-]+)'|"([a-zA-Z0-9-]+)"/g),
  ].map((match) => match[1] ?? match[2]!);
}

const dressing = readFileSync(DRESSING, "utf8");
const settings = readFileSync(SETTINGS, "utf8");

describe("presence dressing pick parity", () => {
  it("hat picks match the Host whitelist", () => {
    expect(constList(settings, "PRESENCE_HAT_KITS")).toEqual(
      constList(dressing, "HAT_BUILTINS"),
    );
  });

  it("glasses picks match the Host whitelist", () => {
    expect(constList(settings, "PRESENCE_GLASSES_KITS")).toEqual(
      constList(dressing, "GLASSES_BUILTINS"),
    );
  });

  it("held picks match the Host whitelist", () => {
    expect(constList(settings, "PRESENCE_HELD_KITS")).toEqual(
      constList(dressing, "HELD_BUILTINS"),
    );
  });
});
