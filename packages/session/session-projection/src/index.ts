/**
 * Session-projection seam: drive registry + dual type tables.
 * No Cordis — Host Face (or any carrier) owns wiring; domains register pure units.
 */

import { assertLosslessJson, type SessionEvent } from "@xrkseek/protocol";
import type { SessionProjectionMap } from "./types.js";

export type {
  SessionProjectionMap,
  SessionProjectionStateMap,
} from "./types.js";

/** Client view for one unit (state → wire). Omit on the definition for host-only. */
export interface ProjectionWire<S, V> {
  /**
   * State → wire payload.
   * Must be synchronous.
   */
  view(state: S): V;
  /** Validate wire payload before it leaves the host. */
  parse(value: unknown): V;
  /**
   * When `true`, this key is part of a Session list / summary payload
   * ({@link SessionProjectionRegistry.summaryKeys}).
   * XRK is **opt-in** (omit / `false` = heavy / history-only) — opposite of
   * DSH's default-include + `summary: false` opt-out, so a new heavy unit
   * cannot leak into cold list rows by accident.
   */
  summary?: boolean;
}

/**
 * One domain's state-driven unit. Framework drives `apply`; domain owns only
 * the fold. Omit {@link wire} for host-only keys (`stateOf` / checkpoint only).
 */
export interface ProjectionDefinition<K extends string, S, V = unknown> {
  readonly key: K;
  /**
   * Persisted-cache invalidation version. Bump when serialized state fields or
   * fold semantics change.
   */
  readonly stateVersion: number;
  init(): S;
  /**
   * Pure transition. Return the **same reference** when unchanged
   * (`Object.is`) so the change feed stays quiet. A new object whose
   * {@link wire}.view is equal to the previous view is also suppressed.
   * `seq` is the Face host watermark for this event (1-based log index).
   */
  apply(state: S, event: SessionEvent, seq: number): S;
  /**
   * Optional fold-state validator for checkpoint restore / seed.
   * Throw (or return reject) when `value` is not a usable `S` — the row is
   * treated as missing so a version bump or half-written cache cannot poison
   * the live fold.
   */
  parseState?(value: unknown): S;
  /** Client view. Omit for host-only units. */
  readonly wire?: ProjectionWire<S, V>;
}

export interface ProjectionSnapshot {
  /** Seq of last event reflected; `-1` for empty log. */
  readonly asOfSeq: number;
  /** Whole current client values (wired keys + sidecars only). */
  readonly values: Readonly<Partial<SessionProjectionMap>> &
    Readonly<Record<string, unknown>>;
}

export interface ProjectionCheckpointRow {
  readonly ver: number;
  readonly seq: number;
  readonly val: unknown;
}

export type ProjectionCheckpoint = Record<string, ProjectionCheckpointRow>;

export type ProjectionChangeListener = (
  sessionId: string,
  key: string,
  value: unknown,
  seq: number,
) => void;

interface ErasedDefinition {
  readonly key: string;
  readonly stateVersion: number;
  readonly wired: boolean;
  /** Opt-in list/summary membership (see {@link ProjectionWire.summary}). */
  readonly summary: boolean;
  init(): unknown;
  apply(state: unknown, event: SessionEvent, seq: number): unknown;
  view(state: unknown): unknown;
  parse(value: unknown): unknown;
  parseState?(value: unknown): unknown;
}

interface UnitCell {
  state: unknown;
  observedSeq: number;
}

interface Registration {
  readonly def: ErasedDefinition;
  readonly cells: Map<string, UnitCell>;
  refs: number;
}

export interface SessionProjectionRegistryOptions {
  /** Live log reader (Face seq = 1-based index in this array). */
  getEvents(sessionId: string): readonly SessionEvent[];
}

