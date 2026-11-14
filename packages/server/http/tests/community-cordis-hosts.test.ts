import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@xrkseek/cordis";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createCommunityCordisHostSession } from "../src/dsh-compat/community-cordis-host-session.js";
import { provideCommunityAgentSurfaces } from "../src/dsh-compat/community-cordis-surfaces.js";
import { adaptXrkToolToCore } from "../src/dsh-compat/community-cordis-tool-adapt.js";
import { faceSettingsStoreFromWire } from "../src/dsh-compat/community-settings-store.js";
import {
  clearCommunityHostSurfaces,
  communityHostToolsFingerprint,
  listCommunityHostTools,
  publishCommunityHostSurfaces,
  syncCommunityHostToolsOnto,
} from "../src/dsh-compat/community-host-registry.js";
import { resetHostApplyRegistry } from "../src/dsh-compat/host-apply-registry.js";
import { resetLiveHostApply } from "../src/dsh-compat/live-host-apply.js";
import {
  hasNekowhaleHostLib,
  isNekowhaleStickersPackage,
  tryApplyNekowhaleHost,
} from "../src/dsh-compat/nekowhale-host.js";
import {
  hasWallpaperEngineHostLib,
  isWallpaperEnginePackage,
  tryApplyWallpaperEngineHost,
} from "../src/dsh-compat/wallpaper-host.js";
import {
  handleWallpaperHttp,
  isWallpaperHttpPath,
} from "../src/dsh-compat/wallpaper.js";

const temps: string[] = [];

