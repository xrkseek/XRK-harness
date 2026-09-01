/**
 * Session-projection seam: drive registry + dual type tables.
 * No Cordis — Host Face (or any carrier) owns wiring; domains register pure units.
 */

import type { SessionEvent } from "@xrkseek/protocol";
import type {
  SessionProjectionMap,
  SessionProjectionStateMap,
} from "./types.js";

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
   * (`Object.is`) so the change feed stays quiet.
   * `seq` is the Face host watermark for this event (1-based log index).
   */
  apply(state: S, event: SessionEvent, seq: number): S;
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
  init(): unknown;
  apply(state: unknown, event: SessionEvent, seq: number): unknown;
  view(state: unknown): unknown;
  parse(value: unknown): unknown;
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
  checkpoint(sessionId: string): ProjectionCheckpoint;
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
  /** Registered unit keys + sidecar keys (any session). */
  keys(): readonly string[];
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
  /** Drop cached fold state for one session (SQLite LRU eviction). */
  evictSession(sessionId: string): void;
}

function eraseDefinition<K extends string, S, V>(
  definition: ProjectionDefinition<K, S, V>,
): ErasedDefinition {
  const wire = definition.wire;
  if (wire) {
    return {
      key: definition.key,
      stateVersion: definition.stateVersion,
      wired: true,
      init: () => definition.init(),
      apply: (state, event, seq) => definition.apply(state as S, event, seq),
      view: (state) => wire.view(state as S),
      parse: (value) => wire.parse(value),
    };
  }
  return {
    key: definition.key,
    stateVersion: definition.stateVersion,
    wired: false,
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
  };
}

export function createSessionProjectionRegistry(
  options: SessionProjectionRegistryOptions,
): SessionProjectionRegistry {
  const registrations = new Map<string, Registration>();
  const listeners = new Set<ProjectionChangeListener>();
  const sidecars = new Map<string, Map<string, unknown>>();
  const eventLogCache = new Map<string, readonly SessionEvent[]>();

  function eventsFor(sessionId: string): readonly SessionEvent[] {
    let events = eventLogCache.get(sessionId);
    if (events === undefined) {
      events = options.getEvents(sessionId);
      eventLogCache.set(sessionId, events);
    }
    return events;
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

  function cellFor(
    registration: Registration,
    sessionId: string,
  ): UnitCell {
    let cell = registration.cells.get(sessionId);
    if (cell === undefined) {
      cell = buildCell(registration.def, eventsFor(sessionId));
      registration.cells.set(sessionId, cell);
    }
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
      const existing = registrations.get(key);
      if (existing === undefined) {
        registrations.set(key, {
          def: eraseDefinition(definition),
          cells: new Map(),
          refs: 1,
        });
      } else {
        if (existing.def.stateVersion !== definition.stateVersion) {
          throw new Error(
            `projection key ${JSON.stringify(key)} already registered at stateVersion ${existing.def.stateVersion}; refusing ${definition.stateVersion}`,
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
        if (live.refs === 0) registrations.delete(key);
      };
    },

    onChanged(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    drive(sessionId, event, seq) {
      eventLogCache.delete(sessionId);
      for (const registration of registrations.values()) {
        let cell = registration.cells.get(sessionId);
        if (cell === undefined) {
          const all = eventsFor(sessionId);
          const prefix = all.slice(0, seq - 1);
          cell = buildCell(registration.def, prefix);
          registration.cells.set(sessionId, cell);
        }
        const next = registration.def.apply(cell.state, event, seq);
        const changed = !Object.is(next, cell.state);
        cell.state = next;
        cell.observedSeq = seq;
        if (changed && registration.def.wired && listeners.size > 0) {
          const value = registration.def.parse(registration.def.view(next));
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
      let asOfSeq = events.length === 0 ? -1 : events.length;
      for (const registration of registrations.values()) {
        if (!registration.def.wired) continue;
        if (keyFilter && !keyFilter.has(registration.def.key)) continue;
        const cell = cellFor(registration, sessionId);
        asOfSeq = Math.max(asOfSeq, cell.observedSeq);
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
      return { asOfSeq, values };
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
        try {
          values[def.key] = def.parse(def.view(row.val));
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
        const usable =
          row !== undefined &&
          row.ver === def.stateVersion &&
          row.seq >= baseSeq - 1 &&
          row.seq <= endSeq;
        if (!usable && baseSeq > 0) {
          throw new Error(
            `session projection ${JSON.stringify(def.key)} cannot restore from seq ${baseSeq}: ` +
              "its checkpoint row is missing, version-mismatched, or beyond the supplied log end; re-read from seq 0",
          );
        }
        let state = usable ? row.val : def.init();
        const from = usable ? row.seq : baseSeq - 1;
        for (let i = 0; i < events.length; i++) {
          const seq = baseSeq + i;
          if (seq > from) state = def.apply(state, events[i]!, seq);
        }
        if (def.wired) values[def.key] = def.parse(def.view(state));
        refreshed[def.key] = {
          ver: def.stateVersion,
          seq: endSeq,
          val: state,
        };
      }
      return {
        snapshot: { asOfSeq: endSeq, values },
        checkpoint: refreshed,
      };
    },

    checkpoint(sessionId) {
      const rows: ProjectionCheckpoint = {};
      for (const registration of registrations.values()) {
        const cell = cellFor(registration, sessionId);
        rows[registration.def.key] = {
          ver: registration.def.stateVersion,
          seq: cell.observedSeq,
          val: structuredClone(cell.state),
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

    evictSession(sessionId) {
      eventLogCache.delete(sessionId);
      for (const registration of registrations.values()) {
        registration.cells.delete(sessionId);
      }
      sidecars.delete(sessionId);
    },
  };
}

/** @deprecated Prefer {@link SessionProjectionStateMap} declare-merge from host units. */
export type HostProjectionStateMap = SessionProjectionStateMap;
