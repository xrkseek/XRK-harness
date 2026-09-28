/**
 * Hot community plugin HTTP shapes (pet / billing / mcp-connector / …).
 */
import { createServer } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDshCompatPublicHandler } from "../src/index.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

async function withHandler(
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
  if (!addr || typeof addr === "string") throw new Error("no addr");
  try {
    await run(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe("hot community plugin HTTP shapes", () => {
  it("pet state/pets match client parse contract", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-pet-home-"));
    temps.push(home);
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withHandler(handler, async (base) => {
      const state = await (await fetch(`${base}/api/pet/state`)).json();
      expect(typeof state.pet?.id).toBe("string");
      expect(state.display?.visible).not.toBe(false);
      expect(state.affinity).toMatchObject({ points: expect.any(Number) });

      const pets = await (await fetch(`${base}/api/pet/pets`)).json();
      expect(Array.isArray(pets)).toBe(true);
      expect(pets[0]?.id).toBeTruthy();

      const vis = await fetch(`${base}/api/pet/set-visible`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visible: false }),
      });
      expect(vis.ok).toBe(true);
      const after = await (await fetch(`${base}/api/pet/state`)).json();
      expect(after.display.visible).toBe(false);
    });
  });

  it("pet serves staged package assets when installed", async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), "xrk-pet-plug-"));
    temps.push(pluginsDir);
    const dest = path.join(
      pluginsDir,
      "web",
      "plugins",
      "@linxin666",
      "dsh-pet",
    );
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    for (const folder of ["whale-girl", "other"]) {
      const dir = path.join(dest, "assets", folder);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, "pet.json"),
        JSON.stringify({
          id: folder,
          displayName: folder,
          description: `${folder} fixture`,
        }),
      );
      writeFileSync(path.join(dir, "spritesheet.png"), png);
    }
    writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({ name: "@linxin666/dsh-pet", version: "0.0.0" }),
    );
    writeFileSync(
      path.join(pluginsDir, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "@linxin666/dsh-pet": {
            name: "@linxin666/dsh-pet",
            version: "0.0.0",
            kind: "client",
          },
        },
      }),
    );
    const handler = createDshCompatPublicHandler({ pluginsDir });
    await withHandler(handler, async (base) => {
      const pets = await (await fetch(`${base}/api/pet/pets`)).json();
      expect(pets.length).toBeGreaterThan(1);
      const whale = pets.find((p: { id: string }) => p.id === "whale-girl");
      expect(whale?.atlasUrl).toMatch(/^\/pet\//);
      const asset = await fetch(`${base}${whale.atlasUrl}`);
      expect(asset.ok).toBe(true);
      expect(asset.headers.get("content-type")).toMatch(/image\//);
    });
  });

  it("billing endpoints return client-required fields", async () => {
    const handler = createDshCompatPublicHandler({});
    await withHandler(handler, async (base) => {
      const usage = await (
        await fetch(`${base}/api/billing/usage-stats`)
      ).json();
      expect(usage).toHaveProperty("total");

      const pricing = await (await fetch(`${base}/api/billing/pricing`)).json();
      expect(pricing).toHaveProperty("source");
      expect(Array.isArray(pricing.catalog)).toBe(true);

      const balance = await (await fetch(`${base}/api/billing/balance`)).json();
      expect(Array.isArray(balance.balances)).toBe(true);

      const subs = await (
        await fetch(`${base}/api/billing/subscriptions`)
      ).json();
      expect(subs).toHaveProperty("quotas");

      const tool = await (await fetch(`${base}/api/billing/usage-tool`)).json();
      expect(typeof tool.enabled).toBe("boolean");

      const claim = await (
        await fetch(`${base}/api/billing/notify-claim`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: "k" }),
        })
      ).json();
      expect(claim.claimed).not.toBe(false);
    });
  });

  it("mcp-connector api returns ok+detail", async () => {
    const handler = createDshCompatPublicHandler({});
    await withHandler(handler, async (base) => {
      const result = await (
        await fetch(`${base}/mcp-connector/api`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            method: "versionStatus",
            params: { force: false },
          }),
        })
      ).json();
      expect(result.ok).toBe(true);
      expect(result.detail).toBeTruthy();
    });
  });

  it("code-server status and ask state stay offline-safe", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-cs-home-"));
    temps.push(home);
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withHandler(handler, async (base) => {
      const status = await (await fetch(`${base}/code-server/status`)).json();
      expect(status.ok).toBe(true);
      expect(status.running).toBe(false);

      const apiStatus = await (
        await fetch(`${base}/api/code-server/status`)
      ).json();
      expect(apiStatus.ok).toBe(true);
      expect(apiStatus.running).toBe(false);

      await fetch(`${base}/api/code-server/ui-mode`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uiMode: "window" }),
      });
      const mode = await (
        await fetch(`${base}/api/code-server/ui-mode`)
      ).json();
      expect(mode.uiMode).toBe("window");

      const ask = await (await fetch(`${base}/ask/state`)).json();
      expect(ask).toMatchObject({ rev: 0, messages: [] });
    });
  });

  it("free-search describe/mutate persists provider", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-fs-home-"));
    temps.push(home);
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withHandler(handler, async (base) => {
      const described = await (
        await fetch(`${base}/api/dsh-free-search-settings/describe`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).json();
      expect(described.ok).toBe(true);
      expect(described.value.namespaces[0].ns).toBe("web-search-free");

      const mutated = await (
        await fetch(`${base}/api/dsh-free-search-settings/mutate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            document: { provider: "exa", lang: "en" },
          }),
        })
      ).json();
      expect(mutated.ok).toBe(true);
      expect(mutated.value.value).toMatchObject({
        provider: "exa",
        lang: "en",
      });

      const again = await (
        await fetch(`${base}/api/dsh-free-search-settings/describe`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).json();
      expect(again.value.namespaces[0].value).toMatchObject({
        provider: "exa",
        lang: "en",
      });

      const raw = await (
        await fetch(`${base}/api/dsh-free-search-settings/raw-search`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: "xrk harness", maxResults: 3 }),
        })
      ).json();
      // provider persisted as exa → keyed engine unavailable without API key
      expect(raw.ok).toBe(false);
      expect(raw.code).toBe("search-unavailable");
    });
  });

  it("dsh-email settings snapshot/save/serializeAccounts persist", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-email-home-"));
    temps.push(home);
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withHandler(handler, async (base) => {
      const snap = await (
        await fetch(`${base}/_dsh/dsh-email/settings`)
      ).json();
      expect(snap.ok).toBe(true);
      expect(snap.value.writable).toBe(true);
      expect(snap.value.settings.revision).toBe(0);
      expect(snap.value.presets.builtin.gmail).toBeTruthy();

      const serialized = await (
        await fetch(`${base}/_dsh/dsh-email/settings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "serializeAccounts",
            accounts: [
              { name: "work", provider: "gmail", user: "a@b.com" },
            ],
            defaultAccount: "work",
            accountsYaml: "",
          }),
        })
      ).json();
      expect(serialized.ok).toBe(true);
      expect(serialized.value.accountsYaml).toContain("work:");
      expect(serialized.value.commentsDropped).toBe(true);

      const saved = await (
        await fetch(`${base}/_dsh/dsh-email/settings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "save",
            expectedRevision: 0,
            value: {
              accountsYaml: serialized.value.accountsYaml,
              defaultAccount: "work",
              serverPresets: "",
            },
          }),
        })
      ).json();
      expect(saved.ok).toBe(true);
      expect(saved.value.settings.revision).toBe(1);
      expect(saved.value.accounts).toContain("work");

      const whale = await fetch(`${base}/_dsh/dsh-email/assets/whale`);
      expect(whale.ok).toBe(true);
      expect(whale.headers.get("content-type")).toMatch(/image\/png/);

      const testDial = await (
        await fetch(`${base}/_dsh/dsh-email/settings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "test",
            account: "work",
            value: saved.value.settings.value,
          }),
        })
      ).json();
      expect(testDial.ok).toBe(false);
      expect(testDial.error.code).toBe("imap-unavailable");
    });
  });

  it("generic _dsh + community-root persist config/state surfaces", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-surface-home-"));
    temps.push(home);
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withHandler(handler, async (base) => {
      const put = await (
        await fetch(`${base}/_dsh/dsh-poison-guard/settings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ theme: "dark", rules: ["a"] }),
        })
      ).json();
      expect(put.ok).toBe(true);
      expect(put.writable).toBe(true);
      expect(put.settings).toMatchObject({ theme: "dark", rules: ["a"] });
      expect(put.revision).toBeGreaterThanOrEqual(1);

      const got = await (
        await fetch(`${base}/_dsh/dsh-poison-guard/settings`)
      ).json();
      expect(got.settings).toMatchObject({ theme: "dark" });

      const cfg = await (
        await fetch(`${base}/dsh-whale-girl/api/config`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ config: { pet: true, skin: "orca" } }),
        })
      ).json();
      expect(cfg.ok).toBe(true);
      expect(cfg.writable).toBe(true);
      expect(cfg.config).toMatchObject({ pet: true, skin: "orca" });

      const cfgAgain = await (
        await fetch(`${base}/dsh-whale-girl/api/config`)
      ).json();
      expect(cfgAgain.config).toMatchObject({ pet: true, skin: "orca" });

      const state = await (
        await fetch(`${base}/dsh-whale-girl/api/state`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ balance: 12, status: "ready" }),
        })
      ).json();
      expect(state.ok).toBe(true);
      expect(state.balance).toBe(12);
      expect(state.writable).toBe(true);
    });
  });

  it("legacy dsh-pet-7340 config persists; whisper stays offline", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-pet7340-home-"));
    temps.push(home);
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withHandler(handler, async (base) => {
      const saved = await (
        await fetch(`${base}/dsh-pet-7340/config`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            notificationsEnabled: false,
            whisperImageEnabled: true,
            pets: [{ id: "p1" }],
          }),
        })
      ).json();
      expect(saved.ok).toBe(true);
      expect(saved.main.notificationsEnabled).toBe(false);
      expect(saved.main.whisperImageEnabled).toBe(true);
      expect(saved.main.pets).toHaveLength(1);

      const got = await (await fetch(`${base}/dsh-pet-7340/config`)).json();
      expect(got.main.notificationsEnabled).toBe(false);

      const meta = await (
        await fetch(`${base}/dsh-pet-7340/config/meta`)
      ).json();
      expect(meta.configPath).toContain("dsh-pet-7340");

      const whisper = await (
        await fetch(`${base}/dsh-pet-7340/whisper`)
      ).json();
      expect(whisper.ok).toBe(false);
      expect(whisper.reason).toBe("provider-missing");

      const work = await (
        await fetch(`${base}/dsh-pet-7340/work-status`)
      ).json();
      expect(work.state).toBeNull();
    });
  });

  it("agent-teams state returns teams array", async () => {
    const handler = createDshCompatPublicHandler({});
    await withHandler(handler, async (base) => {
      const live = await (
        await fetch(`${base}/plugins/dsh-agent-teams/state`)
      ).json();
      expect(Array.isArray(live.teams)).toBe(true);

      const halt = await (
        await fetch(`${base}/plugins/dsh-agent-teams/halt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).json();
      expect(halt.ok).toBe(true);
    });
  });

  it("token-usage-stats serves HTML + JSON sibling", async () => {
    const handler = createDshCompatPublicHandler({});
    await withHandler(handler, async (base) => {
      const html = await fetch(`${base}/token-usage-stats`);
      expect(html.ok).toBe(true);
      expect(html.headers.get("content-type")).toMatch(/text\/html/);
      const body = await html.text();
      expect(body).toContain("Token");

      const json = await (await fetch(`${base}/api/token-usage-stats`)).json();
      expect(json.totals).toHaveProperty("totalTokens");
    });
  });

  it("im-connect channels returns ok+channels", async () => {
    const handler = createDshCompatPublicHandler({});
    await withHandler(handler, async (base) => {
      const channels = await (
        await fetch(`${base}/api/dsh-im-connect/channels`)
      ).json();
      expect(channels.ok).toBe(true);
      expect(Array.isArray(channels.channels)).toBe(true);

      const assistant = await (
        await fetch(`${base}/api/dsh-im-connect/assistant`)
      ).json();
      expect(assistant.ok).toBe(true);
      expect(Array.isArray(assistant.providers)).toBe(true);
    });
  });

  it("skills-manager scans workspace skills and persists enable/create", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-skills-home-"));
    const ws = mkdtempSync(path.join(tmpdir(), "xrk-skills-ws-"));
    temps.push(home, ws);
    const skillDir = path.join(ws, ".agents", "skills", "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: demo-skill\ndescription: Demo\n---\n\n# Demo\n",
      "utf8",
    );
    const handler = createDshCompatPublicHandler({
      xrkHome: home,
      workspaceRoot: ws,
    });
    await withHandler(handler, async (base) => {
      const state = await (
        await fetch(`${base}/api/dsh-skills-manager/state`)
      ).json();
      expect(Array.isArray(state.roots)).toBe(true);
      expect(state.summary.total).toBeGreaterThanOrEqual(1);
      const names = state.roots.flatMap(
        (r: { skills?: Array<{ name: string }> }) =>
          (r.skills ?? []).map((s) => s.name),
      );
      expect(names).toContain("demo-skill");

      const disabled = await (
        await fetch(`${base}/api/dsh-skills-manager/disable`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            root: "project:.agents/skills",
            name: "demo-skill",
          }),
        })
      ).json();
      expect(disabled.ok).toBe(true);
      const after = await (
        await fetch(`${base}/api/dsh-skills-manager/state`)
      ).json();
      const demo = after.roots
        .flatMap((r: { skills?: Array<{ name: string; enabled: boolean }> }) =>
          r.skills ?? [],
        )
        .find((s: { name: string }) => s.name === "demo-skill");
      expect(demo?.enabled).toBe(false);
    });
  });

  it("task-board persists create/move/archive actions", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-board-home-"));
    temps.push(home);
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withHandler(handler, async (base) => {
      const snap = await (await fetch(`${base}/api/task-board`)).json();
      expect(snap.schemaVersion).toBe(3);
      expect(snap.tasks).toHaveLength(0);

      const created = await (
        await fetch(`${base}/api/task-board/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId: "r1",
            action: {
              kind: "create",
              id: "t1",
              input: {
                title: "Ship compat",
                description: "d",
                prompt: "p",
              },
            },
          }),
        })
      ).json();
      expect(created.ok).toBe(true);
      expect(created.tasks).toHaveLength(1);
      expect(created.tasks[0]).toMatchObject({
        id: "t1",
        title: "Ship compat",
        status: "todo",
      });

      const moved = await (
        await fetch(`${base}/api/task-board/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId: "r2",
            action: { kind: "move", taskId: "t1", status: "doing" },
          }),
        })
      ).json();
      expect(moved.tasks[0].status).toBe("doing");

      const state = await (
        await fetch(`${base}/api/task-board/state`)
      ).json();
      expect(state.tasks[0].status).toBe("doing");
    });
  });

  it("dsh-ssh persists host CRUD and TCP-probes /test", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-ssh-home-"));
    temps.push(home);
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withHandler(handler, async (base) => {
      const empty = await (await fetch(`${base}/api/dsh-ssh/hosts`)).json();
      expect(Array.isArray(empty.hosts)).toBe(true);
      expect(empty.hosts).toHaveLength(0);

      const created = await (
        await fetch(`${base}/api/dsh-ssh/hosts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            alias: "lab",
            host: "10.0.0.2",
            port: 22,
            user: "root",
            auth: { kind: "key", keyPath: "C:/keys/lab.pem" },
            tags: ["dev"],
            description: "lab box",
          }),
        })
      ).json();
      expect(created.host).toMatchObject({
        alias: "lab",
        host: "10.0.0.2",
        user: "root",
        auth: "key",
        tags: ["dev"],
      });
      expect(created.host).not.toHaveProperty("keyPath");

      const listed = await (await fetch(`${base}/api/dsh-ssh/hosts`)).json();
      expect(listed.hosts).toHaveLength(1);
      expect(listed.hosts[0].alias).toBe("lab");

      const patched = await (
        await fetch(`${base}/api/dsh-ssh/hosts?alias=lab`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: "updated", port: 2222 }),
        })
      ).json();
      expect(patched.host).toMatchObject({
        alias: "lab",
        port: 2222,
        description: "updated",
        auth: "key",
      });

      const imported = await (
        await fetch(`${base}/api/dsh-ssh/hosts/import-ssh-config`, {
          method: "POST",
        })
      ).json();
      expect(imported.result).toMatchObject({
        parsed: expect.any(Number),
        added: expect.any(Number),
        skipped: expect.any(Number),
      });
      expect(Array.isArray(imported.result.skippedBlocks)).toBe(true);

      const test = await (
        await fetch(`${base}/api/dsh-ssh/test`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ alias: "lab" }),
        })
      ).json();
      expect(test.result).toMatchObject({
        alias: "lab",
        probe: "tcp",
      });
      expect(typeof test.result.latencyMs).toBe("number");
      // 10.0.0.2:2222 is not expected to accept TCP in CI; shape matters.
      expect(typeof test.result.ok).toBe("boolean");

      const exec = await (
        await fetch(`${base}/api/dsh-ssh/exec`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ alias: "lab", command: "uname -a" }),
        })
      ).json();
      expect(exec.result).toMatchObject({ ok: false, stdout: "" });

      const del = await (
        await fetch(`${base}/api/dsh-ssh/hosts?alias=lab`, {
          method: "DELETE",
        })
      ).json();
      expect(del.ok).toBe(true);
      const after = await (await fetch(`${base}/api/dsh-ssh/hosts`)).json();
      expect(after.hosts).toHaveLength(0);
    });
  });

  it("dsh-codex-ui preferences persist and dependencies list managed packages", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-codex-home-"));
    temps.push(home);
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withHandler(handler, async (base) => {
      const deps = await (
        await fetch(`${base}/api/dsh-codex-ui/dependencies`)
      ).json();
      expect(deps.dependencies.length).toBeGreaterThanOrEqual(10);
      expect(deps.dependencies[0]).toMatchObject({
        id: expect.any(String),
        packageName: expect.any(String),
        installed: false,
        updateAvailable: false,
      });

      const before = await (
        await fetch(`${base}/api/dsh-codex-ui/preferences`)
      ).json();
      expect(before.exists).toBe(false);
      expect(before.workspaceGroupsSupported).toBe(true);

      const put = await fetch(`${base}/api/dsh-codex-ui/preferences`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pinnedWorkspaceIds: ["ws-a", "ws-b"],
          workspaceGroups: [
            { id: "g1", name: "Work", workspaceIds: ["ws-a"] },
          ],
        }),
      });
      expect(put.ok).toBe(true);

      const after = await (
        await fetch(`${base}/api/dsh-codex-ui/preferences`)
      ).json();
      expect(after.exists).toBe(true);
      expect(after.pinnedWorkspaceIds).toEqual(["ws-a", "ws-b"]);
      expect(after.workspaceGroups[0]).toMatchObject({
        id: "g1",
        name: "Work",
      });
    });
  });

  it("remote-web-ui pair status + settings persist; context/univer/scene shapes", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-remote-home-"));
    temps.push(home);
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withHandler(handler, async (base) => {
      const status = await (await fetch(`${base}/api/pair/status`)).json();
      expect(status.phase).toBe("idle");
      expect(Array.isArray(status.lanAddresses)).toBe(true);
      expect(Array.isArray(status.devices)).toBe(true);

      const started = await (
        await fetch(`${base}/api/pair/start`, { method: "POST" })
      ).json();
      expect(started.phase).toBe("listening");
      expect(typeof started.pairCode).toBe("string");

      const claimed = await (
        await fetch(`${base}/api/pair/claim`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "phone" }),
        })
      ).json();
      expect(claimed.phase).toBe("paired");
      expect(claimed.deviceCount).toBe(1);

      const settingsPut = await fetch(`${base}/api/dsh-web-ui-settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: { theme: "dark" } }),
      });
      expect(settingsPut.ok).toBe(true);
      const settings = await (
        await fetch(`${base}/api/dsh-web-ui-settings`)
      ).json();
      expect(settings.writable).toBe(true);
      expect(settings.value).toMatchObject({ theme: "dark" });

      const detailWrap = await (
        await fetch(`${base}/api/dsh-context/detail`)
      ).json();
      expect(detailWrap.ok).toBe(true);
      expect(Array.isArray(detailWrap.value.requests)).toBe(true);
      expect(detailWrap.value.droppedNodes).toBe(0);
      expect(detailWrap.value.counts).toMatchObject({ requests: 0 });

      const pushed = await (
        await fetch(`${base}/api/dsh-context/detail`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: "s1",
            value: { droppedNodes: 2, nodes: [{ id: "n1" }] },
          }),
        })
      ).json();
      expect(pushed.ok).toBe(true);
      expect(pushed.value.droppedNodes).toBe(2);
      expect(pushed.value.nodes).toHaveLength(1);
      expect(pushed.value.rev).toBeGreaterThanOrEqual(1);

      const backfill = await (
        await fetch(`${base}/api/dsh-context/backfill`, { method: "POST" })
      ).json();
      expect(backfill.ok).toBe(true);
      expect(backfill.warmed).toBeGreaterThanOrEqual(1);

      const univer = await (await fetch(`${base}/univer-api/status`)).json();
      expect(univer.gateway.phase).toBe("stopped");
      expect(univer.unitContent).toBe("bundled");

      const frame = await fetch(`${base}/scene-frame/tok123`);
      expect(frame.ok).toBe(true);
      expect(frame.headers.get("content-type")).toMatch(/image\/png/);
      const bytes = Buffer.from(await frame.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(10);

      const progress = await (
        await fetch(`${base}/wallpaper-engine/scene-anim-progress/tok123`)
      ).json();
      expect(progress.percent).toBe(100);
    });
  });

  it("michengai update probe + automation schedules persist", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-mich-home-"));
    temps.push(home);
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withHandler(handler, async (base) => {
      const probe = await (
        await fetch(`${base}/api/michengai/dsh-automation/update`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).json();
      expect(probe.ok).toBe(true);
      expect(probe.updateAvailable).toBe(false);
      expect(probe.packageName).toContain("dsh-automation");

      const created = await (
        await fetch(`${base}/api/michengai/dsh-automation/tasks`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "morning",
            prompt: "status",
            scheduleKind: "daily",
          }),
        })
      ).json();
      expect(created.ok).toBe(true);
      expect(created.tasks).toHaveLength(1);

      const listed = await (
        await fetch(`${base}/api/michengai/dsh-automation/tasks`)
      ).json();
      expect(listed.tasks[0].name).toBe("morning");
    });
  });

  it("server-deck hosts CRUD + metrics settings persist", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-deck-home-"));
    temps.push(home);
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withHandler(handler, async (base) => {
      const created = await (
        await fetch(`${base}/server-deck/api/hosts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "edge",
            host: "192.168.1.10",
            port: 22,
            username: "ops",
            auth: "key",
          }),
        })
      ).json();
      expect(created.host).toMatchObject({
        name: "edge",
        host: "192.168.1.10",
        username: "ops",
      });

      const listed = await (
        await fetch(`${base}/server-deck/api/hosts`)
      ).json();
      expect(listed.hosts).toHaveLength(1);

      const metrics = await (
        await fetch(`${base}/server-deck/api/metrics/settings`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshSec: 15 }),
        })
      ).json();
      expect(metrics.refreshSec).toBe(15);
    });
  });

  it("agent-teams plan/halt persist; mcp-connector upserts connections", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-teams-home-"));
    temps.push(home);
    const handler = createDshCompatPublicHandler({ xrkHome: home });
    await withHandler(handler, async (base) => {
      const planned = await (
        await fetch(`${base}/plugins/dsh-agent-teams/plan`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "team-1", name: "Alpha", plan: "scout" }),
        })
      ).json();
      expect(planned.ok).toBe(true);
      expect(planned.teams[0]).toMatchObject({ id: "team-1", status: "planned" });

      const state = await (
        await fetch(`${base}/plugins/dsh-agent-teams/state`)
      ).json();
      expect(state.teams).toHaveLength(1);

      const halted = await (
        await fetch(`${base}/plugins/dsh-agent-teams/halt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "team-1" }),
        })
      ).json();
      expect(halted.teams[0].status).toBe("halted");

      const mcp = await (
        await fetch(`${base}/mcp-connector/api`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            method: "upsertConnection",
            name: "local",
            transport: "stdio",
            command: "npx demo",
          }),
        })
      ).json();
      expect(mcp.ok).toBe(true);
      expect(mcp.detail.connections).toHaveLength(1);

      const listed = await (
        await fetch(`${base}/mcp-connector/api`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "listConnections" }),
        })
      ).json();
      expect(listed.detail.connections[0].name).toBe("local");
    });
  });

  it("api/install reports missing spec without crashing", async () => {
    const handler = createDshCompatPublicHandler({});
    await withHandler(handler, async (base) => {
      const res = await (
        await fetch(`${base}/api/install`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
      ).json();
      expect(res.ok).toBe(false);
      expect(String(res.error)).toMatch(/spec/i);
    });
  });
});
