import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  chainPublicHandlers,
  createDshCompatPublicHandler,
  createXrkPluginPublicHandler,
} from "../src/index.js";
import { readXrkPluginInventory } from "../src/xrk/plugin-services.js";

const temps: string[] = [];
const FIXTURE_SUITE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "compat-host-suite.json",
);

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

type SuiteRow = {
  readonly version: string;
  readonly kind: string;
  readonly host?: unknown;
};

/** Seed installed plugins; write `xrk.host.json` only when `writeHostManifest: true`. */
function seedCompatHostSuite(
  pluginsDir: string,
  only?: readonly string[],
  options: { writeHostManifest?: boolean; clientJs?: string } = {},
): void {
  const writeHost = options.writeHostManifest === true;
  const clientBody = options.clientJs ?? "// test client\n";
  const suite = JSON.parse(readFileSync(FIXTURE_SUITE, "utf8")) as {
    packages: Record<string, SuiteRow>;
  };
  const packages: Record<string, unknown> = {};
  for (const [name, row] of Object.entries(suite.packages)) {
    if (only && !only.includes(name)) continue;
    packages[name] = { name, version: row.version, kind: row.kind };
    const pkgRoot = path.join(
      pluginsDir,
      "web",
      "plugins",
      ...name.split("/"),
    );
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(path.join(pkgRoot, "client.js"), clientBody);
    if (row.host && writeHost) {
      writeFileSync(
        path.join(pkgRoot, "xrk.host.json"),
        JSON.stringify(row.host),
      );
    }
  }
  writeFileSync(
    path.join(pluginsDir, ".xrk-plugins.json"),
    JSON.stringify({ rev: 1, packages }),
  );
}

function compatPlugins(
  only?: readonly string[],
  options?: { writeHostManifest?: boolean },
): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xrk-dsh-compat-"));
  temps.push(dir);
  seedCompatHostSuite(dir, only, options);
  return dir;
}

function tempPlugins(): string {
  return compatPlugins(["dshmarket", "@xrkseek/dsh-compat"]);
}

function compatHandler(
  options: Parameters<typeof createDshCompatPublicHandler>[0] = {},
): ReturnType<typeof createDshCompatPublicHandler> {
  const pluginsDir =
    options.pluginsDir ?? compatPlugins();
  return createDshCompatPublicHandler({ ...options, pluginsDir });
}

