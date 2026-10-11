/**
 * Experimental plugin session records — closed-union `plugin/record` events.
 * Aligns with DSH appendPluginRecord (ignorable / not model-visible).
 */
import type { PluginRecordEvent, SessionEvent } from "@xrkseek/protocol";
import type { SessionStore } from "./store.js";

const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*$/;
const PLUGIN_KEY_RE = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/;

export interface PluginRecordView {
  readonly pluginId: string;
  readonly key: string;
  readonly data: unknown;
  readonly ts: number;
}

function assertPluginId(pluginId: string): string {
  const id = pluginId.trim();
  if (!PLUGIN_ID_RE.test(id)) {
    throw new Error(
      `plugin record pluginId "${pluginId}" must match /^[a-z][a-z0-9-]*$/`,
    );
  }
  return id;
}

function assertPluginKey(key: string): string {
  const k = key.trim();
  if (!PLUGIN_KEY_RE.test(k)) {
    throw new Error(
      `plugin record key "${key}" must be lowercase slash-separated segments`,
    );
  }
  return k;
}

function snapshotJson(data: unknown, pluginId: string, key: string): unknown {
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    throw new Error(
      `plugin record "${pluginId}/${key}" carries non-JSON-serializable data`,
    );
  }
}

/**
 * Append one plugin-owned record. Does not affect deriveMessages / surface.
 */
export function appendPluginRecord(
  store: SessionStore,
  sessionId: string,
  pluginId: string,
  key: string,
  data: unknown,
  ts: number = Date.now(),
): PluginRecordEvent {
  const id = assertPluginId(pluginId);
  const k = assertPluginKey(key);
  const frozen = snapshotJson(data, id, k);
  return store.append(sessionId, {
    type: "plugin/record",
    ts,
    pluginId: id,
    key: k,
    data: frozen,
  }) as PluginRecordEvent;
}

/** Read plugin records from an event list; optionally filter by pluginId. */
export function pluginRecordsOf(
  events: readonly SessionEvent[],
  pluginId?: string,
): readonly PluginRecordView[] {
  const want = pluginId !== undefined ? assertPluginId(pluginId) : undefined;
  const out: PluginRecordView[] = [];
  for (const ev of events) {
    if (ev.type !== "plugin/record") continue;
    if (want !== undefined && ev.pluginId !== want) continue;
    out.push({
      pluginId: ev.pluginId,
      key: ev.key,
      data: ev.data,
      ts: ev.ts,
    });
  }
  return out;
}
