import { describe, expect, it } from "vitest";
import {
  GENUI_BROWSER_RUNTIME_JS,
  renderGenuiSchemaToHtml,
} from "../src/dsh-compat/genui-browser-runtime.js";

describe("genui browser runtime", () => {
  it("renders schema to HTML", () => {
    const html = renderGenuiSchemaToHtml({
      type: "card",
      title: "Hello",
      children: [{ type: "text", value: "world" }],
    });
    expect(html).toContain('data-xrk-genui-runtime="1"');
    expect(html).toContain("Hello");
    expect(html).toContain("world");
    expect(html).toContain('data-genui="card"');
  });

  it("ESM exports mount API surface", () => {
    expect(GENUI_BROWSER_RUNTIME_JS).toContain("export function mount");
    expect(GENUI_BROWSER_RUNTIME_JS).toContain("export function unmount");
    expect(GENUI_BROWSER_RUNTIME_JS).toContain("export function render");
    expect(GENUI_BROWSER_RUNTIME_JS).toContain("defineCustomElements");
    expect(GENUI_BROWSER_RUNTIME_JS).toContain("dsh-genui");
    expect(GENUI_BROWSER_RUNTIME_JS).toContain("__xrkGenuiRuntime__");
    expect(GENUI_BROWSER_RUNTIME_JS).not.toContain("honest stub");
  });
});
