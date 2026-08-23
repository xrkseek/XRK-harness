/**
 * File-backed Cordis settings documents under ~/.xrk/settings-docs/.
 */
import type { SettingsDocStore } from "./settings-store.js";
import { createSettingsDocStore } from "./settings-store.js";
import { readRevisionedDoc, writeRevisionedDoc } from "./xrk-json-store.js";

interface SettingsUserData {
  user: Record<string, unknown>;
}

function settingsParts(ns: string): readonly string[] {
  return ["settings-docs", `${ns}.json`];
}

function loadPersisted(
  xrkHome: string | undefined,
  ns: string,
): { user: Record<string, unknown>; revision: number } {
  const doc = readRevisionedDoc<SettingsUserData>(
    xrkHome,
    settingsParts(ns),
    { user: {} },
  );
  const raw = doc.data as SettingsUserData & { revision?: number };
  const user =
    raw.user && typeof raw.user === "object" && !Array.isArray(raw.user)
      ? raw.user
      : {};
  const revision =
    doc.revision > 0
      ? doc.revision
      : typeof raw.revision === "number"
        ? raw.revision
        : 0;
  return { user, revision };
}

function savePersisted(
  xrkHome: string | undefined,
  ns: string,
  store: SettingsDocStore,
): void {
  writeRevisionedDoc(
    xrkHome,
    settingsParts(ns),
    { user: store.user() },
    store.revision(),
  );
}

export function createPersistedSettingsDocStore(
  xrkHome: string | undefined,
  ns: string,
  defaults: Record<string, unknown> = {},
): SettingsDocStore {
  const saved = loadPersisted(xrkHome, ns);
  const inner = createSettingsDocStore(ns, defaults, {
    user: saved.user,
    revision: saved.revision,
  });
  if (!xrkHome?.trim()) return inner;

  const persist = () => savePersisted(xrkHome, ns, inner);
  return {
    ns: inner.ns,
    revision: () => inner.revision(),
    value: () => inner.value(),
    base: () => inner.base(),
    user: () => inner.user(),
    applyOps(ops) {
      inner.applyOps(ops);
      persist();
    },
    replaceUser(patch) {
      inner.replaceUser(patch);
      persist();
    },
  };
}
