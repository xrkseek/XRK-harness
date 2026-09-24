import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCronDeliverer,
  createCronJobStore,
  createCronScheduler,
  createCronTools,
  createDefaultScriptRunner,
  createHostCron,
  isDue,
  nextRunAt,
} from "../src/index.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function tmpDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "xrk-cron-"));
  dirs.push(d);
  return d;
}

describe("nextRunAt", () => {
  it("every advances by seconds", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const next = nextRunAt({ kind: "every", everySeconds: 120 }, from);
    expect(next).toBe("2026-01-01T00:02:00.000Z");
  });

  it("at returns null when past", () => {
    expect(
      nextRunAt(
        { kind: "at", at: "2020-01-01T00:00:00.000Z" },
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("isDue respects wall clock", () => {
    expect(isDue("2020-01-01T00:00:00.000Z", new Date("2026-01-01"))).toBe(
      true,
    );
    expect(isDue("2099-01-01T00:00:00.000Z", new Date("2026-01-01"))).toBe(
      false,
    );
  });
});

describe("createCronJobStore + scheduler", () => {
  it("script job runNow + file delivery", async () => {
    const dir = tmpDir();
    const store = createCronJobStore({
      filePath: path.join(dir, "jobs.json"),
    });
    const outFile = path.join(dir, "out.jsonl");
    const job = store.create({
      name: "echo",
      schedule: { kind: "every", everySeconds: 3600 },
      run: {
        kind: "script",
        command:
          process.platform === "win32" ? "echo hello-cron" : "echo hello-cron",
      },
      delivery: { kind: "file", path: outFile },
    });
    const scheduler = createCronScheduler({
      store,
      runScript: createDefaultScriptRunner({ defaultCwd: dir }),
      deliver: createCronDeliverer({ workspaceRoot: dir }),
    });
    const result = await scheduler.runNow(job.id);
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/hello-cron/);
    const line = readFileSync(outFile, "utf8").trim();
    expect(line).toContain("cron/result");
    expect(line).toContain(job.id);
  });

  it("tick fires due agent job via injected runner", async () => {
    const dir = tmpDir();
    let now = new Date("2026-06-01T12:00:00.000Z");
    const store = createCronJobStore({
      filePath: path.join(dir, "jobs.json"),
      now: () => now,
    });
    const job = store.create({
      schedule: { kind: "at", at: "2026-06-01T12:00:00.000Z" },
      run: { kind: "agent", prompt: "ping" },
    });
    store.update(job.id, { nextRunAt: "2026-06-01T12:00:00.000Z" });
    now = new Date("2026-06-01T12:00:01.000Z");
    let ran = false;
    const scheduler = createCronScheduler({
      store,
      runScript: createDefaultScriptRunner(),
      runAgent: async () => {
        ran = true;
        return { ok: true, output: "agent-ok", sessionId: "sess_1" };
      },
      now: () => now,
    });
    const n = await scheduler.tick();
    expect(n).toBe(1);
    expect(ran).toBe(true);
    const after = store.get(job.id);
    expect(after?.enabled).toBe(false);
    expect(after?.lastStatus).toBe("ok");
  });
});

describe("createCronTools", () => {
  it("list / create via tool", async () => {
    const dir = tmpDir();
    const store = createCronJobStore({
      filePath: path.join(dir, "jobs.json"),
    });
    const scheduler = createCronScheduler({
      store,
      runScript: createDefaultScriptRunner(),
    });
    const [tool] = createCronTools(scheduler);
    const created = await tool!.execute({
      action: "create",
      schedule_kind: "every",
      every_seconds: 120,
      run_kind: "script",
      command: "echo x",
    });
    expect(created.isError).toBeFalsy();
    const listed = await tool!.execute({ action: "list" });
    expect(String(listed.content)).toContain("run=script");
  });
});

describe("createHostCron", () => {
  it("env XRK_CRON=0 forces off", () => {
    const dir = tmpDir();
    expect(
      createHostCron({
        productHome: dir,
        env: { XRK_CRON: "0" },
        product: { enabled: true },
      }),
    ).toBeUndefined();
  });

  it("env non-empty non-0 forces on over product off", () => {
    const dir = tmpDir();
    const s = createHostCron({
      productHome: dir,
      env: { XRK_CRON: "1" },
      product: { enabled: false },
    });
    expect(s).toBeDefined();
    s!.stop();
  });

  it("product.enabled false disables when env unset", () => {
    const dir = tmpDir();
    expect(
      createHostCron({
        productHome: dir,
        env: {},
        product: { enabled: false },
      }),
    ).toBeUndefined();
  });

  it("defaults on when env unset and product omitted", () => {
    const dir = tmpDir();
    const s = createHostCron({ productHome: dir, env: {} });
    expect(s).toBeDefined();
    s!.stop();
  });
});
