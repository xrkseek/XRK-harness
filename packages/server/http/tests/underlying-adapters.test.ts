import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDshCompatPublicHandler } from "../src/dsh-compat/index.js";
import {
  honestReady,
  imHostActionUnavailable,
  modsearchHostUnavailable,
} from "../src/dsh-compat/honest-envelope.js";
import { handleImChannelRpc } from "../src/dsh-compat/im-channels.js";
import { handleModsearchRpc } from "../src/dsh-compat/modsearch.js";
import { handleNoemaRpc } from "../src/dsh-compat/noema.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

async function withPublicHandler(
  handler: ReturnType<typeof createDshCompatPublicHandler>,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer((req, res) => {
    void handler(req, res).then((claimed) => {
      if (!claimed) {
        res.writeHead(404);
        res.end("not handled");
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        await run(`http://127.0.0.1:${port}`);
        server.close(() => resolve());
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

describe("honest-envelope", () => {
  it("tags ready and unavailable envelopes consistently", () => {
    const ready = honestReady({ feature: "demo" });
    expect(ready.adapter).toBe("xrk-dsh-compat");
    expect(ready.status).toBe("ready");

    const im = imHostActionUnavailable("weixin", "provision.begin");
    expect(im.incomplete).toEqual(["im-host"]);
    expect(im.code).toBe("IM_HOST_UNAVAILABLE");

    const search = modsearchHostUnavailable("search", { query: "x" });
    expect(search.incomplete).toEqual(["modsearch-host"]);
  });
});

describe("im-channels underlying", () => {
  it("persists bot create/delete and bridge connection.test", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-im-"));
    temps.push(home);

    const created = handleImChannelRpc(
      "/weixin",
      "bot.create",
      { botId: "b1", label: "demo" },
      { xrkHome: home },
    ) as { bots: Array<{ botId: string }>; state: string };
    expect(created.bots.some((b) => b.botId === "b1")).toBe(true);
    expect(created.state).toBe("offline");

    const deleted = handleImChannelRpc(
      "/weixin",
      "bot.delete",
      { botId: "b1" },
      { xrkHome: home },
    ) as { bots: unknown[] };
    expect(deleted.bots.length).toBe(0);

    handleImChannelRpc(
      "/weixin",
      "bot.create",
      { botId: "b2", label: "bridge" },
      { xrkHome: home },
    );

    handleImChannelRpc(
      "/weixin",
      "connector.configure",
      { botId: "b2", connector: { appId: "wx-demo" } },
      { xrkHome: home },
    );

    handleImChannelRpc(
      "/weixin",
      "bot.bind-credentials",
      { botId: "b2" },
      { xrkHome: home },
    );

    const tested = handleImChannelRpc(
      "/weixin",
      "connection.test",
      { botId: "b2" },
      { xrkHome: home },
    ) as { ok?: boolean; state?: string; tested?: boolean };
    expect(tested.ok).toBe(true);
    expect(tested.tested).toBe(true);
    expect(tested.state).toBe("connected");

    const begun = handleImChannelRpc(
      "/weixin",
      "provision.begin",
      {
        botId: "b2",
        connector: { appId: "wx-demo" },
      },
      { xrkHome: home },
    ) as { ok?: boolean; provisionId?: string; status?: string };
    expect(begun.ok).toBe(true);
    expect(begun.status).toBe("pending");
    expect(begun.provisionId).toBeTruthy();
  });
});

describe("modsearch underlying", () => {
  it("serves config RPC and local search bridge", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-modsearch-"));
    temps.push(home);
    const root = mkdtempSync(path.join(tmpdir(), "xrk-modsearch-ws-"));
    temps.push(root);
    writeFileSync(path.join(root, "findme.txt"), "modsearch bridge needle\n");

    const config = await handleModsearchRpc("config", {}, { xrkHome: home });
    expect(Array.isArray((config as { keyed: unknown }).keyed)).toBe(true);

    const search = await handleModsearchRpc(
      "search",
      { query: "needle" },
      { xrkHome: home, workspaceRoot: root },
    );
    expect((search as { ok: boolean }).ok).toBe(true);
    expect((search as { results: unknown[] }).results.length).toBeGreaterThan(0);
  });

  it("HTTP search path returns local bridge results", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-modsearch-http-"));
    temps.push(root);
    const ws = mkdtempSync(path.join(tmpdir(), "xrk-modsearch-http-ws-"));
    temps.push(ws);
    writeFileSync(path.join(ws, "query.txt"), "http bridge token\n");
    const handler = createDshCompatPublicHandler({
      xrkHome: path.join(root, "home"),
      workspaceRoot: ws,
    });
    await withPublicHandler(handler, async (base) => {
      const res = await fetch(`${base}/modsearch/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "token" }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        results: unknown[];
      };
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.results.length).toBeGreaterThan(0);
    });
  });
});

describe("genui underlying", () => {
  it("imports designs and sets default via HTTP", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-genui-"));
    temps.push(root);
    const handler = createDshCompatPublicHandler({
      xrkHome: path.join(root, "home"),
    });
    await withPublicHandler(handler, async (base) => {
      const imported = await fetch(`${base}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          designs: [{ id: "d1", name: "Card", schema: { type: "card" } }],
        }),
      });
      const importBody = (await imported.json()) as {
        ok: boolean;
        imported?: boolean;
        default_design_id?: string;
      };
      expect(importBody.ok).toBe(true);
      expect(importBody.imported).toBe(true);
      expect(importBody.default_design_id).toBe("d1");

      const preview = await fetch(`${base}/preview/d1`);
      const previewBody = (await preview.json()) as {
        ok: boolean;
        preview?: string;
        schema?: Record<string, unknown>;
      };
      expect(previewBody.ok).toBe(true);
      expect(previewBody.preview).toBe("schema-only");
      expect(previewBody.schema).toEqual({ type: "card" });

      const render = await fetch(`${base}/preview/d1`, { method: "POST" });
      const renderBody = (await render.json()) as {
        rendered?: boolean;
        preview?: string;
      };
      expect(renderBody.rendered).toBe(true);
      expect(renderBody.preview).toContain("card");
    });
  });
});