async function withPublicHandler(
  handler: ReturnType<typeof createDshCompatPublicHandler>,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer((req, res) => {
    void (async () => {
      const claimed = await handler(req, res);
      if (!claimed) {
        res.writeHead(404);
        res.end("no");
      }
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("no addr");
  }
  try {
    await run(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe("xrk plugin inventory (底层)", () => {
  it("reads CLI inventory json", () => {
    const pluginsDir = compatPlugins(["dshmarket"]);
    const inv = readXrkPluginInventory({ pluginsDir });
    expect(inv.present).toEqual(["dshmarket"]);
    expect(inv.installedMap.dshmarket?.version).toBe("1.0.0");
  });
});

describe("dsh-compat adapters", () => {
  it("maps /dsh-market/installed onto XRK inventory", async () => {
    const pluginsDir = tempPlugins();
    const handler = chainPublicHandlers(
      createXrkPluginPublicHandler({ pluginsDir }),
      createDshCompatPublicHandler({ pluginsDir }),
    );
    await withPublicHandler(handler, async (base) => {
      const xrk = await fetch(`${base}/xrk/plugins/inventory`);
      expect(xrk.status).toBe(200);
      const xrkBody = (await xrk.json()) as { present: string[] };
      expect(xrkBody.present).toContain("dshmarket");

      const dsh = await fetch(`${base}/dsh-market/installed`);
      expect(dsh.status).toBe(200);
      const dshBody = (await dsh.json()) as {
        present: string[];
        via?: string;
        installed: Record<string, { version?: string }>;
      };
      expect(dshBody.present).toContain("dshmarket");
      expect(dshBody.installed.dshmarket?.version).toBe("1.0.0");
      expect(dshBody.via).toBe("/xrk/plugins/inventory");
    });
  });

  it("answers mnemon settings get as scope snapshot", async () => {
    const handler = compatHandler();
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/dsh-mnemon-settings/get`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "t1",
          method: "get",
          payload: { namespace: "mnemon" },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        rpcId: string;
        result: {
          ok: boolean;
          value: { status?: string; writable?: boolean; value?: object };
        };
      };
      expect(body.rpcId).toBe("t1");
      expect(body.result.ok).toBe(true);
      expect(body.result.value.status).toBe("ready");
      expect(body.result.value.writable).toBe(true);
      expect(body.result.value.value).toBeTypeOf("object");
    });
  });

  it("returns JSON for vision toolkit settings (not SPA html)", async () => {
    const handler = compatHandler();
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/_dsh/vision-toolkit/settings`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok?: boolean;
        value: { adapter?: string };
      };
      expect(body.ok).toBe(true);
      expect(body.value.adapter).toBe("xrk-dsh-compat");

      const display = await fetch(`${base}/_dsh/vision-toolkit/display-config`);
      const dBody = (await display.json()) as {
        ok?: boolean;
        value: { hidden?: boolean };
      };
      expect(dBody.ok).toBe(true);
      expect(dBody.value.hidden).toBe(false);
    });
  });

  it("serves installed sidebar chunk file over stub", async () => {
    const root = tempPlugins();
    const chunks = path.join(
      root,
      "web",
      "plugins",
      "dsh-better-sidebar",
      "chunks",
    );
    mkdirSync(chunks, { recursive: true });
    writeFileSync(
      path.join(chunks, "terminal.js"),
      `globalThis.__dshChunks__=globalThis.__dshChunks__||{};globalThis.__dshChunks__["terminal"]=()=>({TerminalView:1});\n`,
    );
    seedCompatHostSuite(root, ["dsh-better-sidebar"]);
    const handler = compatHandler({ pluginsDir: root });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/sidebar/bundle/terminal.js`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('__dshChunks__["terminal"]');
      expect(text).not.toContain("Host incomplete");
    });
  });

  it("serves sidebar chunk stub that registers __dshChunks__", async () => {
    const handler = compatHandler();
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/sidebar/bundle/terminal.js`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("__dshChunks__");
      expect(text).toContain("terminal");
      expect(text).toContain("TerminalView");
    });
  });

  it("serves HTML preview via /sidebar/html/ with MIME", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-sidebar-html-"));
    temps.push(root);
    const htmlPath = path.join(root, "www", "index.html");
    mkdirSync(path.dirname(htmlPath), { recursive: true });
    writeFileSync(htmlPath, "<html><body>ok</body></html>");
    writeFileSync(path.join(root, "www", "app.css"), "body{color:red}");
    const handler = compatHandler({
      defaultCwd: root,
      resolveSessionCwd: () => root,
    });
    await withPublicHandler(handler, async (base) => {
      const segs = htmlPath
        .split(/[\\/]+/)
        .filter((s) => s !== "")
        .map(encodeURIComponent)
        .join("/");
      const res = await fetch(`${base}/sidebar/html/s1/${segs}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      expect(await res.text()).toContain("<body>ok</body>");

      const cssSegs = path
        .join(root, "www", "app.css")
        .split(/[\\/]+/)
        .filter((s) => s !== "")
        .map(encodeURIComponent)
        .join("/");
      const css = await fetch(`${base}/sidebar/html/s1/${cssSegs}`);
      expect(css.status).toBe(200);
      expect(css.headers.get("content-type")).toMatch(/text\/css/);
    });
  });

  it("lists workspace via /sidebar/api/fs.tree", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-sidebar-"));
    temps.push(root);
    writeFileSync(path.join(root, "hello.txt"), "hi");
    const handler = compatHandler({
      defaultCwd: root,
      resolveSessionCwd: () => root,
    });
    await withPublicHandler(handler, async (base) => {
      const treeRes = await fetch(`${base}/sidebar/api/fs.tree`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s1", path: root }),
      });
      const treeBody = (await treeRes.json()) as {
        ok: boolean;
        value: { entries: Array<{ name: string }> };
      };
      expect(treeBody.ok).toBe(true);
      expect(treeBody.value.entries.some((e) => e.name === "hello.txt")).toBe(
        true,
      );

      const readRes = await fetch(`${base}/sidebar/api/fs.read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "s1",
          path: path.join(root, "hello.txt"),
        }),
      });
      const readBody = (await readRes.json()) as {
        ok: boolean;
        value: { kind?: string; content?: string };
      };
      expect(readBody.ok).toBe(true);
      expect(readBody.value.kind).toBe("text");
      expect(readBody.value.content).toBe("hi");
    });
  });

  it("searches workspace via /sidebar/api/fs.search", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-sidebar-search-"));
    temps.push(root);
    writeFileSync(path.join(root, "needle.txt"), "x");
    const handler = compatHandler({
      defaultCwd: root,
      resolveSessionCwd: () => root,
    });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/sidebar/api/fs.search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s1", path: root, query: "needle" }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        value: { matches: string[] };
      };
      expect(body.ok).toBe(true);
      expect(body.value.matches.some((m) => m.endsWith("needle.txt"))).toBe(
        true,
      );
    });
  });

  it("uploads via /sidebar/upload octet-stream query body", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-sidebar-upload-"));
    temps.push(root);
    const handler = compatHandler({
      defaultCwd: root,
      resolveSessionCwd: () => root,
    });
    await withPublicHandler(handler, async (base) => {
      const params = new URLSearchParams({
        sessionId: "s1",
        dir: ".",
        relativePath: "stream-upload.bin",
      });
      const res = await fetch(`${base}/sidebar/upload?${params}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array([1, 2, 3, 4]),
      });
      const body = (await res.json()) as {
        ok: boolean;
        value: { uploaded: boolean; path: string };
      };
      expect(body.ok).toBe(true);
      expect(body.value.uploaded).toBe(true);
      expect(readFileSync(path.join(root, "stream-upload.bin")).byteLength).toBe(
        4,
      );
    });
  });

  it("uploads via /sidebar/upload JSON body (compat)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-sidebar-upload-"));
    temps.push(root);
    const handler = compatHandler({
      defaultCwd: root,
      resolveSessionCwd: () => root,
    });
    await withPublicHandler(handler, async (base) => {
      const target = path.join(root, "uploaded.txt");
      const res = await fetch(`${base}/sidebar/upload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "s1",
          path: "uploaded.txt",
          content: "from-upload",
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        value: { uploaded: boolean; path: string };
      };
      expect(body.ok).toBe(true);
      expect(body.value.uploaded).toBe(true);
      expect(readFileSync(target, "utf8")).toBe("from-upload");
    });
  });

  it("accepts dsh-market install as deferred CLI handoff", async () => {
    const handler = compatHandler();
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/dsh-market/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "install", spec: "dsh-poison-guard" }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        accepted: boolean;
        deferred: boolean;
        cli?: string;
      };
      expect(body.ok).toBe(true);
      expect(body.accepted).toBe(true);
      expect(body.deferred).toBe(true);
      expect(body.cli).toContain("plugin add");
      expect(body.cli).toContain("dsh-poison-guard");
    });
  });

  it("persists mnemon documents via write RPC", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-mnemon-doc-"));
    temps.push(root);
    const pluginsDir = compatPlugins(["dsh-mnemon"]);
    const handler = createDshCompatPublicHandler({
      pluginsDir,
      xrkHome: path.join(root, "home"),
    });
    await withPublicHandler(handler, async (base) => {
      const write = await fetch(`${base}/dsh-mnemon-write/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "w1",
          method: "save",
          payload: { title: "note", body: "hello mnemon" },
        }),
      });
      expect(write.status).toBe(200);
      const list = await fetch(`${base}/dsh-mnemon-read/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "r1",
          method: "documents",
          payload: {},
        }),
      });
      const listBody = (await list.json()) as {
        result: { ok: boolean; value: Array<{ title: string }> };
      };
      expect(listBody.result.ok).toBe(true);
      expect(Array.isArray(listBody.result.value)).toBe(true);
      expect(listBody.result.value[0]?.title).toBe("note");
    });
  });

  it("mnemon write provider-services returns catalog with providers[]", async () => {
    const pluginsDir = compatPlugins(["dsh-mnemon"]);
    const handler = createDshCompatPublicHandler({ pluginsDir });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/dsh-mnemon-write/provider-services`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "ps1",
          method: "provider-services",
          payload: {},
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: {
          ok: boolean;
          value: {
            providers: Array<{ id: string }>;
            items: Array<{ providerId: string }>;
            generatedAt: string;
          };
        };
      };
      expect(body.result.ok).toBe(true);
      expect(Array.isArray(body.result.value.providers)).toBe(true);
      expect(body.result.value.providers[0]?.id).toBe("mnemon-native");
      expect(Array.isArray(body.result.value.items)).toBe(true);
      expect(body.result.value.generatedAt.length).toBeGreaterThan(0);
    });
  });

  it("mnemon task-agent-models always includes groups[]", async () => {
    const pluginsDir = compatPlugins(["dsh-mnemon"]);
    const handler = createDshCompatPublicHandler({ pluginsDir });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/dsh-mnemon-read/task-agent-models`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "tam1",
          method: "task-agent-models",
          payload: {},
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: {
          ok: boolean;
          value: { groups: unknown[]; models: unknown[] };
        };
      };
      expect(body.result.ok).toBe(true);
      expect(Array.isArray(body.result.value.groups)).toBe(true);
      expect(Array.isArray(body.result.value.models)).toBe(true);
      // JSON null breaks dsh-mnemon TaskAgentModelSection (`effective === void 0` only).
      expect(
        Object.prototype.hasOwnProperty.call(body.result.value, "effective"),
      ).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(
          body.result.value,
          "defaultSelection",
        ),
      ).toBe(false);
    });
  });

  it(
    "installs local plugin via market when CLI is available",
    async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-market-install-"));
    temps.push(root);
    const pkgRoot = path.join(root, "mini-plugin");
    mkdirSync(path.join(pkgRoot, "lib"), { recursive: true });
    writeFileSync(
      path.join(pkgRoot, "package.json"),
      JSON.stringify({
        name: "dsh-mini-test",
        version: "0.0.1",
        dsh: { client: { platform: "web", inject: [] } },
      }),
    );
    writeFileSync(path.join(pkgRoot, "lib", "client.js"), "// mini\n");

    const pluginsDir = mkdtempSync(path.join(tmpdir(), "xrk-market-plugins-"));
    temps.push(pluginsDir);
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(
      path.join(pluginsDir, ".xrk-plugins.json"),
      JSON.stringify({ rev: 1, packages: {} }),
    );

    const handler = createDshCompatPublicHandler({ pluginsDir });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/dsh-market/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: "install",
          spec: pkgRoot,
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        mutated?: boolean;
        deferred?: boolean;
        installed?: string[];
      };
      expect(res.status).toBe(200);
      if (body.mutated) {
        expect(body.ok).toBe(true);
        expect(body.installed).toContain("dsh-mini-test");
      } else {
        expect(body.deferred).toBe(true);
      }
    });
  },
    15_000,
  );

  it("vision-router-settings describe uses enabled+view shape", async () => {
    const handler = compatHandler();
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/vision-router-settings/describe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "vr1",
          method: "describe",
          payload: {},
        }),
      });
      const body = (await res.json()) as {
        result: {
          ok: boolean;
          value: {
            enabled?: boolean;
            view?: { value?: object; revision?: number };
          };
        };
      };
      expect(body.result.value.enabled).toBe(true);
      expect(body.result.value.view?.value).toBeTypeOf("object");
    });
  });

  it("mnemon status-summary includes storage scopes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-mnemon-ws-"));
    temps.push(root);
    const handler = compatHandler({
      workspaceRoot: root,
      xrkHome: path.join(root, "home"),
    });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/dsh-mnemon-read/status-summary`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "s1",
          method: "status-summary",
          payload: {},
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: {
          ok: boolean;
          value: {
            healthy?: boolean;
            commandFound?: boolean;
            storage?: { scopes?: unknown[]; activeRoot?: string };
            memoryBodies?: unknown[];
          };
        };
      };
      expect(body.result.value.healthy).toBe(true);
      expect(body.result.value.commandFound).toBe(true);
      expect(Array.isArray(body.result.value.memoryBodies)).toBe(true);
      expect(Array.isArray(body.result.value.storage?.scopes)).toBe(true);
      expect(body.result.value.storage?.activeRoot).toBeTruthy();
    });
  });

  it("serves wallet/memento/modlens/pocket surfaces without SPA fallback", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-surfaces-"));
    temps.push(root);
    const handler = compatHandler({ xrkHome: path.join(root, "home") });
    await withPublicHandler(handler, async (base) => {
      const wallet = await (await fetch(`${base}/api/wallet/snapshot`)).json();
      expect(wallet.ok).toBe(true);
      expect(wallet.adapter).toBe("xrk-dsh-compat");
      expect(wallet.incomplete).toBeUndefined();

      const balance = (await fetch(`${base}/wallet/api/balance`)).json();
      const balanceBody = (await balance) as {
        available?: boolean;
        incomplete?: string[];
      };
      expect(balanceBody.incomplete).toContain("wallet-host");

      const cost = (await fetch(`${base}/wallet/api/cost?session=s1`)).json();
      const costBody = (await cost) as { ok: boolean; costThreshold: number };
      expect(costBody.ok).toBe(true);
      expect(costBody.costThreshold).toBe(5);

      const account = await fetch(`${base}/api/wallet/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "main", balance: 10 }),
      });
      const accountBody = (await account.json()) as {
        ok: boolean;
        account: { label: string };
      };
      expect(accountBody.ok).toBe(true);
      expect(accountBody.account.label).toBe("main");

      const memPost = await fetch(`${base}/api/memento/entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "note", body: "hello" }),
      });
      expect(memPost.status).toBe(201);

      const mem = await (
        await fetch(`${base}/api/memento/entries?limit=10`)
      ).json();
      expect(Array.isArray(mem.entries)).toBe(true);
      expect(mem.entries.length).toBe(1);
      expect(mem.entries[0].text).toBe("hello");
      expect(Array.isArray(mem.budgets)).toBe(true);

      const mod = await (
        await fetch(`${base}/modlens/config?discover=1`)
      ).json();
      expect(mod.reuse).toBeTypeOf("object");
      expect(mod.engines).toBeTypeOf("object");

      const sync = await (await fetch(`${base}/api-import/sync`)).json();
      expect(sync.ok).toBe(true);
      expect(sync.config.inbound).toBeTypeOf("object");
      expect(sync.config.outbound).toBeTypeOf("object");

      const pocket = await fetch(`${base}/dsh-pocket/pocket.status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "p1",
          method: "pocket.status",
          payload: {},
        }),
      });
      const pBody = (await pocket.json()) as {
        result: {
          ok: boolean;
          value: {
            state?: string;
            proxyRunning?: boolean;
            lanUrl?: string | null;
            current?: string;
          };
        };
      };
      expect(pBody.result.ok).toBe(true);
      expect(pBody.result.value.state).toBe("connected");
      expect(pBody.result.value.proxyRunning).toBe(true);
      expect(pBody.result.value.lanUrl).toBeTypeOf("string");

      const pVer = await fetch(`${base}/dsh-pocket/pocket.version`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "pv1",
          method: "pocket.version",
          payload: {},
        }),
      });
      const vBody = (await pVer.json()) as {
        result: { ok: boolean; value: { current?: string; loaded?: string } };
      };
      expect(vBody.result.ok).toBe(true);
      expect(vBody.result.value.current).toBe("1.0.0");
      expect(vBody.result.value.loaded).toBe("1.0.0");

      const genui = await (
        await fetch(`${base}/.well-known/dsh-genui`)
      ).json();
      expect(genui.route_prefix).toBe("/_dsh/genui");
      const designs = await (
        await fetch(`${base}/_dsh/genui/manage/designs`)
      ).json();
      expect(Array.isArray(designs.designs)).toBe(true);

      const noema = await (
        await fetch(`${base}/_dsh/dsh-noema/status`)
      ).json();
      expect(noema.ok).toBe(true);
      expect(noema.config).toBeTypeOf("object");

      const im = await fetch(`${base}/weixin/connection.status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "im1",
          method: "connection.status",
          payload: {},
        }),
      });
      const imBody = (await im.json()) as {
        result: { ok: boolean; value: { bots?: unknown[]; state?: string } };
      };
      expect(imBody.result.ok).toBe(true);
      expect(Array.isArray(imBody.result.value.bots)).toBe(true);
      expect(imBody.result.value.state).toBe("offline");
    });
  });

  it("serves dream-skin / undo / wallpaper / skin-market / tokenledger adapters", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-adapters-"));
    temps.push(root);
    const handler = compatHandler({
      xrkHome: path.join(root, "home"),
    });

    await withPublicHandler(handler, async (base) => {
      const dreamGet = await fetch(`${base}/dream-skin/api`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "get" }),
      });
      const dreamBody = (await dreamGet.json()) as {
        ok: boolean;
        value: Record<string, unknown>;
      };
      expect(dreamBody.ok).toBe(true);

      const undoSettings = await (
        await fetch(`${base}/api/undo/settings`)
      ).json() as { ok: boolean; settings: { keepAuto: number } };
      expect(undoSettings.ok).toBe(true);
      expect(undoSettings.settings.keepAuto).toBeGreaterThan(0);

      const wallpaper = await (
        await fetch(`${base}/wallpaper-engine/settings`)
      ).json() as { settings: { scrim: number } };
      expect(typeof wallpaper.settings.scrim).toBe("number");

      const catalog = await (
        await fetch(`${base}/dsh-skin-market/catalog`)
      ).json() as { skins: unknown[] };
      expect(Array.isArray(catalog.skins)).toBe(true);

      const usage = await (
        await fetch(`${base}/api/tokenledger/usage`)
      ).json() as { ok: boolean; windows: { today: { tokens: number } } };
      expect(usage.ok).toBe(true);
      expect(usage.windows.today).toBeTypeOf("object");
    });
  });

  it("undo restore/prune/export round-trip on host-settings snapshots", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-undo-full-"));
    temps.push(root);
    const home = path.join(root, "home");
    mkdirSync(home, { recursive: true });
    const settingsPath = path.join(home, "host-settings.json");
    writeFileSync(settingsPath, JSON.stringify({ a: 1 }));
    const handler = compatHandler({ xrkHome: home });

    await withPublicHandler(handler, async (base) => {
      const snap = await fetch(`${base}/api/undo/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "test" }),
      });
      const snapBody = (await snap.json()) as { ok: boolean; id: string };
      expect(snapBody.ok).toBe(true);

      writeFileSync(settingsPath, JSON.stringify({ a: 2 }));
      const restore = await fetch(`${base}/api/undo/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: snapBody.id }),
      });
      const restoreBody = (await restore.json()) as { ok: boolean };
      expect(restoreBody.ok).toBe(true);
      expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({ a: 1 });

      const prune = await fetch(`${base}/api/undo/prune`, { method: "POST" });
      const pruneBody = (await prune.json()) as {
        ok: boolean;
        removedAuto: number;
        removedPre: number;
      };
      expect(pruneBody.ok).toBe(true);

      const exportRes = await fetch(`${base}/api/undo/export`, { method: "POST" });
      const exportBody = (await exportRes.json()) as {
        ok: boolean;
        count: number;
        path: string;
      };
      expect(exportBody.ok).toBe(true);
      expect(exportBody.count).toBeGreaterThan(0);
      expect(existsSync(exportBody.path)).toBe(true);
    });
  });

  it("serves mobile-access control and tongflow canvas APIs", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-mobile-tf-"));
    temps.push(root);
    const pluginsDir = compatPlugins(["dsh-mobile", "dsh-tongflow"]);
    const handler = createDshCompatPublicHandler({
      pluginsDir,
      xrkHome: path.join(root, "home"),
    });

    await withPublicHandler(handler, async (base) => {
      const controlRes = await fetch(`${base}/api/mobile-access/control`);
      expect(controlRes.status).toBe(200);
      const control = (await controlRes.json()) as { running: boolean };
      expect(control.running).toBe(false);

      const on = await fetch(`${base}/api/mobile-access/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ running: true }),
      });
      const onBody = (await on.json()) as { running: boolean; origin?: string };
      expect(onBody.running).toBe(true);
      expect(onBody.origin).toMatch(/^http:\/\//);

      const lanPair = await fetch(`${base}/api/mobile-access/lan/pairing/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(lanPair.status).toBe(200);
      const lanPairBody = (await lanPair.json()) as {
        appKey?: string;
        pairUrl?: string;
      };
      expect(lanPairBody.appKey).toBeTruthy();
      expect(lanPairBody.pairUrl).toContain("/mobile-access/pair");

      const pair = await fetch(`${base}/api/mobile-access/pairing/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const pairBody = (await pair.json()) as { ok: boolean; appKey?: string };
      expect(pairBody.ok).toBe(true);
      expect(pairBody.appKey).toBeTruthy();

      const gated = await fetch(`${base}/`, {
        headers: {
          "x-forwarded-host": "demo.r6.cpolar.cn",
          Accept: "application/json",
        },
        redirect: "manual",
      });
      expect(gated.status).toBe(401);
      const gatedBody = (await gated.json()) as {
        error: string;
        mode: string;
      };
      expect(gatedBody.error).toBe("mobile_access_authentication_required");
      expect(gatedBody.mode).toBe("wan");

      const pinPage = await fetch(`${base}/mobile-access/wan-pin`, {
        headers: { "x-forwarded-host": "demo.r6.cpolar.cn" },
      });
      expect(pinPage.status).toBe(200);

      const registry = await (
        await fetch(`${base}/api/plugins/registry`)
      ).json() as { plugins: Record<string, unknown> };
      expect(registry.plugins).toBeTypeOf("object");

      const create = await fetch(`${base}/api/task/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hello", nodeId: "n1" }),
      });
      const createBody = (await create.json()) as { taskId: string };
      expect(createBody.taskId).toBeTruthy();

      const wait = await fetch(
        `${base}/api/task/wait?taskId=${encodeURIComponent(createBody.taskId)}`,
      );
      const sse = await wait.text();
      expect(sse).toContain("SSE_CONNECTED");
      expect(sse).toContain("COMPLETED");

      const health = await (
        await fetch(`${base}/tongflow/health`)
      ).json() as { ok: boolean };
      expect(health.ok).toBe(true);

      const canvasHealth = await (
        await fetch(`${base}/health`)
      ).json() as { ok: boolean; status: string };
      expect(canvasHealth.ok).toBe(true);
      expect(canvasHealth.status).toBe("ok");
    });
  });

  it("serves baseline paths for auto-review / latest / plugin assets", async () => {
    const handler = createDshCompatPublicHandler({});
    await withPublicHandler(handler, async (base) => {
      const ar = await fetch(`${base}/auto-review/status`);
      const arBody = (await ar.json()) as { incomplete?: string[] };
      expect(arBody.incomplete).toContain("auto-review-host");

      const latest = await fetch(`${base}/latest`);
      expect(latest.status).toBe(200);

      const assets = await fetch(`${base}/plugins/dsh-image-gen/image`);
      const assetBody = (await assets.json()) as { plugin?: string };
      expect(assetBody.plugin).toBe("dsh-image-gen");
    });
  });

  it("classifies auto-review when enabled via heuristic bridge", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-ar-"));
    temps.push(root);
    const handler = createDshCompatPublicHandler({ xrkHome: root });
    await withPublicHandler(handler, async (base) => {
      await fetch(`${base}/auto-review/toggle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      const res = await fetch(`${base}/auto-review/classify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolName: "bash", args: "rm -rf /" }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        verdict?: string;
        classifier?: string;
      };
      expect(body.ok).toBe(true);
      expect(body.verdict).toBeDefined();
      expect(body.classifier).toBe("xrk-heuristic");
    });
  });

  it("analyzes vision-router paste payloads", async () => {
    const handler = createDshCompatPublicHandler({});
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/_dsh/vision-router/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hello vision" }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        analyzed?: boolean;
        images?: unknown[];
        adapter?: string;
      };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.images)).toBe(true);
      expect(body.adapter).toBe("xrk-dsh-compat");
    });
  });

  it("returns live map shape for subagents.live sidebar RPC", async () => {
    const handler = createDshCompatPublicHandler({});
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/sidebar/api/subagents.live`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootSessionId: "sess_root" }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        value?: { live?: Record<string, unknown> };
      };
      expect(body.ok).toBe(true);
      expect(body.value?.live).toBeTypeOf("object");
    });
  });

  it("serves modsearch / usage-stats / turn-rewind / releases adapters", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-extra-adapters-"));
    temps.push(root);
    const handler = createDshCompatPublicHandler({
      pluginsDir: compatPlugins([
        "@liustack/modsearch",
        "@ychris12138/dsh-usage-stats",
        "@anionex/dsh-turn-rewind",
        "dsh-vision-router",
      ]),
      xrkHome: path.join(root, "home"),
    });

    await withPublicHandler(handler, async (base) => {
      const mod = await fetch(`${base}/modsearch/config?doctor=1`);
      const modBody = (await mod.json()) as {
        engine: string;
        keyed: string[];
        readiness?: Array<{ engine: string; ready: boolean }>;
      };
      expect(mod.status).toBe(200);
      expect(Array.isArray(modBody.keyed)).toBe(true);
      expect(Array.isArray(modBody.readiness)).toBe(true);

      const usage = await fetch(`${base}/api/usage-stats/usage`);
      const usageBody = (await usage.json()) as {
        ok: boolean;
        windows: { today: { tokens: number } };
      };
      expect(usageBody.ok).toBe(true);
      expect(usageBody.windows.today).toBeTypeOf("object");

      const rewind = await fetch(
        `${base}/turn-rewind?sessionId=s1&messageSeq=3`,
      );
      const rewindBody = (await rewind.json()) as { status: string };
      expect(rewindBody.status).toBe("missing");

      const rel = await fetch(`${base}/releases/latest`);
      const relBody = (await rel.json()) as { tag_name: string };
      expect(typeof relBody.tag_name).toBe("string");
    });
  });

  it("reports git status/branch/log shapes expected by better-sidebar", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-sidebar-git-"));
    temps.push(root);
    writeFileSync(path.join(root, "tracked.txt"), "hello");
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@xrk"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.name", "xrk"], {
        cwd: root,
        stdio: "ignore",
      });
      execFileSync("git", ["add", "tracked.txt"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], {
        cwd: root,
        stdio: "ignore",
      });
      writeFileSync(path.join(root, "tracked.txt"), "hello\nchanged");
      writeFileSync(path.join(root, "untracked.txt"), "u");
    } catch {
      return;
    }
    const handler = compatHandler({
      defaultCwd: root,
      resolveSessionCwd: () => root,
    });
    await withPublicHandler(handler, async (base) => {
      const statusRes = await fetch(`${base}/sidebar/api/git.status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s1" }),
      });
      const status = (await statusRes.json()) as {
        ok: boolean;
        value: {
          available: boolean;
          branch: string | null;
          entries: Array<{ xy: string; path: string }>;
        };
      };
      expect(status.ok).toBe(true);
      expect(status.value.available).toBe(true);
      expect(status.value.branch).toBeTruthy();
      expect(status.value.entries.length).toBeGreaterThan(0);
      for (const entry of status.value.entries) {
        expect(entry.xy).toMatch(/^[\sMADRCU?!]{2}$/);
        expect(entry.path).toBeTruthy();
      }

      const branchRes = await fetch(`${base}/sidebar/api/git.branch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s1" }),
      });
      const branch = (await branchRes.json()) as {
        ok: boolean;
        value: { available: boolean; current: string; names: string[] };
      };
      expect(branch.ok).toBe(true);
      expect(branch.value.available).toBe(true);
      expect(branch.value.current).toBeTruthy();
      expect(Array.isArray(branch.value.names)).toBe(true);
      expect(branch.value.names.length).toBeGreaterThan(0);
      expect(branch.value).not.toHaveProperty("branches");

      const logRes = await fetch(`${base}/sidebar/api/git.log`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s1", limit: 5 }),
      });
      const logBody = (await logRes.json()) as {
        ok: boolean;
        value: Array<{
          hash: string;
          hashFull: string;
          subject: string;
          author: string;
          date: string;
          refs: string;
        }>;
      };
      expect(logBody.ok).toBe(true);
      expect(Array.isArray(logBody.value)).toBe(true);
      expect(logBody.value.length).toBeGreaterThan(0);
      expect(logBody.value[0]!.hash).toBeTruthy();
      expect(logBody.value[0]!.hashFull).toHaveLength(40);
      expect(logBody.value[0]!.subject).toBe("init");

      const depsRes = await fetch(`${base}/sidebar/api/terminal.deps`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s1" }),
      });
      const deps = (await depsRes.json()) as {
        ok: boolean;
        value: { ready: boolean; command: string; note: string };
      };
      expect(deps.ok).toBe(true);
      expect(deps.value.ready).toBe(true);
      expect(deps.value.command).toContain("node-pty");
      expect(deps.value.note).toBeTruthy();

      const stageRes = await fetch(`${base}/sidebar/api/git.stage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s1", path: "tracked.txt" }),
      });
      const stage = (await stageRes.json()) as { ok: boolean };
      expect(stage.ok).toBe(true);

      const diffRes = await fetch(`${base}/sidebar/api/git.diff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "s1",
          path: "tracked.txt",
          staged: true,
        }),
      });
      const diff = (await diffRes.json()) as {
        ok: boolean;
        value: { diff: string };
      };
      expect(diff.ok).toBe(true);
      expect(diff.value.diff).toContain("changed");
    });
  });

  it("infers mnemon RPC when no host manifest is staged", async () => {
    const pluginsDir = compatPlugins(["dsh-mnemon"], {
      writeHostManifest: false,
    });
    const handler = createDshCompatPublicHandler({ pluginsDir });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/dsh-mnemon-settings/get`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "preset-1",
          method: "get",
          payload: { namespace: "mnemon" },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        rpcId: string;
        result: { ok: boolean; value: { status?: string } };
      };
      expect(body.rpcId).toBe("preset-1");
      expect(body.result.ok).toBe(true);
      expect(body.result.value.status).toBe("ready");
    });
  });

  it("infers host routes for unknown DSH client packages without manifest", async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), "xrk-dsh-infer-"));
    temps.push(pluginsDir);
    const name = "dsh-poison-guard";
    const pkgRoot = path.join(pluginsDir, "web", "plugins", name);
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(path.join(pkgRoot, "client.js"), "// test\n");
    writeFileSync(
      path.join(pkgRoot, "package.json"),
      JSON.stringify({
        name,
        version: "0.2.0",
        dsh: { client: { platform: "web", inject: [] } },
      }),
    );
    writeFileSync(
      path.join(pluginsDir, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: { [name]: { name, version: "0.2.0", kind: "client" } },
      }),
    );
    const handler = createDshCompatPublicHandler({ pluginsDir });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/dsh-poison-guard-settings/get`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "inf-1",
          method: "get",
          payload: { namespace: "poisonGuard" },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        rpcId: string;
        result: { ok: boolean; value: { status?: string } };
      };
      expect(body.rpcId).toBe("inf-1");
      expect(body.result.ok).toBe(true);
      expect(body.result.value.status).toBe("ready");

      const http = await fetch(`${base}/_dsh/dsh-poison-guard/status`);
      expect(http.status).toBe(200);
      const httpBody = (await http.json()) as {
        ok?: boolean;
        path?: string;
        adapter?: string;
        incomplete?: string[];
        plugin?: string;
      };
      expect(httpBody.path).toBe("/_dsh/dsh-poison-guard/status");
      expect(httpBody.ok).toBe(true);
      expect(httpBody.adapter).toBe("xrk-dsh-compat");
      expect(httpBody.plugin).toBe("dsh-poison-guard");
      expect(httpBody.incomplete).toContain("dsh-host");
    });
  });

  it("does not infer host routes for XRK-native packages without manifest", async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), "xrk-xrk-no-infer-"));
    temps.push(pluginsDir);
    const name = "@xrkseek/my-native-tool";
    const pkgRoot = path.join(
      pluginsDir,
      "web",
      "plugins",
      "@xrkseek",
      "my-native-tool",
    );
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(path.join(pkgRoot, "client.js"), "// test\n");
    writeFileSync(
      path.join(pluginsDir, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          [name]: { name, version: "1.0.0", kind: "client" },
        },
      }),
    );
    const handler = createDshCompatPublicHandler({ pluginsDir });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/_dsh/my-native-tool/ping`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { incomplete?: string[] };
      expect(body.incomplete).toContain("dsh-host");
    });
  });

  it("discovers xrk.host.json routes as honest stubs", async () => {
    const pluginsDir = tempPlugins();
    const pkgRoot = path.join(
      pluginsDir,
      "web",
      "plugins",
      "my-custom-plugin",
    );
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(
      path.join(pluginsDir, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          dshmarket: {
            name: "dshmarket",
            version: "1.0.0",
            kind: "client",
            source: "dshmarket",
          },
          "my-custom-plugin": {
            name: "my-custom-plugin",
            version: "1.0.0",
            kind: "client",
          },
        },
      }),
    );
    writeFileSync(
      path.join(pkgRoot, "xrk.host.json"),
      JSON.stringify({
        id: "my-custom",
        httpPrefixes: ["/api/my-custom/"],
        incomplete: "my-custom-host",
      }),
    );
    const handler = createDshCompatPublicHandler({ pluginsDir });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/api/my-custom/status`);
      const body = (await res.json()) as {
        adapter?: string;
        incomplete?: string[];
        path?: string;
      };
      expect(body.adapter).toBe("xrk-dsh-compat");
      expect(body.incomplete).toContain("my-custom-host");
      expect(body.path).toBe("/api/my-custom/status");
    });
  });

  it("IM messaging HTTP round-trip via bridge", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-im-http-"));
    temps.push(root);
    const handler = compatHandler({ xrkHome: path.join(root, "home") });
    await withPublicHandler(handler, async (base) => {
      const send = await fetch(`${base}/api/im/weixin/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botId: "b1", text: "hello http" }),
      });
      const sendBody = (await send.json()) as { ok: boolean; messageId?: string };
      expect(sendBody.ok).toBe(true);
      expect(sendBody.messageId).toBeTruthy();

      const webhook = await fetch(`${base}/api/im/weixin/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botId: "b1", text: "inbound http" }),
      });
      const webhookBody = (await webhook.json()) as {
        ok: boolean;
        received?: boolean;
      };
      expect(webhookBody.ok).toBe(true);
      expect(webhookBody.received).toBe(true);

      const list = await fetch(`${base}/api/im/weixin/messages?botId=b1`);
      const listBody = (await list.json()) as {
        ok: boolean;
        messages: unknown[];
      };
      expect(listBody.ok).toBe(true);
      expect(listBody.messages.length).toBe(2);

      const stream = await fetch(`${base}/api/im/weixin/stream?botId=b1`, {
        headers: { accept: "text/event-stream" },
      });
      expect(stream.status).toBe(200);
      const sse = await stream.text();
      expect(sse).toContain("event: snapshot");
      expect(sse).toContain("inbound http");

      const gateway = await fetch(`${base}/weixin/connection.gateway.status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "gw1",
          method: "connection.gateway.status",
          payload: {},
        }),
      });
      const gwBody = (await gateway.json()) as {
        result: {
          ok: boolean;
          value: { state?: string; incomplete?: string[] };
        };
      };
      expect(gwBody.result.ok).toBe(true);
      expect(gwBody.result.value.state).toBe("bridge");
      expect(gwBody.result.value.incomplete ?? []).toEqual([]);
    });
  });

  it("serves harness connector heartbeat and office RPC for dsh-im", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-im-office-"));
    temps.push(root);
    const pluginsDir = compatPlugins(["@xmanrui/dsh-im"]);
    const handler = createDshCompatPublicHandler({
      pluginsDir,
      xrkHome: root,
      onJobAccepted: async (job) => ({ sessionId: `office-${job.id}` }),
    });
    await withPublicHandler(handler, async (base) => {
      const beat = await fetch(`${base}/api/harness/connector/heartbeat`);
      const beatBody = (await beat.json()) as { ok: boolean; protocol: string };
      expect(beatBody.ok).toBe(true);
      expect(beatBody.protocol).toContain("office-harness");

      const jobId = "job-test-1";
      const accept = await fetch(
        `${base}/api/harness/connector/jobs/${encodeURIComponent(jobId)}/accept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspace: "default" }),
        },
      );
      const acceptBody = (await accept.json()) as {
        ok: boolean;
        job: { state: string };
      };
      expect(acceptBody.ok).toBe(true);
      expect(acceptBody.job.state).toBe("accepted");

      const bridged = await fetch(
        `${base}/api/harness/connector/jobs/${encodeURIComponent("job-bridge-1")}/accept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspace: "default",
            instruction: "summarize inbox",
          }),
        },
      );
      const bridgedBody = (await bridged.json()) as {
        ok: boolean;
        job: { state: string; result?: { sessionId?: string } };
      };
      expect(bridgedBody.ok).toBe(true);
      expect(bridgedBody.job.result?.sessionId).toBe("office-job-bridge-1");

      const office = await fetch(`${base}/office/connection.status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "o1",
          method: "connection.status",
          payload: {},
        }),
      });
      const officeBody = (await office.json()) as {
        result: { ok: boolean; value: { configured: boolean } };
      };
      expect(officeBody.result.ok).toBe(true);
      expect(officeBody.result.value.configured).toBe(false);
    });
  });

  it("turn-rewind ready preview includes full checkpoint shape", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-rewind-ready-"));
    temps.push(root);
    const home = path.join(root, "home");
    const { upsertRewindMarker } = await import(
      "../src/dsh-compat/turn-rewind.js"
    );
    upsertRewindMarker(home, {
      sessionId: "sess-a",
      messageSeq: 7,
      turn: 2,
      turnStartSeq: 5,
      checkpointId: "ck-1",
      checkpointBranch: "main",
      currentBranch: "main",
      changes: [{ path: "src/a.ts", kind: "modified" }],
      planId: "plan-1",
      confirmation: "confirm-1",
    });
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(
        `${base}/turn-rewind?sessionId=sess-a&messageSeq=7`,
      );
      const body = (await res.json()) as {
        status: string;
        totalChanges: number;
        planId?: string;
        restoreBlocked: boolean;
      };
      expect(body.status).toBe("ready");
      expect(body.totalChanges).toBe(1);
      expect(body.planId).toBe("plan-1");
      expect(body.restoreBlocked).toBe(false);
    });
  });

  it("usage-stats providers uses listUsageProviders bridge", async () => {
    const handler = compatHandler({
      listUsageProviders: async () => [
        { id: "deepseek-official", displayName: "DeepSeek", configured: true },
      ],
    });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/api/usage-stats/providers`);
      const body = (await res.json()) as {
        ok: boolean;
        providers: Array<{ id: string }>;
      };
      expect(body.ok).toBe(true);
      expect(body.providers[0]?.id).toBe("deepseek-official");
    });
  });

  it("feishu connection.status returns valid IM snapshot", async () => {
    const pluginsDir = compatPlugins(["@xmanrui/dsh-im"]);
    const handler = createDshCompatPublicHandler({ pluginsDir });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/feishu/connection.status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "fs1",
          method: "connection.status",
          payload: {},
        }),
      });
      const body = (await res.json()) as {
        result: {
          ok: boolean;
          value: { bots: unknown[]; state: string; schemaVersion: number };
        };
      };
      expect(body.result.ok).toBe(true);
      expect(Array.isArray(body.result.value.bots)).toBe(true);
      expect(body.result.value.state).toBe("offline");
      expect(body.result.value.schemaVersion).toBe(1);
    });
  });

  it("undo snapshot with session metadata records turn-rewind marker", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-undo-rewind-"));
    temps.push(root);
    writeFileSync(path.join(root, "tracked.txt"), "v1");
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["add", "tracked.txt"], { cwd: root, stdio: "ignore" });
      execFileSync(
        "git",
        ["-c", "user.email=t@xrk", "-c", "user.name=xrk", "commit", "-m", "init"],
        { cwd: root, stdio: "ignore" },
      );
    } catch {
      return;
    }
    writeFileSync(path.join(root, "tracked.txt"), "v2");
    const home = path.join(root, "home");
    const handler = compatHandler({
      xrkHome: home,
      workspaceRoot: root,
      defaultCwd: root,
    });
    await withPublicHandler(handler, async (base) => {
      const snap = await fetch(`${base}/api/undo/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "rewind-test",
          sessionId: "sess-rw",
          messageSeq: 4,
          cwd: root,
        }),
      });
      expect(snap.status).toBe(200);

      const preview = await fetch(
        `${base}/turn-rewind?sessionId=sess-rw&messageSeq=4`,
      );
      const previewBody = (await preview.json()) as {
        status: string;
        totalChanges: number;
        planId?: string;
        confirmation?: string;
      };
      expect(previewBody.status).toBe("ready");
      expect(previewBody.totalChanges).toBeGreaterThan(0);

      writeFileSync(path.join(root, "tracked.txt"), "v3");
      const restore = await fetch(`${base}/turn-rewind`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "code",
          sessionId: "sess-rw",
          messageSeq: 4,
          cwd: root,
          ...(previewBody.planId ? { planId: previewBody.planId } : {}),
          ...(previewBody.confirmation
            ? { confirmation: previewBody.confirmation }
            : {}),
        }),
      });
      const restoreBody = (await restore.json()) as { restored: boolean };
      expect(restoreBody.restored).toBe(true);
      expect(readFileSync(path.join(root, "tracked.txt"), "utf8")).toBe("v2");
    });
  });

  it("cost-meter-settings describe returns seeded defaults", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-cost-settings-"));
    temps.push(root);
    const handler = compatHandler({ xrkHome: path.join(root, "home") });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/cost-meter-settings/describe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "cm1",
          method: "describe",
          payload: {},
        }),
      });
      const body = (await res.json()) as {
        result: {
          ok: boolean;
          value: { enabled?: boolean; view?: { value?: { locale?: string } } };
        };
      };
      expect(body.result.ok).toBe(true);
      expect(body.result.value.enabled).toBe(true);
      expect(body.result.value.view?.value?.locale).toBe("auto");
    });
  });

  it("persists settings mutations under xrkHome", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-settings-persist-"));
    temps.push(root);
    const home = path.join(root, "home");
    const handler = compatHandler({ xrkHome: home });
    await withPublicHandler(handler, async (base) => {
      const set = await fetch(`${base}/dsh-poison-guard-settings/mutate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: "p1",
          method: "mutate",
          payload: {
            ops: [{ op: "set", key: "armed", value: true }],
          },
        }),
      });
      expect(set.status).toBe(200);
      const file = path.join(home, "settings-docs", "poisonGuard.json");
      expect(existsSync(file)).toBe(true);
    });
  });

  it("persists sidebar settings to xrkHome", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-sidebar-prefs-"));
    temps.push(root);
    const xrkHome = path.join(root, "home");
    const handler = compatHandler({ xrkHome, defaultCwd: root });
    await withPublicHandler(handler, async (base) => {
      const update = await fetch(`${base}/sidebar/api/settings.update`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patch: { defaultWidthPercent: 42 } }),
      });
      const body = (await update.json()) as {
        ok: boolean;
        value: { value: { defaultWidthPercent: number }; revision: number };
      };
      expect(body.ok).toBe(true);
      expect(body.value.value.defaultWidthPercent).toBe(42);

      const prefsFile = path.join(xrkHome, "sidebar", "prefs.json");
      expect(existsSync(prefsFile)).toBe(true);

      const again = await fetch(`${base}/sidebar/api/settings.get`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const getBody = (await again.json()) as {
        ok: boolean;
        value: { value: { defaultWidthPercent: number } };
      };
      expect(getBody.ok).toBe(true);
      expect(getBody.value.value.defaultWidthPercent).toBe(42);
    });
  });

  it("serves modlens RPC channel and community root slugs", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-modlens-root-"));
    temps.push(root);
    const handler = compatHandler({ xrkHome: path.join(root, "home") });
    await withPublicHandler(handler, async (base) => {
      const rpc = await fetch(`${base}/modlens/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rpcId: "ml1",
          method: "config",
          payload: { discover: true },
        }),
      });
      const rpcBody = (await rpc.json()) as {
        result: {
          ok: boolean;
          value: { ok: boolean; discover: unknown[] };
        };
      };
      expect(rpcBody.result.ok).toBe(true);
      expect(Array.isArray(rpcBody.result.value.discover)).toBe(true);

      const slug = await fetch(`${base}/whale-girl`);
      const slugBody = (await slug.json()) as { ok: boolean; plugin: string };
      expect(slug.status).toBe(200);
      expect(slugBody.ok).toBe(true);
      expect(slugBody.plugin).toBe("whale-girl");
    });
  });

  it("serves tongflow studio misc paths", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-tongflow-misc-"));
    temps.push(root);
    const handler = compatHandler({ xrkHome: path.join(root, "home") });
    await withPublicHandler(handler, async (base) => {
      const projects = await (
        await fetch(`${base}/projects`)
      ).json() as { ok: boolean; projects: unknown[] };
      expect(projects.ok).toBe(true);
      expect(Array.isArray(projects.projects)).toBe(true);

      const looks = await (
        await fetch(`${base}/Looks/`)
      ).json() as { ok: boolean; items: unknown[] };
      expect(looks.ok).toBe(true);
      expect(Array.isArray(looks.items)).toBe(true);
    });
  });

  it("serves staged plugin static assets under /plugins/", async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), "xrk-plugin-asset-dir-"));
    temps.push(pluginsDir);
    const pkgRoot = path.join(pluginsDir, "web", "plugins", "whale-girl");
    mkdirSync(path.join(pkgRoot, "chunks"), { recursive: true });
    writeFileSync(path.join(pkgRoot, "client.js"), "// whale\n");
    writeFileSync(path.join(pkgRoot, "chunks", "panel.js"), "export const x=1;\n");
    writeFileSync(
      path.join(pluginsDir, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "whale-girl": { name: "whale-girl", version: "1.0.0", kind: "client" },
        },
      }),
    );
    const handler = compatHandler({ pluginsDir });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/plugins/whale-girl/chunks/panel.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("javascript");
      const body = await res.text();
      expect(body).toContain("export const x=1");
    });
  });

  it("apply bridge registers host.mjs routes", async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), "xrk-apply-dir-"));
    temps.push(pluginsDir);
    const pkgRoot = path.join(pluginsDir, "web", "plugins", "my-native-tool");
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(path.join(pkgRoot, "client.js"), "// native\n");
    writeFileSync(
      path.join(pkgRoot, "host.mjs"),
      `export function createHostContribution() {
  return {
    http: [{
      match: (p) => p.startsWith("/my-native-tool/"),
      handle: async (_req, res, pathname) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, path: pathname, via: "apply" }));
        return true;
      },
    }],
  };
}`,
    );
    writeFileSync(
      path.join(pluginsDir, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "my-native-tool": {
            name: "my-native-tool",
            version: "1.0.0",
            kind: "client",
          },
        },
      }),
    );
    const handler = compatHandler({ pluginsDir });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/my-native-tool/ping`);
      const body = (await res.json()) as { ok: boolean; via: string };
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.via).toBe("apply");
    });
  });

  it("honest GET catch-all returns JSON for uncovered community paths", async () => {
    const handler = compatHandler();
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/some-future-plugin/api/status`);
      const body = (await res.json()) as {
        ok: boolean;
        status: string;
        adapter: string;
        incomplete?: string[];
      };
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.status).toBe("ready");
      expect(body.adapter).toBe("xrk-dsh-compat");
      expect(body.incomplete).toContain("dsh-host");
    });
  });
});

describe("dsh-compat matrix", () => {
  it("lists generic capabilities and known gaps", async () => {
    const {
      DSH_COMPAT_GENERIC_CAPABILITIES,
      DSH_COMPAT_KNOWN_GAPS,
      listDshCompatGenericIds,
      listDshCompatGapIds,
    } = await import("../src/dsh-compat/dsh-compat-matrix.js");
    expect(listDshCompatGenericIds().length).toBeGreaterThan(10);
    expect(listDshCompatGenericIds()).toContain("dynamic-cordis-runner");
    expect(listDshCompatGapIds()).toEqual([]);
    expect(listDshCompatGapIds()).not.toContain("cordis-fiber-subprocess");
    expect(
      DSH_COMPAT_GENERIC_CAPABILITIES.some((r) => r.id === "honest-http-catchall"),
    ).toBe(true);
    expect(
      DSH_COMPAT_KNOWN_GAPS.every((r) =>
        ["missing", "honest-stub"].includes(r.coverage),
      ),
    ).toBe(true);
  });
});
