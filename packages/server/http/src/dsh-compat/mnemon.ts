/**
 * Mnemon status / document CRUD under ~/.xrk/mnemon.
 * search / graph / bodies run on the stored documents (keyword + mention graph).
 * Unknown RPCs still return {@link mnemonEngineUnavailable}.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { mnemonEngineUnavailable } from "./honest-envelope.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import {
  buildMnemonGraph,
  collectMnemonEntities,
  mnemonBodies,
  relatedMnemonDocuments,
  searchMnemonDocuments,
} from "./mnemon-engine.js";
import { resolveCompatHome } from "./underlying/json-store.js";
import {
  countMnemonDocuments,
  getMnemonDocument,
  listAllMnemonDocuments,
  listMnemonDocuments,
  upsertMnemonDocument,
  type MnemonDocument,
} from "./mnemon-store.js";

export interface MnemonStatusOptions {
  readonly xrkHome?: string;
  readonly workspaceRoot?: string;
}

function area(
  kind: "runtime" | "memory-bodies" | "documents" | "state",
  root: string,
  details: Record<string, unknown>,
  itemCount = 0,
) {
  const dir =
    kind === "runtime"
      ? path.join(root, "runtime")
      : kind === "memory-bodies"
        ? path.join(root, "bodies")
        : kind === "documents"
          ? path.join(root, "documents")
          : path.join(root, "state");
  return {
    kind,
    path: dir,
    status: existsSync(dir) ? (itemCount > 0 ? "ready" : "empty") : "missing",
    itemCount,
    bytes: 0,
    details,
  };
}

function scope(
  kind: "global" | "workspace" | "custom",
  root: string,
  counts: { active: number; archived: number } = { active: 0, archived: 0 },
) {
  return {
    kind,
    root,
    available: true,
    totalBytes: 0,
    areas: [
      area("runtime", root, { userEntries: 0, memoryEntries: counts.active }),
      area(
        "memory-bodies",
        root,
        { activeBodies: counts.active, databases: 0 },
        counts.active,
      ),
      area(
        "documents",
        root,
        {
          activeDocuments: counts.active,
          archivedDocuments: counts.archived,
        },
        counts.active,
      ),
      area("state", root, { reviewLedger: false }),
    ],
  };
}

export function buildMnemonStatus(options: MnemonStatusOptions = {}): unknown {
  const home = resolveCompatHome(options.xrkHome);
  const globalRoot = path.join(home, "mnemon");
  try {
    mkdirSync(globalRoot, { recursive: true });
    mkdirSync(path.join(globalRoot, "runtime"), { recursive: true });
    mkdirSync(path.join(globalRoot, "bodies"), { recursive: true });
    mkdirSync(path.join(globalRoot, "documents"), { recursive: true });
    mkdirSync(path.join(globalRoot, "state"), { recursive: true });
  } catch {
    /* ignore */
  }

  const workspaceRoot = options.workspaceRoot
    ? path.join(options.workspaceRoot, ".xrk", "mnemon")
    : undefined;
  // Opt-in only: never auto-mkdir `{workspace}/.xrk/mnemon` (Desktop litter).
  const workspaceExists =
    workspaceRoot !== undefined && existsSync(workspaceRoot);

  const docCounts = countMnemonDocuments(home);
  const bodies = mnemonBodies(listMnemonDocuments(home));
  const scopes = [scope("global", globalRoot, docCounts)];
  if (workspaceRoot && workspaceExists) {
    scopes.push(scope("workspace", workspaceRoot));
  }

  const activeKind = workspaceExists ? "workspace" : "global";
  const activeRoot =
    scopes.find((s) => s.kind === activeKind)?.root ?? globalRoot;

  return {
    ok: true,
    ready: true,
    healthy: true,
    writeEnabled: true,
    commandFound: true,
    version: "xrk-compat",
    dshMnemonVersion: "compat",
    adapter: DSH_COMPAT_ADAPTER,
    engine: "mnemon-documents",
    memoryBodies: bodies,
    providerServices: [
      {
        providerId: "mnemon-native",
        label: "mnemon",
        enabled: true,
        status: bodies.length > 0 ? "ready" : "idle",
        activeMemoryBodyCount: bodies.length,
        memoryBodyCount: bodies.length,
      },
    ],
    stats: { totalInsights: docCounts.active },
    documents: {
      activeCount: docCounts.active,
      archivedCount: docCounts.archived,
      activeBytes: docCounts.bytes,
      limitBytes: 0,
    },
    storage: {
      activeKind,
      activeRoot,
      scopes,
    },
  };
}

