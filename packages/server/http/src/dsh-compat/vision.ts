/**
 * Vision toolkit + vision-router same-origin routes.
 * Settings persist under ~/.xrk/vision/; analysis hosts stay honest incomplete.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "../http-json.js";
import { sendDshErr, sendDshOk } from "./dsh-envelope.js";
import { analyzePastePayload } from "./host-feature-bridge.js";
import {
  honestReady,
  visionHostUnavailable,
} from "./honest-envelope.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { drainMutatingBody, parseJsonBody } from "./underlying/http-kit.js";

export const VISION_ROUTER_DEFAULTS: Record<string, unknown> = {
  freeFallback: true,
  visionDepth: "standard",
  timeoutMs: 120_000,
  visionTaskTimeoutMs: 45_000,
  ocrTimeoutMs: 30_000,
  downscaleMaxPixels: 8_000_000,
  cacheTtlSeconds: 3600,
  cacheMaxEntries: 128,
  providers: [],
  allowRemoteSettings: true,
};

const DEFAULT_TOOLKIT_SETTINGS = {
  enabled: false,
  note: "Vision toolkit on XRK uses file-backed settings store.",
};

export interface VisionOptions {
  readonly xrkHome?: string;
}

interface VisionToolkitDoc {
  settings: Record<string, unknown>;
}

interface VisionPasteQueueDoc {
  items: Array<{ id: string; receivedAt: string; bytes: number }>;
}

const TOOLKIT_STORE = createXrkDocStore<VisionToolkitDoc>(
  ["vision", "toolkit.json"],
  { settings: { ...DEFAULT_TOOLKIT_SETTINGS } },
);

const PASTE_QUEUE_STORE = createXrkDocStore<VisionPasteQueueDoc>(
  ["vision", "paste-queue.json"],
  { items: [] },
);

function loadToolkit(options: VisionOptions): {
  settings: Record<string, unknown>;
  revision: number;
} {
  const doc = TOOLKIT_STORE.read(options.xrkHome);
  return { settings: doc.data.settings, revision: doc.revision };
}

function saveToolkit(
  options: VisionOptions,
  settings: Record<string, unknown>,
): number {
  return TOOLKIT_STORE.write(options.xrkHome, { settings }).revision;
}

function pushPasteQueue(
  options: VisionOptions,
  bytes: number,
): VisionPasteQueueDoc {
  const doc = PASTE_QUEUE_STORE.patch(options.xrkHome, (current) => {
    const items = [
      {
        id: `paste-${Date.now()}`,
        receivedAt: new Date().toISOString(),
        bytes,
      },
      ...current.items,
    ].slice(0, 32);
    return { items };
  });
  return doc.data;
}

export async function handleVisionToolkitHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: VisionOptions = {},
): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();

  if (pathname === "/_dsh/vision-toolkit/display-config") {
    sendDshOk(res, { hidden: false, transparent: false });
    return;
  }

  if (pathname === "/_dsh/vision-toolkit/settings") {
    if (method === "GET" || method === "HEAD") {
      const row = loadToolkit(options);
      sendDshOk(res, {
        ...row.settings,
        revision: row.revision,
        adapter: "xrk-dsh-compat",
      });
      return;
    }
    if (method === "POST" || method === "PUT") {
      try {
        const body = await parseJsonBody(req);
        const next =
          body.value && typeof body.value === "object"
            ? (body.value as Record<string, unknown>)
            : body;
        const prev = loadToolkit(options);
        const revision = saveToolkit(options, { ...prev.settings, ...next });
        sendDshOk(res, { ...loadToolkit(options).settings, revision });
      } catch {
        sendDshErr(res, "invalid JSON");
      }
      return;
    }
  }

  if (pathname === "/_dsh/vision-toolkit/paste-policy") {
    sendDshOk(res, { allow: true, sameOrigin: true });
    return;
  }

  if (pathname === "/_dsh/vision-toolkit/paste-images") {
    if (method === "POST") {
      const raw = await readBody(req);
      const bytes = Buffer.byteLength(raw);
      const analysis = analyzePastePayload(raw);
      const queue = pushPasteQueue(options, bytes);
      sendDshOk(res, {
        images: analysis.images,
        queued: queue.items.length,
        bytes,
        analyzed: analysis.analyzed,
        adapter: "xrk-dsh-compat",
        note: analysis.analyzed
          ? "Paste analyzed with metadata + OCR heuristic."
          : "Paste queued; send JSON/base64 images for analysis.",
      });
      return;
    }
    sendDshOk(res, { images: [] });
    return;
  }

  if (pathname === "/_dsh/vision-toolkit/analyze-images" && method === "POST") {
    const raw = await readBody(req);
    const analysis = analyzePastePayload(raw);
    sendDshOk(res, {
      images: analysis.images,
      analyzed: analysis.analyzed,
      adapter: "xrk-dsh-compat",
      mode: "xrk-bridge",
    });
    return;
  }

  if (method === "POST" || method === "PUT") await drainMutatingBody(req);
  sendDshOk(res, honestReady({ path: pathname }));
}

export async function handleVisionRouterHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: VisionOptions = {},
): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  void options;

  if (pathname === "/_dsh/vision-router/model-capabilities") {
    sendJson(res, 200, {
      models: [
        {
          id: "xrk-local-vision",
          provider: "xrk-bridge",
          modalities: ["image", "text"],
          ocr: true,
        },
      ],
      capabilities: { ocr: true, metadata: true },
      builtinFallback: ["xrk-local-vision"],
      anonymousRpmPerModel: 8,
      ...honestReady(),
      adapter: "xrk-dsh-compat",
    });
    return;
  }
  if (pathname === "/_dsh/vision-router/test-connection") {
    sendJson(res, 200, {
      ok: true,
      connected: true,
      mode: "xrk-bridge",
      adapter: "xrk-dsh-compat",
      note: "Vision bridge with local OCR heuristic + metadata analysis.",
    });
    return;
  }
  if (pathname === "/_dsh/vision-router/analyze" && method === "POST") {
    const raw = await readBody(req);
    const analysis = analyzePastePayload(raw);
    sendJson(res, 200, {
      ok: true,
      analyzed: analysis.analyzed,
      images: analysis.images,
      mode: "xrk-bridge",
      adapter: "xrk-dsh-compat",
    });
    return;
  }
  if (pathname === "/_dsh/vision-router/settings-save-diagnostics") {
    if (method === "POST") await drainMutatingBody(req);
    sendJson(res, 200, honestReady());
    return;
  }
  if (
    pathname === "/_dsh/vision-router/update-check" ||
    pathname.startsWith("/_dsh/vision-router/update-check")
  ) {
    sendJson(res, 200, { updateAvailable: false, ...honestReady() });
    return;
  }
  if (pathname === "/_dsh/vision-router/logs") {
    if (method === "POST") await drainMutatingBody(req);
    sendJson(res, 200, { lines: [], ...honestReady() });
    return;
  }
  if (pathname === "/_dsh/vision-router/request-screenshot-permission") {
    if (method === "POST") await drainMutatingBody(req);
    sendJson(res, 200, {
      ok: true,
      granted: true,
      mode: "xrk-bridge",
      adapter: "xrk-dsh-compat",
      note: "Bridge grants analyze permission; OS capture not embedded.",
    });
    return;
  }
  if (pathname === "/_dsh/vision-router/self-update") {
    if (method === "POST") await drainMutatingBody(req);
    sendJson(res, 200, visionHostUnavailable("self-update"));
    return;
  }
  sendJson(res, 200, honestReady({ path: pathname }));
}
