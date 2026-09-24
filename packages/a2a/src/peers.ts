/**
 * Resolve configured A2A peers from env (`XRK_A2A_AGENTS` JSON) or a home file.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveXrkHome } from "@xrkseek/xrk-home-paths";

export interface A2aPeerAuth {
  readonly type?: string;
  readonly token?: string;
}

export interface A2aPeer {
  readonly url: string;
  readonly auth?: A2aPeerAuth;
  readonly timeout?: number;
  readonly capabilities?: readonly string[];
  readonly tenant?: string;
}

export type A2aPeerMap = Readonly<Record<string, A2aPeer>>;

function parsePeersJson(raw: string): A2aPeerMap {
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("XRK_A2A_AGENTS must be a JSON object of name → peer");
  }
  const out: Record<string, A2aPeer> = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!name.trim() || value === null || typeof value !== "object") continue;
    const rec = value as Record<string, unknown>;
    const url = typeof rec.url === "string" ? rec.url.trim() : "";
    if (!url) continue;

    let auth: A2aPeerAuth | undefined;
    if (rec.auth !== null && typeof rec.auth === "object") {
      const authRaw = rec.auth as Record<string, unknown>;
      const type =
        typeof authRaw.type === "string" && authRaw.type.trim()
          ? authRaw.type.trim()
          : undefined;
      const token =
        typeof authRaw.token === "string" && authRaw.token.trim()
          ? authRaw.token.trim()
          : undefined;
      if (type !== undefined || token !== undefined) {
        auth = {
          ...(type !== undefined ? { type } : {}),
          ...(token !== undefined ? { token } : {}),
        };
      }
    }

    const capabilities = Array.isArray(rec.capabilities)
      ? rec.capabilities.filter((c): c is string => typeof c === "string")
      : undefined;
    const timeout = typeof rec.timeout === "number" ? rec.timeout : undefined;
    const tenant =
      typeof rec.tenant === "string" && rec.tenant.trim()
        ? rec.tenant.trim()
        : undefined;

    out[name.trim()] = {
      url,
      ...(timeout !== undefined ? { timeout } : {}),
      ...(tenant !== undefined ? { tenant } : {}),
      ...(capabilities !== undefined && capabilities.length > 0
        ? { capabilities }
        : {}),
      ...(auth !== undefined ? { auth } : {}),
    };
  }
  return out;
}

/** Load peers from `XRK_A2A_AGENTS` or `{XRK_HOME}/a2a_agents.json`. */
export function loadA2aPeers(env: NodeJS.ProcessEnv = process.env): A2aPeerMap {
  const inline = env.XRK_A2A_AGENTS?.trim();
  if (inline) {
    try {
      return parsePeersJson(inline);
    } catch (err) {
      throw new Error(
        `XRK_A2A_AGENTS: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const file =
    env.XRK_A2A_AGENTS_FILE?.trim() ||
    path.join(resolveXrkHome(env), "a2a_agents.json");
  try {
    return parsePeersJson(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Resolve a peer by configured name or accept a direct http(s) URL.
 */
export function resolveA2aPeer(
  agent: string,
  peers: A2aPeerMap = loadA2aPeers(),
): { readonly label: string; readonly peer: A2aPeer } | undefined {
  const key = agent.trim();
  if (!key) return undefined;
  if (/^https?:\/\//i.test(key)) {
    return { label: key, peer: { url: key } };
  }
  const peer = peers[key];
  if (!peer?.url) return undefined;
  return { label: key, peer };
}
