/**
 * Optional A2A inbound public routes (Agent Card + message/send).
 * Enabled when `XRK_A2A_INBOUND=1` (or `true` / `yes`).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createA2aInboundHandler } from "@xrkseek/a2a";

function envOn(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function createA2aInboundPublicHandler(options?: {
  readonly env?: NodeJS.ProcessEnv;
  readonly host?: string;
  readonly port?: number;
}): (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean> {
  const env = options?.env ?? process.env;
  if (!envOn(env.XRK_A2A_INBOUND)) {
    return async () => false;
  }
  const host = (options?.host ?? env.XRK_A2A_PUBLIC_HOST ?? "127.0.0.1").trim();
  const port =
    options?.port ??
    (Number(env.XRK_A2A_PUBLIC_PORT) || Number(env.PORT) || 0);
  const base =
    env.XRK_A2A_PUBLIC_URL?.trim() ||
    (port > 0 ? `http://${host}:${port}/a2a` : `http://${host}/a2a`);
  return createA2aInboundHandler({
    url: base,
    env,
    name: env.XRK_A2A_AGENT_NAME?.trim() || "XRK Harness",
  });
}
