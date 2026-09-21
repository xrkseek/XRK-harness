import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { nextRunAt } from "./schedule.js";
import {
  CronError,
  type CronDelivery,
  type CronJob,
  type CronJobCreateInput,
  type CronSchedule,
} from "./types.js";
import { assertSchedule } from "./schedule.js";

export interface CronJobStore {
  list(): readonly CronJob[];
  get(id: string): CronJob | undefined;
  create(input: CronJobCreateInput): CronJob;
  update(
    id: string,
    patch: Partial<{
      name: string;
      enabled: boolean;
      schedule: CronSchedule;
      run: CronJob["run"];
      delivery: CronDelivery;
      nextRunAt: string | null;
      lastRunAt: string;
      lastStatus: CronJob["lastStatus"];
      lastError: string;
      lastOutputChars: number;
    }>,
  ): CronJob;
  remove(id: string): boolean;
  reload(): void;
}

interface JobsFile {
  readonly version: 1;
  readonly jobs: CronJob[];
}

function defaultDelivery(): CronDelivery {
  return { kind: "none" };
}

function atomicWrite(filePath: string, text: string): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, filePath);
}

export function createCronJobStore(options: {
  readonly filePath: string;
  readonly now?: () => Date;
}): CronJobStore {
  const now = options.now ?? (() => new Date());
  let jobs: CronJob[] = [];

  const persist = (): void => {
    const body: JobsFile = { version: 1, jobs };
    atomicWrite(options.filePath, `${JSON.stringify(body, null, 2)}\n`);
  };

  const reload = (): void => {
    try {
      const raw = readFileSync(options.filePath, "utf8");
      const parsed = JSON.parse(raw) as JobsFile;
      if (parsed?.version !== 1 || !Array.isArray(parsed.jobs)) {
        jobs = [];
        return;
      }
      jobs = parsed.jobs.map((j) => ({ ...j }));
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (code === "ENOENT") {
        jobs = [];
        return;
      }
      throw new CronError(
        `failed to load cron jobs: ${err instanceof Error ? err.message : String(err)}`,
        "CRON_STORE",
      );
    }
  };

  reload();

  return {
    list() {
      return jobs.map((j) => ({ ...j }));
    },
    get(id) {
      const hit = jobs.find((j) => j.id === id);
      return hit ? { ...hit } : undefined;
    },
    create(input) {
      assertSchedule(input.schedule);
      if (input.run.kind === "agent" && !input.run.prompt.trim()) {
        throw new CronError("agent prompt must be non-empty", "CRON_ARGS");
      }
      if (input.run.kind === "script" && !input.run.command.trim()) {
        throw new CronError("script command must be non-empty", "CRON_ARGS");
      }
      const stamp = now().toISOString();
      const job: CronJob = {
        id: `cron_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        enabled: input.enabled !== false,
        schedule: input.schedule,
        run: input.run,
        delivery: input.delivery ?? defaultDelivery(),
        createdAt: stamp,
        updatedAt: stamp,
        nextRunAt: nextRunAt(input.schedule, now()),
      };
      jobs = [...jobs, job];
      persist();
      return { ...job };
    },
    update(id, patch) {
      const idx = jobs.findIndex((j) => j.id === id);
      if (idx < 0) {
        throw new CronError(`cron job not found: ${id}`, "CRON_NOT_FOUND");
      }
      const prev = jobs[idx]!;
      if (patch.schedule) assertSchedule(patch.schedule);
      const schedule = patch.schedule ?? prev.schedule;
      const next: CronJob = {
        ...prev,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
        ...(patch.run !== undefined ? { run: patch.run } : {}),
        ...(patch.delivery !== undefined ? { delivery: patch.delivery } : {}),
        ...(patch.nextRunAt !== undefined
          ? { nextRunAt: patch.nextRunAt }
          : patch.schedule !== undefined
            ? { nextRunAt: nextRunAt(schedule, now()) }
            : {}),
        ...(patch.lastRunAt !== undefined ? { lastRunAt: patch.lastRunAt } : {}),
        ...(patch.lastStatus !== undefined
          ? { lastStatus: patch.lastStatus }
          : {}),
        ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
        ...(patch.lastOutputChars !== undefined
          ? { lastOutputChars: patch.lastOutputChars }
          : {}),
        updatedAt: now().toISOString(),
      };
      jobs = jobs.map((j, i) => (i === idx ? next : j));
      persist();
      return { ...next };
    },
    remove(id) {
      const before = jobs.length;
      jobs = jobs.filter((j) => j.id !== id);
      if (jobs.length === before) return false;
      persist();
      return true;
    },
    reload,
  };
}

export function defaultCronJobsPath(productHome: string): string {
  return path.join(productHome, "cron", "jobs.json");
}
