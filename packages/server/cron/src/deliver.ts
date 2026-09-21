import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import type { CronDeliverer, CronJob, CronRunResult } from "./types.js";

export interface CreateCronDelivererOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly workspaceRoot?: string;
}

function resolveFilePath(jobPath: string, workspaceRoot?: string): string {
  if (path.isAbsolute(jobPath)) return jobPath;
  return path.resolve(workspaceRoot ?? process.cwd(), jobPath);
}

/** Deliver cron results to webhook and/or append-only file (Hermes-style回投). */
export function createCronDeliverer(
  options: CreateCronDelivererOptions = {},
): CronDeliverer {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (job, result) => {
    const delivery = job.delivery;
    if (delivery.kind === "none") return;

    const body = {
      hookEventName: "cron/result" as const,
      jobId: job.id,
      jobName: job.name ?? null,
      ok: result.ok,
      output: result.output.slice(0, 100_000),
      error: result.error ?? null,
      sessionId: result.sessionId ?? null,
      deliveryId: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    if (delivery.kind === "file") {
      const filePath = resolveFilePath(delivery.path, options.workspaceRoot);
      mkdirSync(path.dirname(filePath), { recursive: true });
      appendFileSync(
        filePath,
        `${JSON.stringify(body)}\n`,
        "utf8",
      );
      return;
    }

    if (delivery.kind === "webhook") {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-xrk-delivery-id": body.deliveryId,
      };
      const secretName = delivery.secretEnv?.trim();
      if (secretName) {
        const secret = env[secretName];
        if (secret) {
          const sig = createHmac("sha256", secret)
            .update(JSON.stringify(body))
            .digest("hex");
          headers["x-xrk-signature"] = `sha256=${sig}`;
        }
      }
      const timeout = AbortSignal.timeout(15_000);
      await fetchImpl(delivery.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: timeout,
      });
    }
  };
}
