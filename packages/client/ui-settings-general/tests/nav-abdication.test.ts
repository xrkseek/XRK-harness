/**
 * Settings nav projection keeps first-per-id over raw entries so abdicated
 * cells still appear (entriesOfSlot would drop them).
 */
import { describe, expect, it } from "vitest";
import { SlotCore } from "@xrkseek/client-ui-slots";
import { resolveSlotLabel } from "@xrkseek/client-ui-slots";

function projectNav(core: SlotCore) {
  const seen = new Set<string>();
  const projected: { id: string; order: number; label: string }[] = [];
  for (const e of core.entries("settings.section")) {
    const id = e.options.id ?? "";
    if (seen.has(id)) continue;
    seen.add(id);
    projected.push({
      id,
      order: e.options.order ?? 0,
      label: resolveSlotLabel(e.options.label) ?? "",
    });
  }
  return projected.sort((a, b) => a.order - b.order);
}

describe("settings section nav vs abdication", () => {
  it("keeps abdicated section ids in the nav projection", () => {
    const core = new SlotCore();
    core.register(
      {
        name: "root",
        children: {
          "settings.section": { kind: "list", scope: "root" },
        },
      } as never,
      () => null,
    );
    core.register(
      {
        name: "settings.section",
        id: "general",
        order: 0,
        label: "General",
      } as never,
      () => null,
    );
    core.register(
      {
        name: "settings.section",
        id: "mnemon",
        order: 20,
        label: "记忆系统",
      } as never,
      () => null,
    );
    const crashed = core
      .entries("settings.section")
      .find((e) => e.options.id === "mnemon")!;
    expect(projectNav(core).some((r) => r.id === "mnemon")).toBe(true);

    core.reportEntryError("settings.section", crashed, new Error("boom"), {
      abdicate: true,
    });

    expect(
      core.entriesOfSlot("settings.section").some((e) => e.options.id === "mnemon"),
    ).toBe(false);
    expect(
      projectNav(core).some((r) => r.id === "mnemon" && r.label === "记忆系统"),
    ).toBe(true);
  });
});