export function buildMnemonVersions(): unknown {
  return {
    checkedAt: new Date().toISOString(),
    components: [
      {
        id: "mnemon",
        name: "Mnemon CLI",
        current: "xrk-compat",
        latest: "xrk-compat",
        outdated: false,
        updateSupported: false,
        installMode: "manual",
        updateHint: "manual",
      },
      {
        id: "dsh-mnemon",
        name: "dsh-mnemon",
        current: "compat",
        latest: "compat",
        outdated: false,
        updateSupported: false,
        installMode: "manual",
        updateHint: "manual",
      },
    ],
  };
}

export const MNEMON_SETTINGS_DEFAULTS: Record<string, unknown> = {
  enabled: true,
  storageScope: "workspace",
  display: { entry: "sidebar" },
  providers: {},
  adapter: DSH_COMPAT_ADAPTER,
};

export const MNEMON_UI_SETTINGS_DEFAULTS: Record<string, unknown> = {
  turnBar: true,
  saveAction: true,
};

/** Engine RPCs over stored documents (keyword search · mention graph · bodies). */
const MNEMON_ENGINE_ENDPOINTS = new Set([
  "entities",
  "search",
  "related",
  "graph",
  "bodies",
  "body-directory",
  "runtime-memory",
  "turn-activities",
]);

