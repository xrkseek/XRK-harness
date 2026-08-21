import { describe, expect, it } from "vitest";
import {
  remapInjectId,
  remapInjectList,
} from "../src/plugin/remap-inject.js";
import { anchorPathSpec } from "../src/plugin/fetch-pack.js";
import path from "node:path";

describe("remapInject", () => {
  it("maps known DSH client ids", () => {
    expect(remapInjectId("@deepseek-ai/dsh-client-runtime")).toBe(
      "@xrkseek/client-runtime",
    );
    expect(remapInjectId("@deepseek-ai/dsh-client-ui-conversation")).toBe(
      "@xrkseek/client-ui-conversation",
    );
    expect(remapInjectId("@xrkseek/client-locale")).toBe(
      "@xrkseek/client-locale",
    );
  });

  it("drops unknown @deepseek-ai packages", () => {
    expect(remapInjectId("@deepseek-ai/dsh-unknown-thing")).toBeUndefined();
    const { inject, dropped } = remapInjectList([
      "@deepseek-ai/dsh-client-runtime",
      "@deepseek-ai/mystery",
      "@xrkseek/client-locale",
      "@deepseek-ai/dsh-client-runtime",
    ]);
    expect(inject).toEqual([
      "@xrkseek/client-runtime",
      "@xrkseek/client-locale",
    ]);
    expect(dropped).toEqual(["@deepseek-ai/mystery"]);
  });
});

describe("anchorPathSpec", () => {
  it("anchors relative file/link specs to cwd", () => {
    const cwd = path.resolve("/tmp/work");
    expect(anchorPathSpec(".", cwd)).toBe(cwd);
    expect(anchorPathSpec("file:./plugin", cwd)).toBe(
      `file:${path.resolve(cwd, "plugin")}`,
    );
    expect(anchorPathSpec("@scope/pkg", cwd)).toBe("@scope/pkg");
  });
});
