import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPluginLoader,
  applyToolsPlugins,
  scanPluginDir,
} from "../src/index.js";
import { createToolRegistry } from "@xrkseek/core-tools";

async function writePlugin(
  root: string,
  name: string,
  opts: { id: string; kind: string; body?: string },
): Promise<string> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "xrk.plugin.json"),
    JSON.stringify({
      id: opts.id,
      kind: opts.kind,
      entry: "./plugin.mjs",
    }),
    "utf8",
  );
  const entry = path.join(dir, "plugin.mjs");
  await writeFile(
    entry,
    opts.body ??
      `export function createPlugin() {
  return { id: ${JSON.stringify(opts.id)}, kind: ${JSON.stringify(opts.kind)} };
}
`,
    "utf8",
  );
  return dir;
}

describe("plugin discover", () => {
  it("scans child dirs with xrk.plugin.json", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-plg-"));
    await writePlugin(root, "a", { id: "plug-a", kind: "tools" });
    await writePlugin(root, "b", { id: "plug-b", kind: "channel" });
    await mkdir(path.join(root, "noise"), { recursive: true });

    const hits = await scanPluginDir(root);
    expect(hits.map((h) => h.manifest.id)).toEqual(["plug-a", "plug-b"]);
    expect(hits[0]?.entry.endsWith("plugin.mjs")).toBe(true);
  });

  it("discovers package.json#xrkseek.plugin", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-pkg-"));
    const dir = path.join(root, "pkg-plugin");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "pkg-plugin",
        xrkseek: {
          plugin: { id: "from-pkg", kind: "tools", entry: "./entry.mjs" },
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(dir, "entry.mjs"),
      `export const plugin = { id: "from-pkg", kind: "tools" };
`,
      "utf8",
    );

    const hits = await scanPluginDir(root);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.manifest.id).toBe("from-pkg");
  });

  it("loadAll registers modules", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-load-"));
    await writePlugin(root, "ex", { id: "example", kind: "tools" });
    const loader = createPluginLoader();
    const ids = await loader.loadAll(root);
    expect(ids).toEqual(["example"]);
    expect(loader.list().map((p) => p.id)).toEqual(["example"]);

    // second loadAll skips already registered
    expect(await loader.loadAll(root)).toEqual([]);
  });

  it("load rejects id mismatch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-mis-"));
    await writePlugin(root, "bad", {
      id: "declared",
      kind: "tools",
      body: `export function createPlugin() {
  return { id: "other", kind: "tools" };
}
`,
    });
    const loader = createPluginLoader();
    const [hit] = await loader.discover(root);
    await expect(loader.load(hit!)).rejects.toThrow(/id mismatch/);
  });

  it("loadAll on loader fixture example-tools", async () => {
    const extRoot = path.resolve(import.meta.dirname, "../../../../extensions");
    const loader = createPluginLoader();
    const ids = await loader.loadAll(extRoot);
    expect(ids).toContain("example-tools");
    expect(loader.list().some((p) => p.id === "example-tools")).toBe(true);
  });

  it("unregister runs dispose", async () => {
    const loader = createPluginLoader();
    let disposed = false;
    loader.register({
      id: "x",
      kind: "tools",
      dispose: () => {
        disposed = true;
      },
    });
    await loader.unregister("x");
    expect(disposed).toBe(true);
    expect(loader.list()).toEqual([]);
  });

  it("loads tools contributions and applyToolsPlugins skips clashes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-tools-"));
    await writePlugin(root, "ping", {
      id: "ping-plug",
      kind: "tools",
      body: `export function createPlugin() {
  return {
    id: "ping-plug",
    kind: "tools",
    tools: [{
      name: "plug_ping",
      description: "ping",
      parameters: { type: "object", properties: {} },
      async execute() { return { content: "pong" }; },
    }, {
      name: "read_file",
      description: "should skip",
      parameters: { type: "object", properties: {} },
      async execute() { return { content: "nope" }; },
    }],
  };
}
`,
    });
    const loader = createPluginLoader();
    await loader.loadAll(root);
    const plug = loader.list()[0]!;
    expect(plug.tools?.map((t) => t.name)).toEqual([
      "plug_ping",
      "read_file",
    ]);

    const registry = createToolRegistry();
    registry.register({
      name: "read_file",
      description: "builtin",
      parameters: { type: "object" },
      async execute() {
        return { content: "builtin" };
      },
    });
    const result = applyToolsPlugins(registry, loader.list());
    expect(result.applied).toEqual([
      { pluginId: "ping-plug", toolName: "plug_ping" },
    ]);
    expect(result.skipped).toEqual([
      {
        pluginId: "ping-plug",
        toolName: "read_file",
        reason: "explicit_wins",
      },
    ]);
    expect(registry.get("plug_ping")).toBeTruthy();
    expect(await registry.get("read_file")!.execute({})).toEqual({
      content: "builtin",
    });
  });

  it("example-tools contributes example_ping", async () => {
    const extRoot = path.resolve(
      import.meta.dirname,
      "../../../../extensions",
    );
    const loader = createPluginLoader();
    await loader.loadAll(extRoot);
    const ex = loader.list().find((p) => p.id === "example-tools");
    expect(ex?.tools?.some((t) => t.name === "example_ping")).toBe(true);
    const out = await ex!.tools!.find((t) => t.name === "example_ping")!.execute(
      {},
    );
    expect(out.content).toBe("pong");
  });
});

