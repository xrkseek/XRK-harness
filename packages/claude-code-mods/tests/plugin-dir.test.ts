// A plugin author ships a directory, not a `register` function. These tests use
// real directories (manifests on disk, `.mjs` hook modules, a native import) so
// the seam that turns `claude --plugin-dir`-style plugins into this bridge's
// mods is proven against the format rather than against a mock of it.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  definePluginDir,
  PluginDirError,
  readPluginDir,
  type ModOn,
} from "../src/index.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const dirOf = (name: string) => path.join(FIXTURES, name);

describe("plugin directory manifests", () => {
  it("reads identity and resolves hook modules next to hooks.json", async () => {
    const info = await readPluginDir(dirOf("token-weather"));
    expect(info.name).toBe("token-weather");
    expect(info.version).toBe("0.1.0");
    expect(info.modules).toEqual([path.join(info.root, "hooks", "token-weather.mjs")]);
  });

  it("treats a missing hooks.json as an identity-only plugin", async () => {
    const info = await readPluginDir(dirOf("identity-only"));
    expect(info.name).toBe("identity-only");
    expect(info.modules).toEqual([]);
  });

  it("refuses a hook module that escapes the plugin root", async () => {
    const error = await readPluginDir(dirOf("escaping")).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(PluginDirError);
    expect((error as Error).message).toMatch(/escapes the plugin root/u);
  });
});

describe("definePluginDir", () => {
  it("wraps the directory as a mountable mod plugin", async () => {
    const plugin = await definePluginDir(dirOf("token-weather"));
    expect(plugin.name).toBe("claude-code-mod-token-weather");
    expect(plugin.inject).toEqual(["claudeCodeMods"]);
    expect(plugin.definition).toMatchObject({
      name: "token-weather",
      version: "0.1.0",
      root: dirOf("token-weather"),
    });
  });

  it("runs every hook module in manifest order when register executes", async () => {
    const plugin = await definePluginDir(dirOf("token-weather"));
    const events: string[] = [];
    const on = ((event: string) => {
      events.push(event);
      return { catch() {} };
    }) as unknown as ModOn;

    await plugin.definition.register(on, {});
    // Fixture registers these five, including one this host never raises.
    expect(events).toEqual([
      "session.start",
      "prompt.submit",
      "turn.complete",
      "ui.render",
      "prompt.cancelled",
    ]);
  });

  it("refuses a hook module that exports no register", async () => {
    const plugin = await definePluginDir(dirOf("no-register"));
    const on = (() => ({ catch() {} })) as unknown as ModOn;
    await expect(plugin.definition.register(on, {})).rejects.toThrow(
      /exports no register/u,
    );
  });
});
