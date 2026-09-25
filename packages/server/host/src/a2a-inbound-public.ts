/**
 * Optional A2A inbound public routes (Agent Card + message/send).
 * Enabled when Settings `a2a-inbound.enabled` or env `XRK_A2A_INBOUND=1`
 * (non-empty env is CI bypass: `0` force off, other values force on).
 *
 * When a Face runtime is passed, `message/send` admits into a Face session
 * (Hermes live-session injection subset): framed peer text → `session.prompt`,
 * then wait for the next assistant body (timeout via product/env).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readSessionEvents } from "@xrkseek/core-session";
import {
  createA2aInboundHandler,
  wrapA2aInboundText,
} from "@xrkseek/a2a";
import {
  dispatchFaceMethod,
  lastAssistantBodyText,
  type FaceRuntime,
} from "@xrkseek/server-face";

function envOn(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Product Settings `a2a-inbound` (Face namespace). */
export interface A2aInboundProductSettings {
  readonly enabled?: boolean;
  /** Pin Face session id; empty → `a2a-<contextId>`. */
  readonly sessionId?: string;
  /** Wait for assistant body (ms). */
  readonly timeoutMs?: number;
}

/**
 * Resolve whether A2A inbound routes are live.
 * Non-empty `XRK_A2A_INBOUND` wins (CI bypass); else product `enabled`.
 */
export function resolveA2aInboundEnabled(
  env: NodeJS.ProcessEnv = process.env,
  product?: A2aInboundProductSettings,
): boolean {
  const raw = String(env.XRK_A2A_INBOUND ?? "").trim();
  if (raw !== "") return envOn(raw);
  return product?.enabled === true;
}

function inboundTimeoutMs(
  env: NodeJS.ProcessEnv,
  product?: A2aInboundProductSettings,
): number {
  const fromProduct = product?.timeoutMs;
  if (
    typeof fromProduct === "number" &&
    Number.isFinite(fromProduct) &&
    fromProduct >= 1_000
  ) {
    return Math.min(fromProduct, 600_000);
  }
  const n = Number(env.XRK_A2A_INBOUND_TIMEOUT_MS ?? "");
  if (Number.isFinite(n) && n >= 1_000) return Math.min(n, 600_000);
  return 120_000;
}

/** Stable Face session id for an A2A context (Hermes `a2a-{slug}` style). */
export function a2aInboundSessionId(
  contextId: string,
  env: NodeJS.ProcessEnv = process.env,
  product?: A2aInboundProductSettings,
): string {
  const pinned =
    env.XRK_A2A_INBOUND_SESSION?.trim() || product?.sessionId?.trim();
  if (pinned) return pinned;
  const slug =
    contextId
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "default";
  return `a2a-${slug}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureA2aSession(
  face: FaceRuntime,
  sessionId: string,
  peer: string,
): Promise<void> {
  const created = await dispatchFaceMethod(
    face,
    "session.create",
    `a2a-c-${Date.now().toString(36)}`,
    {
      sessionId,
      label: `a2a:${peer}`,
    },
  );
  if (created.result.ok) return;
  if (face.store.has(sessionId)) return;
  throw new Error(
    created.result.ok === false
      ? created.result.error.message
      : `session.create failed for ${sessionId}`,
  );
}

/**
 * Admit framed A2A text into Face and return the next assistant body
 * (or a timeout / empty-turn note).
 */
export async function admitA2aInboundToFace(
  face: FaceRuntime,
  input: {
    readonly text: string;
    readonly contextId: string;
    readonly taskId: string;
    readonly peer: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly product?: A2aInboundProductSettings;
  },
): Promise<string> {
  const env = input.env ?? process.env;
  const product = input.product;
  const sessionId = a2aInboundSessionId(input.contextId, env, product);
  const framed = wrapA2aInboundText(input.peer, input.text);
  await ensureA2aSession(face, sessionId, input.peer);

  const beforeLen = readSessionEvents(face.store, sessionId).length;
  const prompted = await dispatchFaceMethod(
    face,
    "session.prompt",
    `a2a-p-${input.taskId}`,
    {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: framed }],
    },
  );
  if (!prompted.result.ok) {
    throw new Error(
      prompted.result.ok === false
        ? prompted.result.error.message
        : `session.prompt failed for ${sessionId}`,
    );
  }

  const timeoutMs = inboundTimeoutMs(env, product);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reply = lastAssistantBodyText(
      readSessionEvents(face.store, sessionId).slice(beforeLen),
    );
    if (reply) return reply;
    await sleep(150);
  }
  const late = lastAssistantBodyText(
    readSessionEvents(face.store, sessionId).slice(beforeLen),
  );
  if (late) return late;
  return (
    `[A2A] Face session ${sessionId} had no assistant reply within ` +
    `${timeoutMs}ms (task ${input.taskId}; peer ${input.peer})`
  );
}

export function createA2aInboundPublicHandler(options?: {
  readonly env?: NodeJS.ProcessEnv;
  readonly host?: string;
  readonly port?: number;
  /** When set, message/send injects into Face (otherwise persist + echo). */
  readonly face?: FaceRuntime;
  /** Live Settings `a2a-inbound` (re-read each request). */
  readonly resolveProduct?: () => A2aInboundProductSettings | undefined;
}): (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean> {
  const env = options?.env ?? process.env;
  const host = (options?.host ?? env.XRK_A2A_PUBLIC_HOST ?? "127.0.0.1").trim();
  const port =
    options?.port ??
    (Number(env.XRK_A2A_PUBLIC_PORT) || Number(env.PORT) || 0);
  const base =
    env.XRK_A2A_PUBLIC_URL?.trim() ||
    (port > 0 ? `http://${host}:${port}/a2a` : `http://${host}/a2a`);
  const face = options?.face;

  let inner:
    | ((
        req: IncomingMessage,
        res: ServerResponse,
      ) => boolean | Promise<boolean>)
    | undefined;

  const ensureInner = () => {
    if (inner) return inner;
    inner = createA2aInboundHandler({
      url: base,
      env,
      name: env.XRK_A2A_AGENT_NAME?.trim() || "XRK Harness",
      description: face
        ? "XRK Host A2A inbound — message/send admits into a Face session."
        : "XRK Host A2A inbound (Agent Card + message/send). Face session injection optional.",
      ...(face
        ? {
            onMessage: (msg) => {
              const product = options?.resolveProduct?.();
              return admitA2aInboundToFace(face, {
                ...msg,
                env,
                ...(product ? { product } : {}),
              });
            },
          }
        : {}),
    });
    return inner;
  };

  return async (req, res) => {
    const product = options?.resolveProduct?.();
    if (!resolveA2aInboundEnabled(env, product)) return false;
    return ensureInner()(req, res);
  };
}
