/**
 * Mnemon status / storage shapes + RPC handlers.
 * Not a real memory engine — honest stubs under ~/.xrk/mnemon.
 */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import {
  countMnemonDocuments,
  getMnemonDocument,
  listMnemonDocuments,
  upsertMnemonDocument,
} from "./mnemon-store.js";

export interface MnemonStatusOptions {
  readonly xrkHome?: string;
  readonly workspaceRoot?: string;
}

function area(
  kind: "runtime" | "memory-bodies" | "documents" | "state",
  root: string,
  details: Record<string, unknown>,
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
    status: existsSync(dir) ? "empty" : "missing",
    itemCount: 0,
    bytes: 0,
    details,
  };
}

function scope(kind: "global" | "workspace" | "custom", root: string) {
  return {
    kind,
    root,
    available: true,
    totalBytes: 0,
    areas: [
      area("runtime", root, { userEntries: 0, memoryEntries: 0 }),
      area("memory-bodies", root, { activeBodies: 0, databases: 0 }),
      area("documents", root, { activeDocuments: 0, archivedDocuments: 0 }),
      area("state", root, { reviewLedger: false }),
    ],
  };
}

export function buildMnemonStatus(options: MnemonStatusOptions = {}): unknown {
  const home = options.xrkHome?.trim() || path.join(homedir(), ".xrk");
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

  const scopes = [scope("global", globalRoot)];
  if (workspaceRoot) {
    try {
      mkdirSync(workspaceRoot, { recursive: true });
      mkdirSync(path.join(workspaceRoot, "runtime"), { recursive: true });
      mkdirSync(path.join(workspaceRoot, "bodies"), { recursive: true });
      mkdirSync(path.join(workspaceRoot, "documents"), { recursive: true });
      mkdirSync(path.join(workspaceRoot, "state"), { recursive: true });
    } catch {
      /* ignore */
    }
    scopes.push(scope("workspace", workspaceRoot));
  }

  const activeKind = workspaceRoot ? "workspace" : "global";
  const activeRoot =
    scopes.find((s) => s.kind === activeKind)?.root ?? globalRoot;

  const docCounts = countMnemonDocuments(home);

  return {
    ok: true,
    ready: true,
    healthy: true,
    writeEnabled: true,
    commandFound: true,
    version: "xrk-compat",
    dshMnemonVersion: "compat",
    adapter: DSH_COMPAT_ADAPTER,
    memoryBodies: [],
    providerServices: [
      {
        providerId: "mnemon-native",
        label: "mnemon",
        enabled: true,
        status: "idle",
        activeMemoryBodyCount: 0,
        memoryBodyCount: 0,
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

const MNEMON_LIST_ENDPOINTS = new Set([
  "list",
  "documents",
  "entities",
  "search",
  "related",
  "graph",
  "bodies",
  "body-directory",
]);

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
  if (endpoint === "turn-activities") return [];
  if (endpoint === "documents" || endpoint === "list") {
    return listMnemonDocuments(home);
  }
  if (MNEMON_LIST_ENDPOINTS.has(endpoint)) return [];
  if (endpoint === "provider-services") {
    return {
      items: [],
      providers: [{ id: "mnemon-native", label: "mnemon" }],
      generatedAt: new Date().toISOString(),
    };
  }
  if (endpoint === "document") {
    const id = typeof payload.id === "string" ? payload.id : "";
    return id ? getMnemonDocument(home, id) : null;
  }
  if (endpoint === "runtime-memory") return null;
  if (endpoint === "task-agent-models") {
    return { models: [] };
  }
  return { ok: true, endpoint, items: [] };
}

export function handleMnemonWrite(
  endpoint: string,
  payload: Record<string, unknown>,
  options: MnemonStatusOptions = {},
): unknown {
  const home = options.xrkHome?.trim();
  if (
    endpoint === "provider-services" ||
    endpoint === "provider-service-update"
  ) {
    return {
      providerId:
        typeof payload.providerId === "string"
          ? payload.providerId
          : "mnemon-native",
      enabled: payload.enabled !== false,
      settings:
        payload.settings && typeof payload.settings === "object"
          ? payload.settings
          : {},
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
