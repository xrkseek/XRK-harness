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
  archiveMnemonDocument,
  countMnemonDocuments,
  deleteMnemonDocument,
  getMnemonDocument,
  importMnemonDocuments,
  listAllMnemonDocuments,
  listMnemonDocuments,
  upsertMnemonDocument,
  type MnemonDocument,
} from "./mnemon-store.js";

/** Soft active-byte cap for capacity-plan (document engine, not Mnemon CLI). */
const DOCUMENTS_ACTIVE_LIMIT_BYTES = 32 * 1024 * 1024;

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

/** View-protocol settings (`/dsh-mnemon-view-settings`, ns `mnemon-view`). */
export const MNEMON_VIEW_SETTINGS_DEFAULTS: Record<string, unknown> = {
  displayMode: "sidebar",
  entry: "sidebar",
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
  return { ok: true, endpoint, engine, items: [] };
}

function docBytes(doc: MnemonDocument): number {
  return (
    Buffer.byteLength(doc.body, "utf8") + Buffer.byteLength(doc.title, "utf8")
  );
}

function snapshotDocument(doc: MnemonDocument) {
  const status = doc.archived ? "archived" : "active";
  const filename = `${doc.id}.md`;
  return {
    id: doc.id,
    title: doc.title || doc.id,
    description: doc.body.slice(0, 240),
    status,
    filename,
    relativePath: `documents/${status}/${filename}`,
    sourcePaths: [] as string[],
    memoryBodyIds: doc.archived ? ([] as string[]) : [doc.id],
    revision: 1,
    contentHash: `${doc.updatedAt}:${docBytes(doc)}`,
    sizeBytes: docBytes(doc),
    ...(doc.archived ? { archivedAt: doc.updatedAt } : {}),
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
    body: doc.body,
  };
}

function buildDocumentsSnapshot(home: string | undefined) {
  const docs = listAllMnemonDocuments(home);
  const documents = docs.map(snapshotDocument);
  const activeBytes = documents
    .filter((d) => d.status === "active")
    .reduce((sum, d) => sum + d.sizeBytes, 0);
  return {
    version: 1,
    documents,
    items: documents.filter((d) => d.status === "active"),
    activeBytes,
    limitBytes: DOCUMENTS_ACTIVE_LIMIT_BYTES,
    generatedAt: new Date().toISOString(),
  };
}

function buildCapacityPlan(
  home: string | undefined,
  payload: Record<string, unknown>,
) {
  const snapshot = buildDocumentsSnapshot(home);
  const projected =
    typeof payload.projected === "number" && Number.isFinite(payload.projected)
      ? Math.max(0, Math.floor(payload.projected))
      : snapshot.activeBytes;
  const limit =
    typeof payload.limit === "number" && Number.isFinite(payload.limit)
      ? Math.max(1, Math.floor(payload.limit))
      : DOCUMENTS_ACTIVE_LIMIT_BYTES;
  const candidates = snapshot.documents
    .filter((d) => d.status === "active")
    .slice()
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  return {
    fits: projected <= limit,
    projected,
    limit,
    candidates,
    revision: snapshot.documents.length,
  };
}

function buildMaintenancePlan(
  home: string | undefined,
  payload: Record<string, unknown>,
) {
  const counts = countMnemonDocuments(home);
  const active = listMnemonDocuments(home);
  const revision =
    typeof payload.expectedRevision === "number"
      ? Math.floor(payload.expectedRevision)
      : counts.active + counts.archived;
  const over =
    counts.bytes > DOCUMENTS_ACTIVE_LIMIT_BYTES ||
    payload.force === true;
  return {
    revision,
    requiresMaintenance: over,
    entries: over
      ? active
          .slice()
          .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
          .slice(0, 12)
          .map((doc) => ({
            id: doc.id,
            title: doc.title,
            sizeBytes: docBytes(doc),
            updatedAt: doc.updatedAt,
          }))
      : [],
  };
}

function buildPrepareBodyPlacement(payload: Record<string, unknown>) {
  const name =
    typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim()
      : "memory-body";
  const description =
    typeof payload.description === "string" ? payload.description : "";
  return {
    prompt: `Place memory body "${name}"`,
    selectorBrief: description.slice(0, 400) || "default mnemon-native provider",
    candidates: [{ id: "mnemon-native", label: "mnemon" }],
    name,
    description,
  };
}

function buildFinalizePlacement(payload: Record<string, unknown>) {
  const prepared =
    payload.prepared && typeof payload.prepared === "object"
      ? (payload.prepared as Record<string, unknown>)
      : {};
  const selection =
    payload.selection && typeof payload.selection === "object"
      ? (payload.selection as Record<string, unknown>)
      : {};
  const providerId =
    typeof selection.providerId === "string" && selection.providerId.trim()
      ? selection.providerId.trim()
      : "mnemon-native";
  return {
    providerId,
    reason:
      typeof selection.reason === "string" && selection.reason.trim()
        ? selection.reason.trim()
        : "compat-default",
    confidence:
      typeof selection.confidence === "string" ? selection.confidence : "high",
    prepared,
  };
}

