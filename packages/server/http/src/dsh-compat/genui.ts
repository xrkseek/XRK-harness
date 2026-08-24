/**
 * dsh-genui — file-backed design library under ~/.xrk/genui.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { sendJson } from "./underlying/http-json.js";
import { renderGenuiFromSchema } from "./host-feature-bridge.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { parseJsonBody } from "./underlying/http-kit.js";

export interface GenuiOptions {
  readonly xrkHome?: string;
}

interface GenuiDesign {
  id: string;
  name: string;
  schema: Record<string, unknown>;
  updatedAt: string;
}

interface GenuiStore {
  defaultDesignId: string | null;
  designs: GenuiDesign[];
}

const GENUI_STORE = createXrkDocStore<GenuiStore>(
  ["genui", "designs.json"],
  { defaultDesignId: null, designs: [] },
);

function loadStore(options: GenuiOptions): GenuiStore {
  const doc = GENUI_STORE.read(options.xrkHome);
  return {
    defaultDesignId: doc.data.defaultDesignId ?? null,
    designs: Array.isArray(doc.data.designs) ? doc.data.designs : [],
  };
}

function saveStore(options: GenuiOptions, store: GenuiStore): number {
  return GENUI_STORE.write(options.xrkHome, store).revision;
}

function parseDesignInput(raw: unknown): GenuiDesign | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const now = new Date().toISOString();
  const id =
    typeof row.id === "string" && row.id.trim()
      ? row.id.trim()
      : randomUUID();
  return {
    id,
    name: typeof row.name === "string" ? row.name : "design",
    schema:
      row.schema && typeof row.schema === "object"
        ? (row.schema as Record<string, unknown>)
        : {},
    updatedAt: now,
  };
}

function mergeImportedDesigns(
  store: GenuiStore,
  body: Record<string, unknown>,
): GenuiStore {
  const next: GenuiStore = {
    defaultDesignId: store.defaultDesignId,
    designs: [...store.designs],
  };
  const rows = Array.isArray(body.designs) ? body.designs : [];
  for (const raw of rows) {
    const design = parseDesignInput(raw);
    if (!design) continue;
    const idx = next.designs.findIndex((d) => d.id === design.id);
    if (idx >= 0) {
      next.designs[idx] = design;
    } else {
      next.designs.push(design);
    }
    if (!next.defaultDesignId) next.defaultDesignId = design.id;
  }
  const single = parseDesignInput(body.design ?? body);
  if (single && rows.length === 0) {
    const idx = next.designs.findIndex((d) => d.id === single.id);
    if (idx >= 0) next.designs[idx] = single;
    else next.designs.push(single);
    if (!next.defaultDesignId) next.defaultDesignId = single.id;
  }
  return next;
}

export async function handleGenuiHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: GenuiOptions,
): Promise<boolean> {
  if (
    pathname !== "/.well-known/dsh-genui" &&
    !pathname.startsWith("/_dsh/genui/") &&
    pathname !== "/import" &&
    pathname !== "/default" &&
    !pathname.startsWith("/preview/")
  ) {
    return false;
  }
  const method = (req.method ?? "GET").toUpperCase();
  let store = loadStore(options);

  if (pathname === "/import") {
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const body = await parseJsonBody(req);
      store = mergeImportedDesigns(store, body);
      saveStore(options, store);
      sendJson(res, 200, {
        ok: true,
        designs: store.designs,
        default_design_id: store.defaultDesignId,
        imported: true,
        adapter: "xrk-dsh-compat",
      });
      return true;
    }
    sendJson(
      res,
      200,
      {
        designs: store.designs,
        default_design_id: store.defaultDesignId,
        adapter: "xrk-dsh-compat",
      },
    );
    return true;
  }

  if (pathname === "/default") {
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const body = await parseJsonBody(req);
      const designId =
        typeof body.design_id === "string"
          ? body.design_id
          : typeof body.default_design_id === "string"
            ? body.default_design_id
            : typeof body.id === "string"
              ? body.id
              : "";
      if (
        designId &&
        store.designs.some((d) => d.id === designId)
      ) {
        store.defaultDesignId = designId;
        saveStore(options, store);
      }
      sendJson(res, 200, {
        ok: true,
        default_design_id: store.defaultDesignId,
        designs: store.designs,
      });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      default_design_id: store.defaultDesignId,
      designs: store.designs,
    });
    return true;
  }

  const previewMatch = /^\/preview\/([^/]+)$/.exec(pathname);
  if (previewMatch) {
    const id = decodeURIComponent(previewMatch[1]!);
    const design = store.designs.find((d) => d.id === id);
    if (method === "GET" || method === "HEAD") {
      if (!design) {
        sendJson(res, 404, { ok: false, error: "design-not-found", id });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        design,
        schema: design.schema,
        preview: "schema-only",
      });
      return true;
    }
    if (method === "POST" || method === "PUT") {
      const rendered = renderGenuiFromSchema(design?.schema ?? {});
      sendJson(res, 200, {
        ok: true,
        design_id: id,
        design: design ?? null,
        preview: rendered.preview,
        tree: rendered.tree,
        html: rendered.html,
        reactTree: rendered.reactTree,
        componentRegistry: rendered.componentRegistry,
        rendered: true,
        live: rendered.live,
        adapter: "xrk-dsh-compat",
        note: "Cordis-compatible React tree + HTML preview via XRK bridge.",
      });
      return true;
    }
    return true;
  }

  if (pathname === "/.well-known/dsh-genui") {
    sendJson(res, 200, { route_prefix: "/_dsh/genui" });
    return true;
  }

  if (pathname === "/_dsh/genui/manage/designs") {
    if (method === "GET") {
      sendJson(res, 200, {
        designs: store.designs,
        default_design_id: store.defaultDesignId,
      });
      return true;
    }
    if (method === "POST") {
      const body = await parseJsonBody(req);
      const now = new Date().toISOString();
      const design: GenuiDesign = {
        id: randomUUID(),
        name: typeof body.name === "string" ? body.name : "design",
        schema:
          body.schema && typeof body.schema === "object"
            ? (body.schema as Record<string, unknown>)
            : {},
        updatedAt: now,
      };
      store.designs.push(design);
      if (!store.defaultDesignId) store.defaultDesignId = design.id;
      saveStore(options, store);
      sendJson(res, 201, { ok: true, design });
      return true;
    }
  }

  const designMatch = /^\/_dsh\/genui\/manage\/designs\/([^/]+)$/.exec(pathname);
  if (designMatch) {
    const id = decodeURIComponent(designMatch[1]!);
    const idx = store.designs.findIndex((d) => d.id === id);
    if (method === "DELETE" && idx >= 0) {
      store.designs.splice(idx, 1);
      if (store.defaultDesignId === id) {
        store.defaultDesignId = store.designs[0]?.id ?? null;
      }
      saveStore(options, store);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if ((method === "PUT" || method === "PATCH") && idx >= 0) {
      const body = await parseJsonBody(req);
      const row = store.designs[idx]!;
      if (typeof body.name === "string") row.name = body.name;
      if (body.schema && typeof body.schema === "object") {
        row.schema = body.schema as Record<string, unknown>;
      }
      row.updatedAt = new Date().toISOString();
      store.designs[idx] = row;
      saveStore(options, store);
      sendJson(res, 200, { ok: true, design: row });
      return true;
    }
    if (method === "GET" && idx >= 0) {
      sendJson(res, 200, { design: store.designs[idx] });
      return true;
    }
  }

  sendJson(res, 200, {
    designs: store.designs,
    default_design_id: store.defaultDesignId,
  });
  return true;
}

export function isGenuiPath(pathname: string): boolean {
  return (
    pathname === "/.well-known/dsh-genui" ||
    pathname.startsWith("/_dsh/genui/") ||
    pathname === "/import" ||
    pathname === "/default" ||
    pathname.startsWith("/preview/")
  );
}