export interface SessionProjectionRegistry {
  register<K extends string, S, V>(
    definition: ProjectionDefinition<K, S, V>,
  ): () => void;
  onChanged(listener: ProjectionChangeListener): () => void;
  /**
   * Drive every unit with one committed event at host seq.
   * Call after `session/event` is minted for the same seq.
   */
  drive(sessionId: string, event: SessionEvent, seq: number): void;
  /** Client-visible cut: wired keys + sidecars only. */
  snapshot(
    sessionId: string,
    options?: { readonly keys?: readonly string[] },
  ): ProjectionSnapshot;
  /**
   * Borrow live host fold state for one key. Callers must not mutate.
   * `undefined` when the key is not registered (DSH `stateOf`).
   */
  stateOf(sessionId: string, key: string): unknown | undefined;
  /** Persistable host states for every registered unit (wired + host-only). */
  checkpoint(
    sessionId: string,
    options?: { readonly keys?: readonly string[] },
  ): ProjectionCheckpoint;
  /**
   * Seq to pass persistence `readFrom` before {@link restore} (DSH cold ladder).
   * `undefined` when no unit is registered.
   */
  restoreFloor(checkpoint: ProjectionCheckpoint): number | undefined;
  /**
   * Zero-I/O view of checkpoint rows for wired keys with matching `stateVersion`.
   */
  viewCheckpoint(
    checkpoint: ProjectionCheckpoint,
  ): Partial<SessionProjectionMap> & Record<string, unknown>;
  /**
   * Cold fold: seed from checkpoint when usable, replay `events` tail.
   * Face watermarks: event i in `events` has seq `baseSeq + i` (1-based).
   */
  restore(
    checkpoint: ProjectionCheckpoint,
    events: readonly SessionEvent[],
    baseSeq: number,
  ): { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint };
  /**
   * Install live cells from a prior checkpoint (list-tier cold open).
   * Skips keys that already have a cell, version-mismatched rows, and rows
   * whose `seq` is past the current log. Catch-up folds only the tail.
   */
  seedFromCheckpoint(
    sessionId: string,
    checkpoint: ProjectionCheckpoint,
    options?: { readonly keys?: readonly string[] },
  ): void;
  /** Registered unit keys + sidecar keys (any session). */
  keys(): readonly string[];
  /**
   * Wired keys that declared `wire.summary: true` (Session list / summary).
   * Stable until the next register / last unregister for a key.
   */
  summaryKeys(): ReadonlySet<string>;
  /**
   * Host-computed overlay (e.g. `goal`). Included in snapshots and change feed.
   * `null` is a published value; `undefined` removes the sidecar.
   */
  setSidecar(
    sessionId: string,
    key: string,
    value: unknown,
    seq: number,
  ): void;
  /**
   * Replace one unit's live fold without appending a log event.
   * Host facts that are not session events (the selected model's context
   * window) publish through here. Does not move `observedSeq`.
   * No-op when `key` is not a registered unit or `patch` returns the same state.
   */
  revise(
    sessionId: string,
    key: string,
    patch: (state: unknown) => unknown,
  ): void;
  /** Drop cached fold state for one session (SQLite LRU eviction). */
  evictSession(sessionId: string): void;
}

function eraseDefinition<K extends string, S, V>(
  definition: ProjectionDefinition<K, S, V>,
): ErasedDefinition {
  const wire = definition.wire;
  const parseState =
    definition.parseState === undefined
      ? undefined
      : (value: unknown) => definition.parseState!(value);
  if (wire) {
    return {
      key: definition.key,
      stateVersion: definition.stateVersion,
      wired: true,
      summary: wire.summary === true,
      init: () => definition.init(),
      apply: (state, event, seq) => definition.apply(state as S, event, seq),
      view: (state) => wire.view(state as S),
      parse: (value) => wire.parse(value),
      ...(parseState !== undefined ? { parseState } : {}),
    };
  }
  return {
    key: definition.key,
    stateVersion: definition.stateVersion,
    wired: false,
    summary: false,
    init: () => definition.init(),
    apply: (state, event, seq) => definition.apply(state as S, event, seq),
    view: () => {
      throw new Error(
        `projection ${JSON.stringify(definition.key)} is host-only (no wire)`,
      );
    },
    parse: () => {
      throw new Error(
        `projection ${JSON.stringify(definition.key)} is host-only (no wire)`,
      );
    },
    ...(parseState !== undefined ? { parseState } : {}),
  };
}

/**
 * Detach + optional {@link ProjectionDefinition.parseState}.
 * `undefined` → treat the checkpoint row as missing.
 */
function materializeCheckpointState(
  def: ErasedDefinition,
  raw: unknown,
): unknown | undefined {
  try {
    const detached = structuredClone(raw);
    return def.parseState !== undefined ? def.parseState(detached) : detached;
  } catch {
    return undefined;
  }
}

/**
 * Wire-view equality for the change feed (DSH compares view, not state ref).
 * Primitives use `Object.is`; plain JSON uses stable `JSON.stringify`.
 */
function projectionViewEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function createSessionProjectionRegistry(
  options: SessionProjectionRegistryOptions,
): SessionProjectionRegistry {
  const registrations = new Map<string, Registration>();
  const listeners = new Set<ProjectionChangeListener>();
  const sidecars = new Map<string, Map<string, unknown>>();
  const eventLogCache = new Map<string, readonly SessionEvent[]>();
  let summaryKeySet: ReadonlySet<string> | undefined;

  function invalidateSummaryKeys(): void {
    summaryKeySet = undefined;
  }

  function deriveSummaryKeys(): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const registration of registrations.values()) {
      if (registration.def.wired && registration.def.summary) {
        keys.add(registration.def.key);
      }
    }
    return keys;
  }

  function eventsFor(sessionId: string): readonly SessionEvent[] {
    const fresh = options.getEvents(sessionId);
    const cached = eventLogCache.get(sessionId);
    if (cached === fresh) return fresh;
    // New log identity (reload without {@link evictSession}) — drop stale cells.
    if (cached !== undefined) {
      for (const registration of registrations.values()) {
        registration.cells.delete(sessionId);
      }
      sidecars.delete(sessionId);
    }
    eventLogCache.set(sessionId, fresh);
    return fresh;
  }

  function buildCell(
    def: ErasedDefinition,
    events: readonly SessionEvent[],
    baseSeq = 1,
  ): UnitCell {
    let state = def.init();
    for (let i = 0; i < events.length; i++) {
      state = def.apply(state, events[i]!, baseSeq + i);
    }
    return {
      state,
      observedSeq:
        events.length === 0 ? baseSeq - 1 : baseSeq + events.length - 1,
    };
  }

  /** Fold `[fromSeqExclusive, throughSeq]` (Face 1-based) onto an existing cell. */
  function catchUpCell(
    def: ErasedDefinition,
    cell: UnitCell,
    events: readonly SessionEvent[],
    throughSeq: number,
  ): void {
    const from = cell.observedSeq;
    if (from >= throughSeq) return;
    for (let seq = from + 1; seq <= throughSeq; seq++) {
      const event = events[seq - 1];
      if (event === undefined) break;
      cell.state = def.apply(cell.state, event, seq);
      cell.observedSeq = seq;
    }
  }

  function cellFor(
    registration: Registration,
    sessionId: string,
  ): UnitCell {
    const events = eventsFor(sessionId);
    let cell = registration.cells.get(sessionId);
    if (cell === undefined) {
      cell = buildCell(registration.def, events);
      registration.cells.set(sessionId, cell);
      return cell;
    }
    // Hydrate repairs (and any other undriven append) grow the log without
    // `drive` — catch up before serving snapshot / checkpoint.
    catchUpCell(registration.def, cell, events, events.length);
    return cell;
  }

  return {
    register(definition) {
      if (
        !Number.isSafeInteger(definition.stateVersion) ||
        definition.stateVersion < 0
      ) {
        throw new Error(
          `projection ${JSON.stringify(definition.key)} stateVersion must be a non-negative integer`,
        );
      }
      const key = definition.key;
      const erased = eraseDefinition(definition);
      const existing = registrations.get(key);
      if (existing === undefined) {
        registrations.set(key, {
          def: erased,
          cells: new Map(),
          refs: 1,
        });
        invalidateSummaryKeys();
      } else {
        if (existing.def.stateVersion !== erased.stateVersion) {
          throw new Error(
            `projection key ${JSON.stringify(key)} already registered at stateVersion ${existing.def.stateVersion}; refusing ${erased.stateVersion}`,
          );
        }
        if (existing.def.summary !== erased.summary) {
          throw new Error(
            `projection key ${JSON.stringify(key)} already registered with summary=${String(existing.def.summary)}; refusing to share it with summary=${String(erased.summary)}`,
          );
        }
        existing.refs += 1;
      }
      let alive = true;
      return () => {
        if (!alive) return;
        alive = false;
        const live = registrations.get(key);
        if (live === undefined) return;
        live.refs -= 1;
        if (live.refs === 0) {
          registrations.delete(key);
          invalidateSummaryKeys();
        }
      };
    },

    onChanged(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    drive(sessionId, event, seq) {
      // Do not clear `eventLogCache` first: that skipped the identity guard in
      // `eventsFor` and let recreate/truncate keep stale cells when the first
      // touch after a new log was `drive` (not `snapshot`).
      const all = eventsFor(sessionId);
      for (const registration of registrations.values()) {
        let cell = registration.cells.get(sessionId);
        if (cell === undefined) {
          cell = buildCell(registration.def, all.slice(0, seq - 1));
          registration.cells.set(sessionId, cell);
        } else {
          // Close gaps when the store inserted events without `drive`
          // (SQLite open-turn repair on hydrate).
          catchUpCell(registration.def, cell, all, seq - 1);
        }
        const prev = cell.state;
        const next = registration.def.apply(prev, event, seq);
        const stateChanged = !Object.is(next, prev);
        cell.state = next;
        cell.observedSeq = seq;
        if (stateChanged && registration.def.wired && listeners.size > 0) {
          const value = registration.def.parse(registration.def.view(next));
          const previous = registration.def.parse(registration.def.view(prev));
          if (projectionViewEquals(previous, value)) continue;
          for (const listener of listeners) {
            listener(sessionId, registration.def.key, value, seq);
          }
        }
      }
    },

    snapshot(sessionId, snapshotOptions) {
      const events = eventsFor(sessionId);
      const keyFilter = snapshotOptions?.keys
        ? new Set(snapshotOptions.keys)
        : undefined;
      const values: Record<string, unknown> = {};
        // `asOfSeq` is the LOWEST watermark across the wired units: every value
        // in the snapshot is current as of at least that seq. Claiming the max
        // would advertise the freshest unit's position for the whole snapshot,
        // and the client seeds its incremental baseline from this number —
        // `projection-store` drops rows with `seq > asOfSeq`, so the rows
        // between the true watermark and the claimed one are skipped and that
        // key stays frozen on a stale value.
        let asOfSeq: number | undefined;
        for (const registration of registrations.values()) {
          if (!registration.def.wired) continue;
          if (keyFilter && !keyFilter.has(registration.def.key)) continue;
          const cell = cellFor(registration, sessionId);
          asOfSeq = asOfSeq === undefined
            ? cell.observedSeq
            : Math.min(asOfSeq, cell.observedSeq);
          values[registration.def.key] = registration.def.parse(
            registration.def.view(cell.state),
          );
        }
      const extra = sidecars.get(sessionId);
      if (extra) {
        for (const [key, value] of extra) {
          if (keyFilter && !keyFilter.has(key)) continue;
          values[key] = value;
        }
      }
        // No wired unit (or every one filtered out): the log tail is the honest
        // watermark, -1 for an empty log.
        return { asOfSeq: asOfSeq ?? (events.length === 0 ? -1 : events.length), values };
    },

    stateOf(sessionId, key) {
      const registration = registrations.get(key);
      if (registration === undefined) return undefined;
      return cellFor(registration, sessionId).state;
    },

    restoreFloor(checkpoint) {
      let floor: number | undefined;
      for (const registration of registrations.values()) {
        const row = checkpoint[registration.def.key];
        const need =
          row !== undefined && row.ver === registration.def.stateVersion
            ? Math.max(row.seq + 1, 0)
            : 0;
        floor = floor === undefined ? need : Math.min(floor, need);
      }
      return floor === undefined ? undefined : Math.max(floor - 1, 0);
    },

    viewCheckpoint(checkpoint) {
      const values: Record<string, unknown> = {};
      for (const registration of registrations.values()) {
        const def = registration.def;
        if (!def.wired) continue;
        const row = checkpoint[def.key];
        if (row === undefined || row.ver !== def.stateVersion) continue;
        const state = materializeCheckpointState(def, row.val);
        if (state === undefined) continue;
        try {
          values[def.key] = def.parse(def.view(state));
        } catch {
          // malformed row → omit key (cold consumer refolds)
        }
      }
      return values;
    },

    restore(checkpoint, events, baseSeq) {
      const endSeq =
        events.length === 0 ? baseSeq - 1 : baseSeq + events.length - 1;
      const values: Record<string, unknown> = {};
      const refreshed: ProjectionCheckpoint = {};
      for (const registration of registrations.values()) {
        const def = registration.def;
        const row = checkpoint[def.key];
        const rangeOk =
          row !== undefined &&
          row.ver === def.stateVersion &&
          row.seq >= baseSeq - 1 &&
          row.seq <= endSeq;
        const seeded = rangeOk
          ? materializeCheckpointState(def, row.val)
          : undefined;
        const usable = seeded !== undefined;
        if (!usable && baseSeq > 0) {
          throw new Error(
            `session projection ${JSON.stringify(def.key)} cannot restore from seq ${baseSeq}: ` +
              "its checkpoint row is missing, version-mismatched, schema-invalid, or beyond the supplied log end; re-read from seq 0",
          );
        }
        let state = usable ? seeded : def.init();
        const from = usable ? row!.seq : baseSeq - 1;
        for (let i = 0; i < events.length; i++) {
          const seq = baseSeq + i;
          if (seq > from) state = def.apply(state, events[i]!, seq);
        }
        if (def.wired) values[def.key] = def.parse(def.view(state));
        refreshed[def.key] = {
          ver: def.stateVersion,
          seq: endSeq,
          val: assertLosslessJson(
            state,
            `projection ${JSON.stringify(def.key)}`,
          ),
        };
      }
      return {
        snapshot: { asOfSeq: endSeq, values },
        checkpoint: refreshed,
      };
    },

    seedFromCheckpoint(sessionId, checkpoint, options) {
      const events = eventsFor(sessionId);
      const wanted =
        options?.keys === undefined ? undefined : new Set(options.keys);
      for (const registration of registrations.values()) {
        if (wanted !== undefined && !wanted.has(registration.def.key)) continue;
        if (registration.cells.has(sessionId)) continue;
        const row = checkpoint[registration.def.key];
        if (
          row === undefined
          || row.ver !== registration.def.stateVersion
          || row.seq < 0
          || row.seq > events.length
        ) {
          continue;
        }
        const state = materializeCheckpointState(registration.def, row.val);
        if (state === undefined) continue;
        const cell: UnitCell = {
          state,
          observedSeq: row.seq,
        };
        catchUpCell(registration.def, cell, events, events.length);
        registration.cells.set(sessionId, cell);
      }
    },

    checkpoint(sessionId, options) {
      const rows: ProjectionCheckpoint = {};
      // Key filtering matters: `cellFor` folds the whole log for a unit that
      // has never been materialized, and callers like the cold list cache want
      // two keys out of ~17. Cloning (and folding) the other fifteen was pure
      // work — on a 6k-event session it dominated the open RPC tail.
      const wanted =
        options?.keys === undefined ? undefined : new Set(options.keys);
      for (const registration of registrations.values()) {
        if (wanted !== undefined && !wanted.has(registration.def.key)) continue;
        const cell = cellFor(registration, sessionId);
        rows[registration.def.key] = {
          ver: registration.def.stateVersion,
          seq: cell.observedSeq,
          val: assertLosslessJson(
            cell.state,
            `projection ${JSON.stringify(registration.def.key)}`,
          ),
        };
      }
      return rows;
    },

    keys() {
      const extra = new Set<string>();
      for (const map of sidecars.values()) {
        for (const k of map.keys()) extra.add(k);
      }
      return [...new Set([...registrations.keys(), ...extra])];
    },

    summaryKeys() {
      summaryKeySet ??= deriveSummaryKeys();
      return summaryKeySet;
    },

    setSidecar(sessionId, key, value, seq) {
      let map = sidecars.get(sessionId);
      if (value === undefined) {
        map?.delete(key);
        if (map && map.size === 0) sidecars.delete(sessionId);
      } else {
        if (!map) {
          map = new Map();
          sidecars.set(sessionId, map);
        }
        map.set(key, value);
      }
      for (const listener of listeners) {
        listener(sessionId, key, value ?? null, seq);
      }
    },

    revise(sessionId, key, patch) {
      const registration = registrations.get(key);
      if (registration === undefined) return;
      const cell = cellFor(registration, sessionId);
      const prev = cell.state;
      const next = patch(prev);
      if (Object.is(next, prev)) return;
      cell.state = next;
      if (!registration.def.wired || listeners.size === 0) return;
      const value = registration.def.parse(registration.def.view(next));
      const previous = registration.def.parse(registration.def.view(prev));
      if (projectionViewEquals(previous, value)) return;
      for (const listener of listeners) {
        listener(sessionId, key, value, cell.observedSeq);
      }
    },

    evictSession(sessionId) {
      eventLogCache.delete(sessionId);
      for (const registration of registrations.values()) {
        registration.cells.delete(sessionId);
      }
      sidecars.delete(sessionId);
    },
  };
}
