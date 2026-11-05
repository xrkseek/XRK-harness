import { describe, expect, it } from "vitest";
import {
  allBuiltInSeatTitles,
  readSeatTitles,
  seatTitlesFingerprint,
  seatTitlesForScheme,
} from "../src/seat-titles.js";

describe("seat-titles", () => {
  it("scheme × locale has no hardcoded single-language path", () => {
    expect(seatTitlesForScheme("office", "zh")).toEqual({
      boss: "老板",
      manager: "经理",
      agent: "干员",
    });
    expect(seatTitlesForScheme("guild", "en").boss).toBe("Guild master");
    expect(seatTitlesForScheme("corp", "ja").manager).toBe("課長");
  });

  it("custom fields win over scheme defaults", () => {
    expect(
      readSeatTitles(
        {
          titleScheme: "office",
          titleBoss: "主公",
          titleManager: "",
          titleAgent: "侠客",
        },
        "zh",
      ),
    ).toEqual({ boss: "主公", manager: "经理", agent: "侠客" });
  });

  it("fingerprint ignores mood / kit so remount stays title-only", () => {
    const base = { titleScheme: "office", moodId: "16", kit: "none" };
    expect(seatTitlesFingerprint(base)).toBe(
      seatTitlesFingerprint({ ...base, moodId: "10", kitHeld: "flower" }),
    );
    expect(seatTitlesFingerprint(base)).not.toBe(
      seatTitlesFingerprint({ ...base, titleScheme: "guild" }),
    );
    expect(seatTitlesFingerprint(base)).not.toBe(
      seatTitlesFingerprint({ ...base, titleBoss: "主公" }),
    );
  });

  it("allBuiltInSeatTitles covers every scheme locale for Overview strip", () => {
    const all = allBuiltInSeatTitles();
    expect(all).toContain("老板");
    expect(all).toContain("Guild master");
    expect(all).toContain("課長");
    expect(all).toContain("水手");
  });
});