describe("noema underlying", () => {
  it("persists memory index and starts keyword runner bridge", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-noema-"));
    temps.push(home);
    const opts = { xrkHome: home };

    const added = handleNoemaRpc(
      "memory.add",
      { text: "remember this", tags: ["demo"] },
      opts,
    ) as { ok: boolean; total?: number };
    expect(added.ok).toBe(true);
    expect(added.total).toBe(1);

    handleNoemaRpc("set", { enabled: true }, opts);
    const started = handleNoemaRpc("runner.start", {}, opts) as {
      ok?: boolean;
      running?: boolean;
    };
    expect(started.ok).toBe(true);
    expect(started.running).toBe(true);

    const searched = handleNoemaRpc(
      "memory.search",
      { query: "remember" },
      opts,
    ) as { hits?: Array<{ id: string }> };
    expect(searched.hits?.length).toBe(1);
  });
});

describe("vision underlying", () => {
  it("persists toolkit settings to disk", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-vision-"));
    temps.push(root);
    const handler = createDshCompatPublicHandler({
      xrkHome: path.join(root, "home"),
    });
    await withPublicHandler(handler, async (base) => {
      const post = await fetch(`${base}/_dsh/vision-toolkit/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true, depth: "deep" }),
      });
      const body = (await post.json()) as {
        ok: boolean;
        value: { enabled?: boolean; revision?: number };
      };
      expect(body.ok).toBe(true);
      expect(body.value.enabled).toBe(true);
      expect(body.value.revision).toBeGreaterThan(0);

      const handler2 = createDshCompatPublicHandler({
        xrkHome: path.join(root, "home"),
      });
      await withPublicHandler(handler2, async (base2) => {
        const again = await fetch(`${base2}/_dsh/vision-toolkit/settings`);
        const againBody = (await again.json()) as {
          value: { enabled?: boolean; revision?: number };
        };
        expect(againBody.value.enabled).toBe(true);
        expect(againBody.value.revision).toBeGreaterThan(0);
      });
    });
  });
});

describe("harness connector store", () => {
  it("persists jobs and heartbeat across handler instances", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-hconn-"));
    temps.push(root);
    const xrkHome = path.join(root, "home");
    const handler = createDshCompatPublicHandler({ xrkHome });

    await withPublicHandler(handler, async (base) => {
      await fetch(`${base}/api/harness/connector/heartbeat`, { method: "POST" });
      const accept = await fetch(
        `${base}/api/harness/connector/jobs/persist-1/accept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspace: "default" }),
        },
      );
      const body = (await accept.json()) as { job: { id: string; state: string } };
      expect(body.job.id).toBe("persist-1");
      expect(body.job.state).toBe("accepted");
    });

    const handler2 = createDshCompatPublicHandler({ xrkHome });
    await withPublicHandler(handler2, async (base) => {
      const again = await fetch(
        `${base}/api/harness/connector/jobs/persist-1/accept`,
      );
      const body = (await again.json()) as { job: { state: string } };
      expect(body.job.state).toBe("accepted");
    });
  });
});

