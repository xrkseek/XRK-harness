import { describe, expect, it } from "vitest";
import { remapHostModuleId } from "../src/dsh-compat/host-module-remap-ids.js";

describe("remapHostModuleId", () => {
  it("maps exact Host peers onto XRK packages", () => {
    expect(remapHostModuleId("@deepseek-ai/dsh-llm")).toBe("@xrkseek/xrk-llm");
    expect(remapHostModuleId("@deepseek-ai/dsh-llm-pi-ai")).toBe(
      "@xrkseek/xrk-llm-pi-ai",
    );
    expect(remapHostModuleId("@earendil-works/pi-ai")).toBe("@xrkseek/xrk-pi-ai");
    expect(remapHostModuleId("@deepseek-ai/cordis")).toBe("@xrkseek/cordis");
    expect(remapHostModuleId("@deepseek-ai/dsh-credentials")).toBe(
      "@xrkseek/secrets",
    );
    expect(remapHostModuleId("@deepseek-ai/dsh-agent-loop")).toBe(
      "@xrkseek/core-agent-loop",
    );
    expect(remapHostModuleId("@deepseek-ai/dsh-workspace")).toBe(
      "@xrkseek/workspace",
    );
  });

  it("applies dsh-* → xrk-* convention including subpaths", () => {
    expect(remapHostModuleId("@deepseek-ai/dsh-session")).toBe(
      "@xrkseek/xrk-session",
    );
    expect(remapHostModuleId("@deepseek-ai/dsh-tools")).toBe(
      "@xrkseek/xrk-tools",
    );
    expect(remapHostModuleId("@deepseek-ai/dsh-settings")).toBe(
      "@xrkseek/xrk-settings",
    );
    expect(remapHostModuleId("@deepseek-ai/dsh-llm/call-config")).toBe(
      "@xrkseek/xrk-llm/call-config",
    );
  });

  it("remaps pi-ai subpaths and leaves client packages alone", () => {
    expect(
      remapHostModuleId("@earendil-works/pi-ai/api/openai-completions.lazy"),
    ).toBe("@xrkseek/xrk-pi-ai/api/openai-completions.lazy");
    expect(
      remapHostModuleId("@deepseek-ai/dsh-client-ui-primitives"),
    ).toBeUndefined();
    expect(remapHostModuleId("@xrkseek/xrk-llm")).toBeUndefined();
  });
});
