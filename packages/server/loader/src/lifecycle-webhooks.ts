/**
 * Outbound lifecycle webhooks (Hermes-style notify-only POST).
 * Never blocks turn/tool flow; failures are dropped. Distinct from inbound
 * IM / DSH webhook session spawn and from shell PreToolUse blocking hooks.
 */
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { toolNameMatches } from "./shell-hooks.js";

export const DEFAULT_LIFECYCLE_WEBHOOK_TIMEOUT_MS = 10_000;
export const MAX_LIFECYCLE_WEBHOOK_TIMEOUT_MS = 60_000;
export const MIN_LIFECYCLE_WEBHOOK_TIMEOUT_MS = 1_000;

export type LifecycleWebhookEventName =
  | "turn/start"
  | "turn/end"
  | "tool/post";

export interface LifecycleWebhookTarget {
  readonly name?: string;
  readonly url: string;
  readonly events: readonly LifecycleWebhookEventName[];
  /** Env var holding HMAC secret (never inline in the JSON file). */
  readonly secretEnv?: string;
  /** Tool-name matcher for `tool/post` only. */
  readonly matcher?: string;
  readonly timeoutMs?: number;
}

export interface LifecycleWebhookPayload {
  readonly hookEventName: LifecycleWebhookEventName;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly deliveryId: string;
  readonly timestamp: string;
  readonly turnId?: string;
  readonly toolName?: string;
  readonly toolUseId?: string;
  readonly isError?: boolean;
  readonly skippedBody?: boolean;
  readonly extra?: Record<string, unknown>;
}

export type LifecycleWebhookFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface LifecycleWebhookNotifier {
  /** Fire-and-forget; never throws to callers. */
  fire(
    payload: Omit<
      LifecycleWebhookPayload,
      "deliveryId" | "timestamp" | "sessionId" | "workspaceRoot"
    > & {
      readonly sessionId?: string;
      readonly workspaceRoot?: string;
    },
  ): void;
  fireToolPost(args: {
    readonly toolName: string;
    readonly toolUseId: string;
    readonly isError: boolean;
    readonly skippedBody: boolean;
  }): void;
}

export interface CreateLifecycleWebhookNotifierOptions {
  readonly targets: readonly LifecycleWebhookTarget[];
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: LifecycleWebhookFetch;
  readonly now?: () => Date;
}

const KNOWN_EVENTS = new Set<string>(["turn/start", "turn/end", "tool/post"]);

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function clampTimeoutMs(raw: unknown): number {
  const n =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.floor(raw)
      : DEFAULT_LIFECYCLE_WEBHOOK_TIMEOUT_MS;
  return Math.min(
    MAX_LIFECYCLE_WEBHOOK_TIMEOUT_MS,
    Math.max(MIN_LIFECYCLE_WEBHOOK_TIMEOUT_MS, n),
  );
}

/**
 * Parse `{ outbound: [...] }` or Hermes-shaped `{ hooks: { outbound: [...] } }`.
 * Malformed entries are skipped (never throws).
 */
