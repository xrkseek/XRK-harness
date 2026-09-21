import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import type { CronScheduler } from "./scheduler.js";
import { nextRunAt } from "./schedule.js";
import {
  CronError,
  isCronError,
  type CronDelivery,
  type CronJobCreateInput,
  type CronRun,
  type CronSchedule,
} from "./types.js";
import { formatCronOutput } from "./runner.js";

function fail(err: unknown): ToolResultContent {
  const message = isCronError(err)
    ? `Error: ${err.message}`
    : `Error: ${err instanceof Error ? err.message : String(err)}`;
  return { content: message, isError: true };
}

function parseSchedule(args: Record<string, unknown>): CronSchedule {
  const kind = String(args.schedule_kind ?? args.scheduleKind ?? "").trim();
  if (kind === "every") {
    return {
      kind: "every",
      everySeconds: Number(args.every_seconds ?? args.everySeconds),
    };
  }
  if (kind === "at") {
    return { kind: "at", at: String(args.at ?? "").trim() };
  }
  if (kind === "cron") {
    return { kind: "cron", expr: String(args.cron_expr ?? args.expr ?? "").trim() };
  }
  throw new CronError(
    "schedule_kind must be every | at | cron",
    "CRON_ARGS",
  );
}

function parseRun(args: Record<string, unknown>): CronRun {
  const kind = String(args.run_kind ?? args.runKind ?? "agent").trim();
  if (kind === "script") {
    return {
      kind: "script",
      command: String(args.command ?? "").trim(),
      ...(args.cwd !== undefined ? { cwd: String(args.cwd) } : {}),
    };
  }
  return {
    kind: "agent",
    prompt: String(args.prompt ?? "").trim(),
  };
}

function parseDelivery(args: Record<string, unknown>): CronDelivery | undefined {
  const kind = String(args.delivery_kind ?? args.deliveryKind ?? "").trim();
  if (!kind || kind === "none") return { kind: "none" };
  if (kind === "webhook") {
    return {
      kind: "webhook",
      url: String(args.delivery_url ?? args.url ?? "").trim(),
      ...(args.secret_env || args.secretEnv
        ? { secretEnv: String(args.secret_env ?? args.secretEnv) }
        : {}),
    };
  }
  if (kind === "file") {
    return {
      kind: "file",
      path: String(args.delivery_path ?? args.path ?? "").trim(),
    };
  }
  throw new CronError(
    "delivery_kind must be none | webhook | file",
    "CRON_ARGS",
  );
}

export const CRON_PROMPT_TEXT =
  "Use the cronjob tool to schedule Host tasks: unattended agent turns (run_kind=agent) " +
  "or script-only jobs (run_kind=script). Deliver results with delivery_kind=webhook|file. " +
  "Actions: create, list, pause, resume, run, remove. Cron runs on the Host ticker (not OS crontab).";

/**
 * Model-facing `cronjob` tool (Hermes-style action discriminator).
 */
export function createCronTools(scheduler: CronScheduler): ToolDefinition[] {
  const tool: ToolDefinition<Record<string, unknown>> = {
    name: "cronjob",
    description:
      "Manage Host scheduled tasks. action=create|list|pause|resume|run|remove. " +
      "create needs schedule_kind (every|at|cron) and run_kind (agent|script). " +
      "Results can POST to a webhook or append to a file.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "list", "pause", "resume", "run", "remove"],
        },
        id: { type: "string", description: "Job id for pause/resume/run/remove." },
        name: { type: "string" },
        schedule_kind: {
          type: "string",
          enum: ["every", "at", "cron"],
        },
        every_seconds: { type: "number" },
        at: { type: "string", description: "ISO-8601 timestamp for schedule_kind=at." },
        cron_expr: {
          type: "string",
          description: "5-field UTC cron (min hour dom mon dow).",
        },
        run_kind: { type: "string", enum: ["agent", "script"] },
        prompt: { type: "string", description: "Agent prompt when run_kind=agent." },
        command: { type: "string", description: "Shell command when run_kind=script." },
        cwd: { type: "string" },
        delivery_kind: {
          type: "string",
          enum: ["none", "webhook", "file"],
        },
        delivery_url: { type: "string" },
        delivery_path: { type: "string" },
        secret_env: { type: "string" },
      },
      required: ["action"],
    },
    async execute(args) {
      const action = String(args?.action ?? "").trim();
      try {
        if (action === "list") {
          const jobs = scheduler.store.list();
          return {
            content:
              jobs.length === 0
                ? "No cron jobs."
                : jobs
                    .map(
                      (j) =>
                        `${j.id} enabled=${j.enabled} next=${j.nextRunAt ?? "-"} ` +
                        `run=${j.run.kind} last=${j.lastStatus ?? "-"}` +
                        (j.name ? ` name=${j.name}` : ""),
                    )
                    .join("\n"),
          };
        }
        if (action === "create") {
          const delivery = parseDelivery(args ?? {});
          const input: CronJobCreateInput = {
            schedule: parseSchedule(args ?? {}),
            run: parseRun(args ?? {}),
            ...(args?.name !== undefined ? { name: String(args.name) } : {}),
            ...(delivery !== undefined ? { delivery } : {}),
          };
          const job = scheduler.store.create(input);
          return {
            content: `created ${job.id} next=${job.nextRunAt ?? "null"}`,
          };
        }
        const id = String(args?.id ?? "").trim();
        if (!id) {
          return { content: "Error: id is required", isError: true };
        }
        if (action === "pause") {
          scheduler.store.update(id, { enabled: false });
          return { content: `paused ${id}` };
        }
        if (action === "resume") {
          const job = scheduler.store.get(id);
          if (!job) {
            return { content: `Error: not found ${id}`, isError: true };
          }
          const next = nextRunAt(job.schedule);
          scheduler.store.update(id, {
            enabled: true,
            nextRunAt: next,
          });
          return { content: `resumed ${id} next=${next}` };
        }
        if (action === "remove") {
          const ok = scheduler.store.remove(id);
          return ok
            ? { content: `removed ${id}` }
            : { content: `Error: not found ${id}`, isError: true };
        }
        if (action === "run") {
          const result = await scheduler.runNow(id);
          const job = scheduler.store.get(id);
          return {
            content: job
              ? formatCronOutput(job, result)
              : result.output || result.error || "done",
            ...(result.ok ? {} : { isError: true }),
          };
        }
        return {
          content: "Error: action must be create|list|pause|resume|run|remove",
          isError: true,
        };
      } catch (err) {
        return fail(err);
      }
    },
    isConcurrencySafe: (args) => String(args?.action ?? "") === "list",
  };
  return [tool];
}