/** Provider catalog shape expected by dsh-mnemon settings (`catalog.providers.map`). */
export function buildMnemonProviderCatalog(): {
  readonly providers: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly items: ReadonlyArray<{
    readonly providerId: string;
    readonly enabled: boolean;
    readonly configured: boolean;
    readonly settings: Record<string, unknown>;
    readonly configuredSecrets: readonly string[];
  }>;
  readonly generatedAt: string;
} {
  return {
    providers: [{ id: "mnemon-native", label: "mnemon" }],
    items: [
      {
        providerId: "mnemon-native",
        enabled: true,
        configured: true,
        settings: {},
        configuredSecrets: [],
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

/** Task-agent model catalog: always include `groups` so UI `.find` / `[0]` never NPE.
 * Do NOT send `defaultSelection`/`effective` as JSON `null` — dsh-mnemon treats only
 * `undefined` as missing (`effective === void 0`); `null.provider` crashes the section.
 */
export function buildMnemonTaskAgentModels(): {
  readonly groups: readonly unknown[];
  readonly models: readonly unknown[];
  readonly failures: readonly unknown[];
} {
  return {
    groups: [],
    models: [],
    failures: [],
  };
}

function queryText(payload: Record<string, unknown>): string {
  for (const key of ["query", "q", "text", "prompt"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function queryLimit(payload: Record<string, unknown>, fallback = 20): number {
  const raw = payload.limit;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(50, Math.floor(raw));
  }
  return fallback;
}

function documentId(payload: Record<string, unknown>): string {
  if (typeof payload.id === "string" && payload.id.trim()) return payload.id.trim();
  if (typeof payload.documentId === "string" && payload.documentId.trim()) {
    return payload.documentId.trim();
  }
  return "";
}

/** Keyword / mention answers. No `incomplete` tag — empty `items` means no hits. */
function queryMnemonEngine(
  endpoint: string,
  docs: readonly MnemonDocument[],
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const engine = "mnemon-documents";
  const limit = queryLimit(payload);
  if (endpoint === "search") {
    const query = queryText(payload);
    return {
      ok: true,
      endpoint,
      engine,
      query,
      items: searchMnemonDocuments(docs, query, limit),
    };
  }
  if (endpoint === "entities") {
    return { ok: true, endpoint, engine, items: collectMnemonEntities(docs) };
  }
  if (endpoint === "related") {
    const id = documentId(payload);
    return {
      ok: true,
      endpoint,
      engine,
      id,
      items: relatedMnemonDocuments(docs, id, limit),
    };
  }
  if (endpoint === "graph") {
    const graph = buildMnemonGraph(docs);
    return {
      ok: true,
      endpoint,
      engine,
      nodes: graph.nodes,
      edges: graph.edges,
      items: graph.nodes,
    };
  }
  if (endpoint === "bodies") {
    const items = mnemonBodies(docs);
    return { ok: true, endpoint, engine, items, memoryBodies: items };
  }
  if (endpoint === "body-directory") {
    const items = mnemonBodies(docs).map((body) => ({
      id: body.id,
      title: body.title,
      bytes: body.bytes,
      updatedAt: body.updatedAt,
    }));
    return { ok: true, endpoint, engine, items };
  }
  if (endpoint === "runtime-memory") {
    const items = docs
      .filter((doc) => !doc.archived)
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((doc) => ({
        id: doc.id,
        title: doc.title,
        updatedAt: doc.updatedAt,
        kind: "document",
      }));
    return { ok: true, endpoint, engine, items };
  }
  const turnId =
    typeof payload.turnId === "string"
      ? payload.turnId
      : typeof payload.turn === "string"
        ? payload.turn
        : "";
  const items = turnId
    ? docs
        .filter(
          (doc) =>
            !doc.archived && `${doc.title}\n${doc.body}`.includes(turnId),
        )
        .map((doc) => ({
          id: doc.id,
          title: doc.title,
          turnId,
          updatedAt: doc.updatedAt,
        }))
    : [];
  return { ok: true, endpoint: "turn-activities", engine, turnId, items };
}

export function handleMnemonRead(
  endpoint: string,
  options: MnemonStatusOptions,
  payload: Record<string, unknown> = {},
): unknown {
  const home = options.xrkHome?.trim();
  if (endpoint === "status" || endpoint === "status-summary") {
    return buildMnemonStatus(options);
  }
  if (endpoint === "versions") return buildMnemonVersions();
  if (endpoint === "documents" || endpoint === "list") {
    return listMnemonDocuments(home);
  }
  if (MNEMON_ENGINE_ENDPOINTS.has(endpoint)) {
    return queryMnemonEngine(endpoint, listAllMnemonDocuments(home), payload);
  }
  if (endpoint === "provider-services") {
    return buildMnemonProviderCatalog();
  }
  if (endpoint === "document") {
    const id = typeof payload.id === "string" ? payload.id : "";
    return id ? getMnemonDocument(home, id) : null;
  }
  if (endpoint === "task-agent-models") {
    return buildMnemonTaskAgentModels();
  }
  return mnemonEngineUnavailable(endpoint);
}

export function handleMnemonWrite(
  endpoint: string,
  payload: Record<string, unknown>,
  options: MnemonStatusOptions = {},
): unknown {
  const home = options.xrkHome?.trim();
  // Client prefers write channel for list; must return catalog, not a single row.
  if (endpoint === "provider-services") {
    return buildMnemonProviderCatalog();
  }
  if (endpoint === "provider-service-update") {
    return {
      providerId:
        typeof payload.providerId === "string"
          ? payload.providerId
          : "mnemon-native",
      enabled: payload.enabled !== false,
      configured: true,
      settings:
        payload.settings && typeof payload.settings === "object"
          ? payload.settings
          : {},
      configuredSecrets: [],
      status: "idle",
      activeMemoryBodyCount: 0,
      memoryBodyCount: 0,
    };
  }
  if (
    endpoint === "document" ||
    endpoint === "document-upsert" ||
    endpoint === "upsert" ||
    endpoint === "save"
  ) {
    const doc = upsertMnemonDocument(home, payload);
    return { ok: true, document: doc };
  }
  if (endpoint === "pack" || endpoint === "export") {
    return {
      ok: true,
      documents: listMnemonDocuments(home),
      exportedAt: new Date().toISOString(),
    };
  }
  return { ok: false, endpoint };
}