describe("prompt plugins", () => {
  it("applies kind:prompt sections; base id wins", async () => {
    const { createSystemPromptAssembler } = await import(
      "@xrkseek/core-system-prompt"
    );
    const { applyPromptPlugins, PLUGIN_KINDS } = await import("../src/index.js");

    const assembler = createSystemPromptAssembler();
    assembler.register({
      id: "base",
      order: 0,
      content: () => "BASE",
    });

    const result = applyPromptPlugins(
      assembler,
      [
        {
          id: "hint-plug",
          kind: PLUGIN_KINDS.prompt,
          promptSections: [
            {
              id: "base",
              order: 1,
              content: "SHOULD_SKIP",
            },
            {
              id: "plugin.hint",
              order: 10,
              content: "HINT",
            },
          ],
        },
      ],
      { reservedIds: new Set(["base"]) },
    );

    expect(result.applied).toEqual([
      { pluginId: "hint-plug", sectionId: "plugin.hint" },
    ]);
    expect(result.skipped).toEqual([
      {
        pluginId: "hint-plug",
        sectionId: "base",
        reason: "explicit_wins",
      },
    ]);
    expect(await assembler.assemble()).toBe("BASE\n\nHINT");
  });
});

describe("manifest aliases + cordis stub", () => {
  it("discovers package.json#dsh.plugin", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-dsh-"));
    const dir = path.join(root, "dsh-plug");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "dsh-plug",
        dsh: {
          plugin: { id: "dsh-alias", kind: "tools", entry: "./entry.mjs" },
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(dir, "entry.mjs"),
      `export const plugin = { id: "dsh-alias", kind: "tools" };
`,
      "utf8",
    );
    const hits = await scanPluginDir(root);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.manifest).toMatchObject({
      id: "dsh-alias",
      kind: "tools",
    });
  });

  it("discovers dotted deepseek.plugin and scoped packages", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-scope-"));
    const dir = path.join(root, "@acme", "hello");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "@acme/hello",
        "deepseek.plugin": {
          id: "acme-hello",
          kind: "tools",
          entry: "./entry.mjs",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(dir, "entry.mjs"),
      `export const plugin = { id: "acme-hello", kind: "tools" };
`,
      "utf8",
    );
    const hits = await scanPluginDir(root);
    expect(hits.map((h) => h.manifest.id)).toEqual(["acme-hello"]);
  });

  it("registers Cordis host packages as skipLoad stubs (never imports)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-cordis-"));
    const dir = path.join(root, "community-cordis");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "community-cordis",
        peerDependencies: { "@xrkseek/cordis": "*" },
        main: "./boom.mjs",
      }),
      "utf8",
    );
    await writeFile(
      path.join(dir, "boom.mjs"),
      `throw new Error("must not import Cordis apply()");
export function apply() {}
`,
      "utf8",
    );
    const loader = createPluginLoader();
    const ids = await loader.loadAll(root);
    expect(ids).toEqual(["community-cordis"]);
    const plug = loader.list()[0]!;
    expect(plug).toEqual({ id: "community-cordis", kind: "cordis" });
  });

  it("skips web/ overlay when scanning process plugins", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-webskip-"));
    await writePlugin(root, "ok", { id: "ok-tools", kind: "tools" });
    const web = path.join(root, "web", "extra");
    await mkdir(web, { recursive: true });
    await writeFile(
      path.join(web, "xrk.plugin.json"),
      JSON.stringify({
        id: "should-skip",
        kind: "tools",
        entry: "./plugin.mjs",
      }),
      "utf8",
    );
    const hits = await scanPluginDir(root);
    expect(hits.map((h) => h.manifest.id)).toEqual(["ok-tools"]);
  });
});