describe("mobile-access underlying", () => {
  it("persists custom css/js via settings API", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-mobile-"));
    temps.push(root);
    const handler = createDshCompatPublicHandler({
      xrkHome: path.join(root, "home"),
    });
    await withPublicHandler(handler, async (base) => {
      const save = await fetch(`${base}/api/mobile-access/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customCss: ".x { color: red }", customJs: "console.log(1)" }),
      });
      const saved = (await save.json()) as { ok: boolean };
      expect(saved.ok).toBe(true);

      const css = await fetch(`${base}/mobile-access/custom.css`);
      expect(await css.text()).toContain("color: red");
    });
  });
});

describe("auto-review underlying", () => {
  it("persists enabled toggle and heuristic classify bridge", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-autoreview-"));
    temps.push(root);
    const handler = createDshCompatPublicHandler({
      xrkHome: path.join(root, "home"),
    });
    await withPublicHandler(handler, async (base) => {
      const toggle = await fetch(`${base}/auto-review/toggle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      const body = (await toggle.json()) as { enabled?: boolean; status?: string };
      expect(body.enabled).toBe(true);
      expect(body.status).toBe("ready");

      const classify = await fetch(`${base}/auto-review/classify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: "bash" }),
      });
      const cBody = (await classify.json()) as {
        verdict?: string;
        classifier?: string;
      };
      expect(cBody.verdict).toBeTruthy();
      expect(cBody.classifier).toBe("xrk-heuristic");
    });
  });

  it("syncAutoReviewSlashCommand mirrors slash on/off", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-autoreview-sync-"));
    temps.push(root);
    const home = path.join(root, "home");
    const { syncAutoReviewSlashCommand } = await import(
      "../src/dsh-compat/auto-review-http.js"
    );
    syncAutoReviewSlashCommand({ xrkHome: home }, "on");
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withPublicHandler(handler, async (base) => {
      const status = await fetch(`${base}/auto-review/status`);
      const body = (await status.json()) as { enabled?: boolean };
      expect(body.enabled).toBe(true);
    });
    syncAutoReviewSlashCommand({ xrkHome: home }, "off");
    await withPublicHandler(handler, async (base) => {
      const status = await fetch(`${base}/auto-review/status`);
      const body = (await status.json()) as { enabled?: boolean; status?: string };
      expect(body.enabled).toBe(false);
      expect(body.status).toBe("offline");
    });
  });
});

describe("im channel underlying", () => {
  it("persists bot metadata with doc-store revision", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-im-"));
    temps.push(root);
    const { handleImChannelRpc } = await import("../src/dsh-compat/im-channels.js");
    const created = handleImChannelRpc(
      "feishu",
      "bot.create",
      { label: "test-bot" },
      { xrkHome: path.join(root, "home") },
    ) as { revision?: number; bots?: unknown[] };
    expect(created.revision).toBeGreaterThan(0);
    expect(Array.isArray(created.bots)).toBe(true);
    expect((created.bots as unknown[]).length).toBe(1);
  });
});

describe("modsearch config", () => {
  it("persists engine config with revision", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-modsearch-"));
    temps.push(root);
    const handler = createDshCompatPublicHandler({
      xrkHome: path.join(root, "home"),
    });
    await withPublicHandler(handler, async (base) => {
      const save = await fetch(`${base}/modsearch/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          engine: "tavily",
          enabled: { tavily: true },
        }),
      });
      const body = (await save.json()) as {
        engine: string;
        revision?: number;
      };
      expect(body.engine).toBe("tavily");
      expect(body.revision).toBeGreaterThan(0);

      const search = await fetch(`${base}/modsearch/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      });
      const searchBody = (await search.json()) as { ok?: boolean; engine?: string };
      expect(searchBody.ok).toBe(true);
      expect(["tavily", "local"]).toContain(searchBody.engine ?? "local");
    });
  });
});

describe("wallpaper settings", () => {
  it("persists settings with revision", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-wallpaper-"));
    temps.push(root);
    const handler = createDshCompatPublicHandler({
      xrkHome: path.join(root, "home"),
    });
    await withPublicHandler(handler, async (base) => {
      const save = await fetch(`${base}/wallpaper-engine/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: { scrim: 0.5, blur: 8 } }),
      });
      const body = (await save.json()) as {
        revision?: number;
        settings: { scrim: number; blur: number };
      };
      expect(body.revision).toBeGreaterThan(0);
      expect(body.settings.scrim).toBe(0.5);
      expect(body.settings.blur).toBe(8);
    });
  });
});

describe("tongflow projects", () => {
  it("creates file-backed projects with revision", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-tongflow-proj-"));
    temps.push(root);
    const handler = createDshCompatPublicHandler({
      xrkHome: path.join(root, "home"),
    });
    await withPublicHandler(handler, async (base) => {
      const created = await fetch(`${base}/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "demo-flow" }),
      });
      const body = (await created.json()) as {
        ok: boolean;
        revision?: number;
        project?: { name: string };
      };
      expect(body.ok).toBe(true);
      expect(body.revision).toBeGreaterThan(0);
      expect(body.project?.name).toBe("demo-flow");

      const list = await fetch(`${base}/projects`);
      const listed = (await list.json()) as { projects: Array<{ name: string }> };
      expect(listed.projects.some((p) => p.name === "demo-flow")).toBe(true);
    });
  });
});
