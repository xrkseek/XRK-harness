/**
 * In-memory settings document with revision + JSON-patch-ish ops.
 * Shared by every Cordis remote-settings / settings-scope channel.
 */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { readonly [k: string]: Json };

export interface SettingsDocStore {
  readonly ns: string;
  revision(): number;
  /** Merged effective document (base ⊕ user). */
  value(): Record<string, unknown>;
  base(): Record<string, unknown>;
  user(): Record<string, unknown>;
  applyOps(ops: readonly unknown[]): void;
  replaceUser(patch: Record<string, unknown>): void;
}

export function createSettingsDocStore(
  ns: string,
  defaults: Record<string, unknown> = {},
  seed?: { user?: Record<string, unknown>; revision?: number },
): SettingsDocStore {
  let revision = seed?.revision ?? 0;
  const base: Record<string, unknown> = { ...defaults };
  let user: Record<string, unknown> = seed?.user ? { ...seed.user } : {};

  const merge = (): Record<string, unknown> => ({ ...base, ...user });

  return {
    ns,
    revision: () => revision,
    value: merge,
    base: () => ({ ...base }),
    user: () => ({ ...user }),
    applyOps(ops) {
      for (const raw of ops) {
        if (!raw || typeof raw !== "object") continue;
        const op = raw as Record<string, unknown>;
        const path = Array.isArray(op.path)
          ? (op.path as unknown[]).map(String)
          : typeof op.key === "string"
            ? [op.key]
            : [];
        if (op.op === "unset" || op.op === "clear") {
          if (path.length === 1) {
            const next = { ...user };
            delete next[path[0]!];
            user = next;
          } else if (path.length === 0 && typeof op.key === "string") {
            const next = { ...user };
            delete next[op.key];
            user = next;
          }
          continue;
        }
        if (op.op === "set" || op.op === "merge" || op.value !== undefined) {
          if (path.length === 1) {
            user = { ...user, [path[0]!]: op.value };
          } else if (typeof op.key === "string") {
            user = { ...user, [op.key]: op.value };
          } else if (op.value && typeof op.value === "object" && !Array.isArray(op.value)) {
            user = { ...user, ...(op.value as Record<string, unknown>) };
          }
        }
      }
      revision += 1;
    },
    replaceUser(patch) {
      user = { ...user, ...patch };
      revision += 1;
    },
  };
}

/**
 * Vision-Router / DSH remote-settings describe payload.
 * Client requires `enabled === true` and `view.value` object + integer revision.
 */
export function remoteSettingsDescribe(store: SettingsDocStore): unknown {
  return {
    enabled: true,
    writable: true,
    reason: "enabled",
    view: {
      value: store.value(),
      base: store.base(),
      user: store.user(),
      revision: store.revision(),
    },
  };
}

/**
 * Mnemon SettingsScope snapshot (`get` / `mutate` value).
 * Client publishes `response.value` directly as the React snapshot.
 */
export function settingsScopeSnapshot(store: SettingsDocStore): unknown {
  return {
    status: "ready",
    writable: true,
    mode: "host",
    value: store.value(),
    base: store.base(),
    user: store.user(),
    revision: store.revision(),
  };
}

export function handleSettingsEndpoint(
  store: SettingsDocStore,
  endpoint: string,
  payload: Record<string, unknown>,
  style: "remote-describe" | "scope-snapshot",
): unknown {
  const describe =
    style === "remote-describe"
      ? () => remoteSettingsDescribe(store)
      : () => settingsScopeSnapshot(store);

  if (
    endpoint === "describe" ||
    endpoint === "view" ||
    endpoint === "get" ||
    endpoint === ""
  ) {
    return describe();
  }

  if (endpoint === "mutate" || endpoint === "set" || endpoint === "save") {
    const ops = Array.isArray(payload.ops) ? payload.ops : [];
    if (ops.length > 0) store.applyOps(ops);
    if (payload.document && typeof payload.document === "object") {
      store.replaceUser(payload.document as Record<string, unknown>);
    }
    return describe();
  }

  return describe();
}
