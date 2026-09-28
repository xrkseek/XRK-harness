/**
 * Legacy `dsh-pet` community root `/dsh-pet-7340/*`.
 * Config persists; whisper/chat/balance stay honest offline (no model dial).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";

export interface DshPetLegacyOptions {
  readonly xrkHome?: string;
}

interface PetMainConfig {
  notificationsEnabled: boolean;
  whisperImageEnabled: boolean;
  chatImageEnabled: boolean;
  pets: unknown[];
}

interface PetLegacyDoc {
  main: PetMainConfig;
  notifySeq: number;
  broadcastTs: number;
}

const DEFAULT_MAIN: PetMainConfig = {
  notificationsEnabled: true,
  whisperImageEnabled: false,
  chatImageEnabled: false,
  pets: [],
};

const STORE = createXrkDocStore<PetLegacyDoc>(["dsh-pet-7340", "config.json"], {
  main: { ...DEFAULT_MAIN, pets: [] },
  notifySeq: 0,
  broadcastTs: 0,
});

const PREFIX = "/dsh-pet-7340";

export function isDshPetLegacyPath(pathname: string): boolean {
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);
}

function defaultConfig(): PetLegacyDoc {
  return {
    main: { ...DEFAULT_MAIN, pets: [] },
    notifySeq: 0,
    broadcastTs: 0,
  };
}

function mergeMain(
  prev: PetMainConfig,
  body: Record<string, unknown>,
): PetMainConfig {
  const fromMain =
    body.main && typeof body.main === "object" && !Array.isArray(body.main)
      ? (body.main as Record<string, unknown>)
      : {};
  const src = { ...fromMain, ...body };
  return {
    notificationsEnabled:
      typeof src.notificationsEnabled === "boolean"
        ? src.notificationsEnabled
        : prev.notificationsEnabled,
    whisperImageEnabled:
      typeof src.whisperImageEnabled === "boolean"
        ? src.whisperImageEnabled
        : prev.whisperImageEnabled,
    chatImageEnabled:
      typeof src.chatImageEnabled === "boolean"
        ? src.chatImageEnabled
        : prev.chatImageEnabled,
    pets: Array.isArray(src.pets) ? src.pets : prev.pets,
  };
}

export async function handleDshPetLegacyHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: DshPetLegacyOptions = {},
): Promise<boolean> {
  if (!isDshPetLegacyPath(pathname)) return false;
  const method = httpMethod(req);
  const xrkHome = options.xrkHome;
  const rel =
    pathname === PREFIX || pathname === `${PREFIX}/`
      ? "/"
      : pathname.slice(PREFIX.length) || "/";

  if (rel === "/config/meta" || rel === "/config/meta/") {
    sendJson(res, 200, {
      ok: true,
      configPath: "dsh-pet-7340/config.json",
      home: "~/.xrk/dsh-pet-7340",
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (rel === "/config" || rel === "/config/") {
    if (method === "GET" || method === "HEAD") {
      const doc = STORE.read(xrkHome).data;
      sendJson(res, 200, {
        ok: true,
        main: doc.main,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    if (method === "PUT" || method === "POST" || method === "PATCH") {
      const body = await parseJsonBody(req);
      const next = STORE.patch(xrkHome, (current) => ({
        ...current,
        main: mergeMain(current.main, body),
      }));
      sendJson(res, 200, {
        ok: true,
        main: next.data.main,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    if (method === "DELETE") {
      await parseJsonBody(req).catch(() => ({}));
      const cleared = STORE.write(xrkHome, defaultConfig());
      sendJson(res, 200, {
        ok: true,
        main: cleared.data.main,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
  }

  if (rel === "/whisper" || rel.startsWith("/whisper/")) {
    if (method === "POST") await parseJsonBody(req).catch(() => ({}));
    sendJson(res, 200, {
      ok: false,
      reason: "provider-missing",
      message:
        "Whisper needs a live session model; not dialed from XRK dsh-compat Host.",
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (rel === "/chat" || rel.startsWith("/chat/")) {
    if (method === "POST") await parseJsonBody(req).catch(() => ({}));
    sendJson(res, 200, {
      ok: false,
      reason: "provider-missing",
      reply: "",
      message:
        "Pet chat needs a live session model; not dialed from XRK dsh-compat Host.",
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (rel === "/balance" || rel.startsWith("/balance/")) {
    if (method === "POST") await parseJsonBody(req).catch(() => ({}));
    const trigger = rel.includes("/trigger");
    sendJson(
      res,
      200,
      tag(
        {
          ok: false,
          reason: "unsupported",
          provider: "unknown",
          ...(trigger ? { count: STORE.read(xrkHome).data.notifySeq } : {}),
          adapter: DSH_COMPAT_ADAPTER,
          note: "Balance probe needs provider credentials; offline on XRK.",
        },
        ["wallet-host"],
      ),
    );
    return true;
  }

  if (rel === "/work-status" || rel.startsWith("/work-status/")) {
    sendJson(res, 200, {
      ok: true,
      state: null,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (rel === "/notify" || rel.startsWith("/notify")) {
    sendJson(res, 200, {
      ok: true,
      items: [],
      seq: STORE.read(xrkHome).data.notifySeq,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (rel === "/broadcast" || rel.startsWith("/broadcast")) {
    const doc = STORE.read(xrkHome).data;
    sendJson(res, 200, {
      ok: true,
      ts: doc.broadcastTs,
      text: "",
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await parseJsonBody(req).catch(() => ({}));
  }

  sendJson(res, 200, {
    ok: true,
    status: "ready",
    path: pathname,
    plugin: "dsh-pet",
    adapter: DSH_COMPAT_ADAPTER,
    note: "Legacy dsh-pet-7340 surface; use /api/pet for @linxin666/dsh-pet.",
  });
  return true;
}
