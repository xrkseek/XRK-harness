import { describe, expect, it } from "vitest";
import {
  catalogSeedDisplayLabel,
  catalogSeedFormalName,
  isCatalogSeedLabelId,
  sunflowerDisplayLabel,
  sunflowerFormalName,
  sunflowerLockedNickname,
} from "../src/catalog-seed-labels.js";

describe("catalog-seed-labels", () => {
  const titles = { boss: "老板", manager: "经理", agent: "干员" };

  it("locks nick as xrkseek and localizes formal 向日葵", () => {
    expect(sunflowerFormalName("zh")).toBe("向日葵");
    expect(sunflowerFormalName("en")).toBe("Sunflower");
    expect(sunflowerFormalName("ja")).toBe("ひまわり");
    expect(sunflowerLockedNickname("zh")).toBe("xrkseek");
    expect(sunflowerLockedNickname("en")).toBe("xrkseek");
    expect(sunflowerDisplayLabel("zh")).toBe("向日葵（xrkseek）");
    expect(sunflowerDisplayLabel("en")).toBe("Sunflower（xrkseek）");
    expect(sunflowerDisplayLabel("ja")).toBe("ひまわり（xrkseek）");
  });

  it("localizes built-in agent formals", () => {
    expect(catalogSeedFormalName("mem_seed_researcher", "zh")).toBe("调研员");
    expect(catalogSeedFormalName("mem_seed_researcher", "en")).toBe("Researcher");
    expect(catalogSeedFormalName("mem_seed_researcher", "ja")).toBe("リサーチャー");
    expect(catalogSeedFormalName("mem_seed_tester", "en")).toBe("Tester");
    expect(catalogSeedFormalName("mem_custom", "en")).toBeUndefined();
  });

  it("uses seat titles for manager and ignores custom sunflower nick", () => {
    expect(
      catalogSeedDisplayLabel("mem_seed_manager", "zh", {
        seatTitles: titles,
        nickname: "老王",
      }),
    ).toBe("经理（老王）");
    expect(
      catalogSeedDisplayLabel("mem_seed_xrkseek", "en", {
        nickname: "hacked",
      }),
    ).toBe("Sunflower（xrkseek）");
    expect(
      catalogSeedDisplayLabel("mem_seed_worker", "en", { nickname: "Bob" }),
    ).toBe("Builder（Bob）");
  });

  it("marks known catalog label ids", () => {
    expect(isCatalogSeedLabelId("mem_seed_docs")).toBe(true);
    expect(isCatalogSeedLabelId("mem_seed_xrkseek")).toBe(true);
    expect(isCatalogSeedLabelId("mem_user")).toBe(false);
  });
});