function buildMetadataSample(
  home: string | undefined,
  payload: Record<string, unknown>,
) {
  const id =
    typeof payload.memoryBodyId === "string"
      ? payload.memoryBodyId
      : typeof payload.id === "string"
        ? payload.id
        : "";
  const doc = id ? getMnemonDocument(home, id) : null;
  const evidence = doc
    ? [
        {
          category: "document",
          entities: collectMnemonEntities([doc]).map((e) => e.label),
          content: `${doc.title}\n${doc.body}`.slice(0, 1200),
        },
      ]
    : [];
  return {
    memoryBodyId: id || "unknown",
    evidence,
  };
}

/** Client turn-activity projection — `{ cursor, activities }` (rpcOk wraps as value). */
function buildTurnActivities(payload: Record<string, unknown>) {
  const sessionId =
    typeof payload.sessionId === "string" ? payload.sessionId : "";
  return {
    cursor: 0,
    activities: [] as Array<{ turn: number; sessionId?: string }>,
    sessionId,
  };
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
  if (endpoint === "snapshot") {
    return buildDocumentsSnapshot(home);
  }
  if (endpoint === "capacity-plan") {
    return buildCapacityPlan(home, payload);
  }
  if (endpoint === "maintenance-plan") {
    return buildMaintenancePlan(home, payload);
  }
  if (endpoint === "prepare-body-placement") {
    return buildPrepareBodyPlacement(payload);
  }
  if (endpoint === "finalize-placement") {
    return buildFinalizePlacement(payload);
  }
  if (endpoint === "metadata-sample") {
    return buildMetadataSample(home, payload);
  }
  if (endpoint === "turn-activities" || endpoint === "turn-activity") {
    const snap = buildTurnActivities(payload);
    if (endpoint === "turn-activity") {
      const turn =
        typeof payload.turn === "number"
          ? payload.turn
          : Number(payload.turn);
      return (
        snap.activities.find((activity) => activity.turn === turn) ?? null
      );
    }
    return snap;
  }
  if (MNEMON_ENGINE_ENDPOINTS.has(endpoint)) {
    return queryMnemonEngine(endpoint, listAllMnemonDocuments(home), payload);
  }
  if (endpoint === "provider-services") {
    return buildMnemonProviderCatalog();
  }
  if (endpoint === "document") {
    const id = typeof payload.id === "string" ? payload.id : "";
    const doc = id ? getMnemonDocument(home, id) : null;
    return doc ? snapshotDocument(doc) : null;
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
    endpoint === "save" ||
    endpoint === "write" ||
    endpoint === "body-create" ||
    endpoint === "body-update" ||
    endpoint === "body-merge"
  ) {
    if (
      endpoint === "document" &&
      (payload.action === "archive" || payload.action === "forget")
    ) {
      const id =
        typeof payload.id === "string"
          ? payload.id
          : typeof payload.documentId === "string"
            ? payload.documentId
            : "";
      const archived = id ? archiveMnemonDocument(home, id) : null;
      return {
        ok: Boolean(archived),
        action: archived ? "forgotten" : "missing",
        document: archived,
        maintenance: { memoryBodyIds: archived ? [archived.id] : [] },
      };
    }
    const request =
      payload.request && typeof payload.request === "object"
        ? (payload.request as Record<string, unknown>)
        : payload;
    const doc = upsertMnemonDocument(home, {
      ...request,
      ...(typeof request.name === "string" && !request.title
        ? { title: request.name }
        : {}),
      ...(typeof request.description === "string" && !request.body
        ? { body: request.description }
        : {}),
    });
    return { ok: true, document: doc, action: "written" };
  }
  if (
    endpoint === "archive" ||
    endpoint === "forget" ||
    endpoint === "body-delete" ||
    endpoint === "delete"
  ) {
    const id =
      typeof payload.id === "string"
        ? payload.id
        : typeof payload.documentId === "string"
          ? payload.documentId
          : typeof payload.memoryBodyId === "string"
            ? payload.memoryBodyId
            : "";
    if (endpoint === "body-delete" || endpoint === "delete") {
      const removed = id ? deleteMnemonDocument(home, id) : false;
      return {
        ok: removed,
        action: removed ? "forgotten" : "missing",
        id,
        summary: removed ? "" : "document not found",
      };
    }
    const archived = id ? archiveMnemonDocument(home, id) : null;
    return {
      ok: Boolean(archived),
      action: archived ? "forgotten" : "missing",
      document: archived,
      summary: archived ? "" : "document not found",
      maintenance: { memoryBodyIds: archived ? [archived.id] : [] },
    };
  }
  if (endpoint === "import") {
    const rows = Array.isArray(payload.documents)
      ? (payload.documents as Record<string, unknown>[])
      : Array.isArray(payload.items)
        ? (payload.items as Record<string, unknown>[])
        : [];
    const documents = importMnemonDocuments(home, rows);
    return {
      ok: true,
      mode: "merge",
      imported: documents.length,
      documents,
    };
  }
  if (endpoint === "link") {
    return {
      ok: true,
      action: "linked",
      from:
        typeof payload.from === "string"
          ? payload.from
          : typeof payload.id === "string"
            ? payload.id
            : "",
      to: typeof payload.to === "string" ? payload.to : "",
    };
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