afterEach(() => {
  resetLiveHostApply();
  resetHostApplyRegistry();
  clearCommunityHostSurfaces("dsh-nekowhale-stickers");
  clearCommunityHostSurfaces("dsh-plugin-wallpaper-engine");
  for (const d of temps.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("adaptXrkToolToCore", () => {
  it("maps defineTool-shaped execute + render into core-tools content", async () => {
    const core = adaptXrkToolToCore({
      name: "sticker_search",
      description: "Find stickers",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
      },
      output: {
        schema: { type: "object", properties: { text: { type: "string" } } },
        render: (_args, value) => [
          { type: "text", text: String((value as { text: string }).text) },
        ],
      },
      async execute(args) {
        return { text: `hit:${String((args as { query?: string }).query ?? "")}` };
      },
    } as never);
    expect(core.name).toBe("sticker_search");
    const out = await core.execute({ query: "摸鱼" });
    expect(out.isError).toBeFalsy();
    expect(out.content).toEqual([{ type: "text", text: "hit:摸鱼" }]);
  });
});

describe("wallpaper-host", () => {
  it("detects package + staged lib", () => {
    expect(isWallpaperEnginePackage("dsh-plugin-wallpaper-engine")).toBe(true);
    expect(isWallpaperEnginePackage("@x/dsh-plugin-wallpaper-engine")).toBe(
      true,
    );
    const root = mkdtempSync(path.join(tmpdir(), "we-lib-"));
    temps.push(root);
    expect(hasWallpaperEngineHostLib(root)).toBe(false);
    mkdirSync(path.join(root, "lib"), { recursive: true });
    writeFileSync(
      path.join(root, "lib", "index.js"),
      "export function apply() {}",
    );
    expect(hasWallpaperEngineHostLib(root)).toBe(true);
  });

  it("applies fake Cordis host and registers /wallpaper-engine routes", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "we-apply-"));
    temps.push(pkgRoot);
    mkdirSync(path.join(pkgRoot, "lib"), { recursive: true });
    writeFileSync(
      path.join(pkgRoot, "lib", "index.js"),
      `export const inject = ['webServer'];
export function apply(ctx) {
  ctx.webServer.register({
    kind: 'prefix',
    path: '/wallpaper-engine',
    methods: ['GET'],
    handler: async (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, live: true }));
    },
  });
}
`,
    );
    const contribution = await tryApplyWallpaperEngineHost(
      pkgRoot,
      "dsh-plugin-wallpaper-engine",
      {},
    );
    expect(contribution).toBeTruthy();
    expect(contribution!.http?.length).toBeGreaterThan(0);
    const row = contribution!.http!.find((r) =>
      r.match("/wallpaper-engine/inventory"),
    );
    expect(row).toBeTruthy();

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void row!.handle(req, res, "/wallpaper-engine/inventory");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    try {
      const res = await fetch(
        `http://127.0.0.1:${addr.port}/wallpaper-engine/inventory`,
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { live?: boolean };
      expect(json.live).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});

describe("nekowhale-host", () => {
  it("detects package + staged lib", () => {
    expect(isNekowhaleStickersPackage("dsh-nekowhale-stickers")).toBe(true);
    const root = mkdtempSync(path.join(tmpdir(), "nk-lib-"));
    temps.push(root);
    expect(hasNekowhaleHostLib(root)).toBe(false);
    mkdirSync(path.join(root, "lib"), { recursive: true });
    writeFileSync(
      path.join(root, "lib", "index.js"),
      "export function apply() {}",
    );
    expect(hasNekowhaleHostLib(root)).toBe(true);
  });

  it("applies fake Cordis host: pet config + tool registration", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "nk-apply-"));
    temps.push(pkgRoot);
    mkdirSync(path.join(pkgRoot, "lib"), { recursive: true });
    mkdirSync(path.join(pkgRoot, "skills", "nekowhale-stickers"), {
      recursive: true,
    });
    writeFileSync(
      path.join(pkgRoot, "skills", "nekowhale-stickers", "SKILL.md"),
      "---\nname: nekowhale-stickers\n---\nbody\n",
    );
    writeFileSync(
      path.join(pkgRoot, "lib", "index.js"),
      `export const inject = ['tools'];
export function apply(ctx) {
  const defineTool = (opts) => opts;
  ctx.tools.register(defineTool({
    name: 'sticker_search',
    description: 'search',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'object' },
      render: (_a, v) => [{ type: 'text', text: v.text }],
    },
    async execute() { return { text: 'ok' }; },
  }));
  ctx.inject(['webServer'], (wctx) => {
    wctx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: '__NEKOWHALE_PET__', value: { pet: true } });
    });
    wctx.webServer.register({
      kind: 'prefix',
      path: '/x-nekowhale-stickers',
      methods: ['GET'],
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        if (url.pathname.endsWith('/pet/config.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ pet: true, height: 211 }));
          return;
        }
        res.statusCode = 404;
        res.end();
      },
    });
  });
}
`,
    );

    const contribution = await tryApplyNekowhaleHost(
      pkgRoot,
      "dsh-nekowhale-stickers",
      {},
    );
    expect(contribution).toBeTruthy();
    expect(contribution!.meta.httpPrefixes).toContain("/x-nekowhale-stickers");

    const tools = listCommunityHostTools();
    expect(tools.some((t) => t.name === "sticker_search")).toBe(true);

    const row = contribution!.http!.find((r) =>
      r.match("/x-nekowhale-stickers/pet/config.json"),
    );
    expect(row).toBeTruthy();
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void row!.handle(req, res, "/x-nekowhale-stickers/pet/config.json");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    try {
      const res = await fetch(
        `http://127.0.0.1:${addr.port}/x-nekowhale-stickers/pet/config.json`,
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { pet?: boolean };
      expect(json.pet).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});

describe("community Cordis applyEntry Config defaults", () => {
  it("fills schemastery Config defaults before apply (nekowhale-style site)", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "cfg-apply-"));
    temps.push(pkgRoot);
    mkdirSync(path.join(pkgRoot, "lib"), { recursive: true });
    writeFileSync(
      path.join(pkgRoot, "lib", "index.js"),
      `// Mimic schemastery Config(seed) without importing the package from TEMP.
export const Config = (data = {}) => ({
  site: data.site ?? 'https://example.test',
  packs: data.packs ?? ['a'],
  ...data,
});
export function apply(ctx, config) {
  if (!config?.site) throw new Error('site missing after Config resolve');
  ctx.inject(['webServer'], (wctx) => {
    wctx.webServer.register({
      kind: 'prefix',
      path: '/cfg-probe',
      methods: ['GET'],
      handler: async (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ site: config.site, packs: config.packs }));
      },
    });
  });
}
`,
    );
    const session = createCommunityCordisHostSession({
      logPrefix: "cfg-probe",
      packageName: "cfg-probe",
    });
    session.provideHostSurfaces({});
    session.trackEffectsAndFibers();
    const ok = await session.applyEntry(path.join(pkgRoot, "lib", "index.js"), {
      // Intentionally omit site/packs — Config must fill them.
      autoSync: "off",
    });
    expect(ok).toBe(true);
    const row = session.http.find((r) => r.match("/cfg-probe"));
    expect(row).toBeTruthy();
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void row!.handle(req, res, "/cfg-probe");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/cfg-probe`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { site?: string; packs?: string[] };
      expect(json.site).toBe("https://example.test");
      expect(json.packs).toEqual(["a"]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});

describe("wallpaper baseline still works without live host", () => {
  it("serves inventory via bridge when no Cordis apply", async () => {
    expect(isWallpaperHttpPath("/wallpaper-engine/inventory")).toBe(true);
    const home = mkdtempSync(path.join(tmpdir(), "we-base-"));
    temps.push(home);
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void handleWallpaperHttp(req, res, "/wallpaper-engine/inventory", {
        xrkHome: home,
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    try {
      const res = await fetch(
        `http://127.0.0.1:${addr.port}/wallpaper-engine/inventory`,
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        ok?: boolean;
        weAssetsAvailable?: boolean;
      };
      expect(json.ok).toBe(true);
      expect(json.weAssetsAvailable).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});

describe("community-host-registry", () => {
  it("publishes and clears package surfaces", () => {
    publishCommunityHostSurfaces("dsh-nekowhale-stickers", {
      tools: [
        {
          name: "sticker_send",
          description: "send",
          parameters: {},
          async execute() {
            return { content: "ok" };
          },
        },
      ],
      skillDirs: ["/tmp/skills"],
      promptSections: [],
      indexGlobals: [{ name: "__NEKOWHALE_PET__", value: { pet: true } }],
    });
    expect(listCommunityHostTools().map((t) => t.name)).toContain(
      "sticker_send",
    );
    clearCommunityHostSurfaces("dsh-nekowhale-stickers");
    expect(listCommunityHostTools().map((t) => t.name)).not.toContain(
      "sticker_send",
    );
  });

  it("syncCommunityHostToolsOnto drops tracked tools when live set shrinks", () => {
    publishCommunityHostSurfaces("dsh-nekowhale-stickers", {
      tools: [
        {
          name: "meme_render",
          description: "meme",
          parameters: {},
          async execute() {
            return { content: "a" };
          },
        },
        {
          name: "sticker_search",
          description: "search",
          parameters: {},
          async execute() {
            return { content: "b" };
          },
        },
      ],
      skillDirs: [],
      promptSections: [],
      indexGlobals: [],
    });
    const reg = createToolRegistry();
    const tracked = new Set<string>();
    syncCommunityHostToolsOnto(reg, tracked);
    expect([...tracked].sort()).toEqual(["meme_render", "sticker_search"]);
    expect(communityHostToolsFingerprint()).toContain("meme_render");

    publishCommunityHostSurfaces("dsh-nekowhale-stickers", {
      tools: [
        {
          name: "sticker_search",
          description: "search",
          parameters: {},
          async execute() {
            return { content: "b" };
          },
        },
      ],
      skillDirs: [],
      promptSections: [],
      indexGlobals: [],
    });
    syncCommunityHostToolsOnto(reg, tracked);
    expect([...tracked]).toEqual(["sticker_search"]);
    expect(reg.get("meme_render")).toBeUndefined();
    expect(reg.get("sticker_search")).toBeTruthy();
    clearCommunityHostSurfaces("dsh-nekowhale-stickers");
  });
});

describe("community fiber cleanup", () => {
  it("drops tools when the registering child fiber disposes", async () => {
    const root = new Context();
    const { tools } = provideCommunityAgentSurfaces(root);
    const fiber = root.plugin((ctx) => {
      (ctx as { tools: typeof tools }).tools.register({
        name: "meme_render",
        description: "drop-me",
        parameters: { type: "object", properties: {} },
        async execute() {
          return { text: "x" };
        },
      } as never);
    });
    await fiber.await();
    expect(tools.list().some((t) => t.name === "meme_render")).toBe(true);
    const first = tools.toCoreTools();
    const second = tools.toCoreTools();
    expect(second).toBe(first);
    await fiber.dispose();
    expect(tools.list().some((t) => t.name === "meme_render")).toBe(false);
  });

  it("drops harvested skill dirs when the provider fiber disposes", async () => {
    const root = new Context();
    const { skills } = provideCommunityAgentSurfaces(root);
    skills.addSkillDir("/manual/skill");
    const fiber = root.plugin((ctx) => {
      (ctx as { skills: typeof skills }).skills.registerProvider({
        resourceBase: { path: "/provider/skill" },
      });
    });
    await fiber.await();
    expect(skills.skillDirs()).toEqual(
      expect.arrayContaining(["/manual/skill", "/provider/skill"]),
    );
    await fiber.dispose();
    expect(skills.skillDirs()).toEqual(["/manual/skill"]);
  });

  it("drops HTTP routes and rpc channels when the fiber disposes", async () => {
    const session = createCommunityCordisHostSession({
      logPrefix: "fiber-http",
      packageName: "dsh-test-fiber",
    });
    session.provideHostSurfaces({ agentSurfaces: true });
    session.trackEffectsAndFibers();
    const fiber = session.root.plugin((ctx) => {
      const c = ctx as {
        webServer: {
          register: (route: {
            kind: "prefix";
            path: string;
            methods: string[];
            handler: (
              req: IncomingMessage,
              res: ServerResponse,
            ) => void | Promise<void>;
          }) => () => void;
        };
        rpc: {
          register: (
            channel: string,
            handler: () => Promise<{ ok: boolean }>,
          ) => () => void;
        };
      };
      c.webServer.register({
        kind: "prefix",
        path: "/x-test-fiber",
        methods: ["GET"],
        handler: async (_req, res) => {
          res.writeHead(200);
          res.end("ok");
        },
      });
      c.rpc.register("x-test/ping", async () => ({ ok: true }));
    });
    await fiber.await();
    expect(session.http.some((r) => r.match("/x-test-fiber/a"))).toBe(true);
    expect(session.rpc["x-test/ping"]).toBeTruthy();
    await fiber.dispose();
    expect(session.http.some((r) => r.match("/x-test-fiber/a"))).toBe(false);
    expect(session.rpc["x-test/ping"]).toBeUndefined();
    await session.root.fiber.dispose();
  });

  it("rejects double provideHostSurfaces / trackEffectsAndFibers", () => {
    const session = createCommunityCordisHostSession({
      logPrefix: "once",
      packageName: "dsh-test-once",
    });
    session.provideHostSurfaces({ agentSurfaces: true });
    expect(() => session.provideHostSurfaces({ agentSurfaces: true })).toThrow(
      /twice/,
    );
    session.trackEffectsAndFibers();
    expect(() => session.trackEffectsAndFibers()).toThrow(/twice/);
  });
});

describe("faceSettingsStoreFromWire", () => {
  it("wraps ensureCommunitySettingsNamespace", () => {
    const mem = new Map<string, Record<string, unknown>>();
    const store = faceSettingsStoreFromWire({
      ensureCommunitySettingsNamespace(namespace, defaults) {
        if (!mem.has(namespace)) mem.set(namespace, { ...defaults });
        return {
          get: () => ({ ...(mem.get(namespace) ?? {}) }),
          set(patch) {
            mem.set(namespace, { ...(mem.get(namespace) ?? {}), ...patch });
          },
        };
      },
    });
    expect(store).toBeTruthy();
    const slot = store!.ensure("nekowhale-stickers", { pet: true });
    expect(slot.get().pet).toBe(true);
    slot.set({ pet: false });
    expect(slot.get().pet).toBe(false);
  });
});

describe("nekowhale LIVE watch", () => {
  it("watchCommunitySettingsNamespace fires after apply and keeps tools published", async () => {
    const pkgRoot = mkdtempSync(path.join(tmpdir(), "nk-watch-"));
    temps.push(pkgRoot);
    mkdirSync(path.join(pkgRoot, "lib"), { recursive: true });
    writeFileSync(
      path.join(pkgRoot, "lib", "index.js"),
      `export function apply(ctx) {
  ctx.tools.register({
    name: 'sticker_search',
    description: 'search',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: v.text }] },
    async execute() { return { text: 'ok' }; },
  });
}
`,
    );
    let watchNs = "";
    let fireWatch: (() => void) | undefined;
    const contribution = await tryApplyNekowhaleHost(
      pkgRoot,
      "dsh-nekowhale-stickers",
      {
        watchCommunitySettingsNamespace(namespace, onChange) {
          watchNs = namespace;
          fireWatch = onChange;
          return () => {
            fireWatch = undefined;
          };
        },
      },
    );
    expect(contribution).toBeTruthy();
    expect(watchNs).toBe("nekowhale-stickers");
    expect(listCommunityHostTools().some((t) => t.name === "sticker_search")).toBe(
      true,
    );
    fireWatch?.();
    await new Promise((r) => setTimeout(r, 120));
    expect(listCommunityHostTools().some((t) => t.name === "sticker_search")).toBe(
      true,
    );
  });
});

describe("publishCommunityHostSurfaces dedupe", () => {
  it("keeps the previous snapshot when refs are unchanged", () => {
    const tool = {
      name: "sticker_search",
      description: "s",
      parameters: {},
      async execute() {
        return { content: "ok" };
      },
    };
    publishCommunityHostSurfaces("dsh-nekowhale-stickers", {
      tools: [tool],
      skillDirs: ["/s"],
      promptSections: [],
      indexGlobals: [],
    });
    const before = listCommunityHostTools()[0];
    publishCommunityHostSurfaces("dsh-nekowhale-stickers", {
      tools: [tool],
      skillDirs: ["/s"],
      promptSections: [],
      indexGlobals: [],
    });
    expect(listCommunityHostTools()[0]).toBe(before);
    clearCommunityHostSurfaces("dsh-nekowhale-stickers");
  });
});
