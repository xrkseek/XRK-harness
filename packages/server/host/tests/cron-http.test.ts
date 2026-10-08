/**
 * Cron API handler tests — unit-level against a real in-memory-backed
 * scheduler (tmp files), no network. Verifies the route table, JSON shapes,
 * auth gate, and POST pause/resume/remove.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import {
  createCronExecutionLedger,
  createCronJobStore,
  createCronScheduler,
  type CronScheduler,
} from "@xrkseek/server-cron";
import { createCronApiHandler } from "../src/cron-http.js";

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

function mockRequest(url: string, method = "GET"): IncomingMessage {
  return { url, method } as unknown as IncomingMessage;
}

function authed(req: IncomingMessage): boolean {
  const auth = (req as { headers?: { authorization?: string } }).headers?.authorization;
  return auth === "Bearer test-key";
}

function makeHandler(scheduler: CronScheduler | (() => CronScheduler | undefined)) {
  const resolveScheduler =
    typeof scheduler === "function" ? (scheduler as () => CronScheduler | undefined) : () => scheduler;
  return createCronApiHandler({ resolveScheduler, checkAuth: authed });
}

function mockResponse(): { res: ServerResponse; captured: () => Captured | undefined } {
  let captured: Captured | undefined;
  const res = {
    writeHead(status: number, headers: Record<string, unknown>) {
      captured = { status, headers: headers as Record<string, string>, body: undefined };
    },
    end(data?: unknown) {
      if (!captured) captured = { status: 200, headers: {}, body: undefined };
      if (data !== undefined) {
        try {
          captured.body = JSON.parse(String(data));
        } catch {
          captured.body = String(data);
        }
      }
    },
  } as unknown as ServerResponse;
  return { res, captured: () => captured };
}

function makeScheduler(): { scheduler: CronScheduler; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "xrk-cron-http-"));
  const store = createCronJobStore({ filePath: path.join(dir, "jobs.json") });
  const executions = createCronExecutionLedger({
    filePath: path.join(dir, "executions.jsonl"),
  });
  const scheduler = createCronScheduler({
    store,
    executions,
    runScript: async () => ({ ok: true, output: "ran" }),
    tickMs: 60_000,
  });
  const job = store.create({
    name: "hello",
    schedule: { kind: "every", everySeconds: 60 },
    run: { kind: "script", command: "echo hi" },
  });
  executions.append({
    id: "exec_1",
    jobId: job.id,
    jobName: "hello",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    status: "ok",
    outputChars: 2,
  });
  return { scheduler, dir };
}

describe("createCronApiHandler", () => {
  it("returns false for non-cron paths (falls through to Face extras)", () => {
    const { scheduler, dir } = makeScheduler();
    try {
      const handler = makeHandler(scheduler);
      const { res, captured } = mockResponse();
      expect(handler(mockRequest("/api/chat"), res)).toBe(false);
      expect(captured()).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves the job list as a whole-set snapshot", () => {
    const { scheduler, dir } = makeScheduler();
    try {
      const handler = makeHandler(scheduler);
      const { res, captured } = mockResponse();
      const req = mockRequest("/api/cron/jobs");
      (req as { headers?: Record<string, string> }).headers = { authorization: "Bearer test-key" };
      expect(handler(req, res)).toBe(true);
      const out = captured()!;
      expect(out.status).toBe(200);
      const body = out.body as { jobs: Array<{ id: string; name: string; enabled: boolean }> };
      expect(body.jobs).toHaveLength(1);
      expect(body.jobs[0].name).toBe("hello");
      expect(body.jobs[0].enabled).toBe(true);
      expect(body.jobs[0].id).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves per-job run logs with the job snapshot", () => {
    const { scheduler, dir } = makeScheduler();
    try {
      const jobId = scheduler.store.list()[0].id;
      const handler = makeHandler(scheduler);
      const { res, captured } = mockResponse();
      const req = mockRequest(`/api/cron/jobs/${jobId}/logs`);
      (req as { headers?: Record<string, string> }).headers = { authorization: "Bearer test-key" };
      expect(handler(req, res)).toBe(true);
      const out = captured()!;
      expect(out.status).toBe(200);
      const body = out.body as {
        job: { id: string };
        runs: Array<{ id: string; status: string; outputChars: number }>;
      };
      expect(body.job.id).toBe(jobId);
      expect(body.runs).toHaveLength(1);
      expect(body.runs[0].status).toBe("ok");
      expect(body.runs[0].outputChars).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("404s unknown job ids", () => {
    const { scheduler, dir } = makeScheduler();
    try {
      const handler = makeHandler(scheduler);
      const { res, captured } = mockResponse();
      const req = mockRequest("/api/cron/jobs/nope/logs");
      (req as { headers?: Record<string, string> }).headers = { authorization: "Bearer test-key" };
      expect(handler(req, res)).toBe(true);
      const out = captured()!;
      expect(out.status).toBe(404);
      expect((out.body as { error: string }).error).toContain("nope");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("POST pause / resume / remove mutate the store", () => {
    const { scheduler, dir } = makeScheduler();
    try {
      const jobId = scheduler.store.list()[0]!.id;
      const handler = makeHandler(scheduler);

      {
        const { res, captured } = mockResponse();
        const req = mockRequest(`/api/cron/jobs/${jobId}/pause`, "POST");
        (req as { headers?: Record<string, string> }).headers = {
          authorization: "Bearer test-key",
        };
        expect(handler(req, res)).toBe(true);
        const out = captured()!;
        expect(out.status).toBe(200);
        expect((out.body as { job: { enabled: boolean } }).job.enabled).toBe(
          false,
        );
        expect(scheduler.store.get(jobId)?.enabled).toBe(false);
      }

      {
        const { res, captured } = mockResponse();
        const req = mockRequest(`/api/cron/jobs/${jobId}/resume`, "POST");
        (req as { headers?: Record<string, string> }).headers = {
          authorization: "Bearer test-key",
        };
        expect(handler(req, res)).toBe(true);
        const out = captured()!;
        expect(out.status).toBe(200);
        expect((out.body as { job: { enabled: boolean } }).job.enabled).toBe(
          true,
        );
        expect(scheduler.store.get(jobId)?.enabled).toBe(true);
      }

      {
        const { res, captured } = mockResponse();
        const req = mockRequest(`/api/cron/jobs/${jobId}/remove`, "POST");
        (req as { headers?: Record<string, string> }).headers = {
          authorization: "Bearer test-key",
        };
        expect(handler(req, res)).toBe(true);
        const out = captured()!;
        expect(out.status).toBe(200);
        expect((out.body as { removed: boolean }).removed).toBe(true);
        expect(scheduler.store.get(jobId)).toBeUndefined();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unsupported methods with 405", () => {
    const { scheduler, dir } = makeScheduler();
    try {
      const handler = makeHandler(scheduler);
      const { res, captured } = mockResponse();
      const req = mockRequest("/api/cron/jobs", "PUT");
      (req as { headers?: Record<string, string> }).headers = { authorization: "Bearer test-key" };
      expect(handler(req, res)).toBe(true);
      const out = captured()!;
      expect(out.status).toBe(405);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("503s when the scheduler is absent (disabled)", () => {
    const handler = makeHandler(() => undefined);
    const { res, captured } = mockResponse();
    const req = mockRequest("/api/cron/jobs");
    (req as { headers?: Record<string, string> }).headers = { authorization: "Bearer test-key" };
    expect(handler(req, res)).toBe(true);
    const out = captured()!;
    expect(out.status).toBe(503);
    expect((out.body as { error: string }).error).toContain("not running");
  });

  it("unknown cron routes 404", () => {
    const { scheduler, dir } = makeScheduler();
    try {
      const handler = makeHandler(scheduler);
      const { res, captured } = mockResponse();
      const req = mockRequest("/api/cron/something-else");
      (req as { headers?: Record<string, string> }).headers = { authorization: "Bearer test-key" };
      expect(handler(req, res)).toBe(true);
      const out = captured()!;
      expect(out.status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("401s when the API key is missing", () => {
    const { scheduler, dir } = makeScheduler();
    try {
      const handler = makeHandler(scheduler);
      const { res, captured } = mockResponse();
      expect(handler(mockRequest("/api/cron/jobs"), res)).toBe(true);
      const out = captured()!;
      expect(out.status).toBe(401);
      expect((out.body as { error: string }).error).toBe("unauthorized");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