export function parseLifecycleWebhooks(raw: unknown): LifecycleWebhookTarget[] {
  const root = asObject(raw);
  if (!root) return [];
  const hooks = asObject(root.hooks);
  const list = Array.isArray(root.outbound)
    ? root.outbound
    : Array.isArray(hooks?.outbound)
      ? hooks.outbound
      : [];
  const out: LifecycleWebhookTarget[] = [];
  for (const item of list) {
    const row = asObject(item);
    if (!row) continue;
    if (typeof row.url !== "string" || !row.url.trim()) continue;
    let url: string;
    try {
      const parsed = new URL(row.url.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      url = parsed.href;
    } catch {
      continue;
    }
    const eventsRaw = Array.isArray(row.events) ? row.events : [];
    const events = eventsRaw.filter(
      (e): e is LifecycleWebhookEventName =>
        typeof e === "string" && KNOWN_EVENTS.has(e),
    );
    if (events.length === 0) continue;
    const timeoutMs =
      row.timeoutMs !== undefined
        ? clampTimeoutMs(row.timeoutMs)
        : typeof row.timeout === "number"
          ? clampTimeoutMs(row.timeout * 1000)
          : undefined;
    out.push({
      url,
      events,
      ...(typeof row.name === "string" && row.name.trim()
        ? { name: row.name.trim() }
        : {}),
      ...(typeof row.secretEnv === "string" && row.secretEnv.trim()
        ? { secretEnv: row.secretEnv.trim() }
        : typeof row.secret_env === "string" && row.secret_env.trim()
          ? { secretEnv: row.secret_env.trim() }
          : {}),
      ...(typeof row.matcher === "string" ? { matcher: row.matcher } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
  }
  return out;
}

/** Read webhooks.json paths; missing / malformed files contribute nothing. */
export function loadLifecycleWebhooks(
  paths: readonly string[],
): LifecycleWebhookTarget[] {
  const out: LifecycleWebhookTarget[] = [];
  for (const filePath of paths) {
    try {
      const text = readFileSync(filePath, "utf8");
      out.push(...parseLifecycleWebhooks(JSON.parse(text) as unknown));
    } catch {
      // Absent or invalid config must not abort agent composition.
    }
  }
  return out;
}

/** Default paths: product home then workspace `.xrk/webhooks.json`. */
export function defaultLifecycleWebhookPaths(
  workspaceRoot: string,
  productHome: string,
): string[] {
  return [
    path.join(productHome, "webhooks.json"),
    path.join(workspaceRoot, ".xrk", "webhooks.json"),
  ];
}

function signBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Notify-only POST notifier. `XRK_SAFE_MODE=1` → empty targets (no registration).
 */
export function createLifecycleWebhookNotifier(
  options: CreateLifecycleWebhookNotifierOptions,
): LifecycleWebhookNotifier {
  const env = options.env ?? process.env;
  const targets =
    env.XRK_SAFE_MODE === "1" || env.XRK_SAFE_MODE === "true"
      ? []
      : options.targets;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => new Date());

  const deliver = async (
    target: LifecycleWebhookTarget,
    payload: LifecycleWebhookPayload,
  ): Promise<void> => {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "xrk-harness-outbound-webhook",
      "x-xrk-event": payload.hookEventName,
      "x-xrk-delivery": payload.deliveryId,
    };
    if (target.secretEnv) {
      const secret = env[target.secretEnv];
      if (typeof secret === "string" && secret.length > 0) {
        headers["x-xrk-signature-256"] = signBody(body, secret);
      }
    }
    const timeoutMs = target.timeoutMs ?? DEFAULT_LIFECYCLE_WEBHOOK_TIMEOUT_MS;
    await fetchImpl(target.url, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  };

  const fire: LifecycleWebhookNotifier["fire"] = (partial) => {
    if (targets.length === 0) return;
    const payload: LifecycleWebhookPayload = {
      hookEventName: partial.hookEventName,
      sessionId: partial.sessionId ?? options.sessionId,
      workspaceRoot: partial.workspaceRoot ?? options.workspaceRoot,
      deliveryId: randomUUID(),
      timestamp: now().toISOString(),
      ...(partial.turnId !== undefined ? { turnId: partial.turnId } : {}),
      ...(partial.toolName !== undefined ? { toolName: partial.toolName } : {}),
      ...(partial.toolUseId !== undefined
        ? { toolUseId: partial.toolUseId }
        : {}),
      ...(partial.isError !== undefined ? { isError: partial.isError } : {}),
      ...(partial.skippedBody !== undefined
        ? { skippedBody: partial.skippedBody }
        : {}),
      ...(partial.extra !== undefined ? { extra: partial.extra } : {}),
    };
    for (const target of targets) {
      if (!target.events.includes(payload.hookEventName)) continue;
      if (
        payload.hookEventName === "tool/post" &&
        payload.toolName !== undefined &&
        !toolNameMatches(target.matcher, payload.toolName)
      ) {
        continue;
      }
      void deliver(target, payload).catch(() => {
        // Fail-open: never surface to the agent turn.
      });
    }
  };

  return {
    fire,
    fireToolPost(args) {
      fire({
        hookEventName: "tool/post",
        toolName: args.toolName,
        toolUseId: args.toolUseId,
        isError: args.isError,
        skippedBody: args.skippedBody,
      });
    },
  };
}