describe("commands plugins + inventory", () => {
  it("loads kind:commands and collectPluginCommands first-name-wins", async () => {
    const { collectPluginCommands, PLUGIN_KINDS } = await import(
      "../src/index.js"
    );
    const root = await mkdtemp(path.join(tmpdir(), "xrk-cmd-"));
    await writePlugin(root, "slash", {
      id: "slash-plug",
      kind: PLUGIN_KINDS.commands,
      body: `export function createPlugin() {
  return {
    id: "slash-plug",
    kind: "commands",
    commands: [{
      name: "ping",
      description: "pong",
      input: { hint: "text" },
      async handler({ rawInput }) {
        return { kind: "success", text: "pong:" + rawInput.trim() };
      },
    }],
  };
}
`,
    });
    const loader = createPluginLoader();
    await loader.loadAll(root);
    const commands = collectPluginCommands(loader.list());
    expect(commands.map((c) => c.name)).toEqual(["ping"]);
    const out = await commands[0]!.handler({
      sessionId: "s",
      rawInput: " hi",
      commandId: "c1",
    });
    expect(out).toEqual({ kind: "success", text: "pong:hi" });
  });

  it("toPluginInventoryEntries marks cordis failed", async () => {
    const { toPluginInventoryEntries } = await import("../src/index.js");
    expect(
      toPluginInventoryEntries([
        { id: "example-tools", kind: "tools" },
        { id: "dsh-host", kind: "cordis" },
      ]),
    ).toEqual([
      {
        entryId: "example-tools",
        moduleName: "example-tools",
        enabled: true,
        fiberPhase: "active",
      },
      {
        entryId: "dsh-host",
        moduleName: "dsh-host",
        enabled: false,
        fiberPhase: "failed",
      },
    ]);
  });
});

describe("host plugins", () => {
  it("loads kind:host with createPublicHandler", async () => {
    const { listHostPlugins, PLUGIN_KINDS } = await import("../src/index.js");
    const root = await mkdtemp(path.join(tmpdir(), "xrk-host-"));
    await writePlugin(root, "http-plug", {
      id: "http-plug",
      kind: PLUGIN_KINDS.host,
      body: `export function createPlugin() {
  return {
    id: "http-plug",
    kind: "host",
    createPublicHandler() {
      return async (req, res) => {
        if (req.url === "/host-plug/ping") {
          res.statusCode = 200;
          res.end("pong");
          return true;
        }
        return false;
      };
    },
  };
}
`,
    });
    const loader = createPluginLoader();
    await loader.loadAll(root);
    const hostPlugins = listHostPlugins(loader.list());
    expect(hostPlugins.map((p) => p.id)).toEqual(["http-plug"]);
    const handler = hostPlugins[0]!.createPublicHandler!({});
    const chunks: Buffer[] = [];
    const res = {
      statusCode: 0,
      end(body: string) {
        chunks.push(Buffer.from(body));
      },
    };
    await handler(
      { url: "/host-plug/ping" } as import("node:http").IncomingMessage,
      res as import("node:http").ServerResponse,
    );
    expect(res.statusCode).toBe(200);
    expect(Buffer.concat(chunks).toString("utf8")).toBe("pong");
  });
});

