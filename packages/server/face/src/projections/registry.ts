/**
 * Face-owned session projection registry (session-projection fold).
 * No Cordis — Host computes; mux carries higher-seq-wins values.
 */

import type { ImageAttachmentLimits } from "@xrkseek/attachment";
import type { SessionEvent, TodoItem } from "@xrkseek/protocol";
import type { PlanProjection } from "@xrkseek/protocol";
import type { PermissionSelect } from "../permissions.js";

/** Well-known projection keys owned by Face default units. */
export interface FaceProjectionMap {
  /** Latest title, or null while untitled. */
  readonly title: string | null;
  /** Sidebar list hint. */
  readonly sessionListMetadata: SessionListMetadata;
  /** Standing plan (DSH TodoDock); null before write / after turn/start. */
  readonly todos: TodoItem[] | null;
  /** Permission select (DSH Access chip); folded from knob events. */
  readonly permissions: PermissionSelect;
  /** Plan-mode chip: logged active + pending `/plan` selection. */
  readonly plan: PlanProjection;
  /**
   * Attachment intake limits (DSH InputBar pre-check). Present only while
   * Face has an AttachmentStore; constant per boot — no change frames.
   */
  readonly imageLimits: ImageAttachmentLimits;
  /**
   * Whole-log turn/step counts and wall times (DSH sessionStats).
   * StatsLine reads this so paging cannot change the strip.
   */
  readonly sessionStats: {
    readonly turns: number;
    readonly steps: number;
    readonly llmMs: number;
    readonly toolMs: number;
    readonly ttftMs: number;
    readonly ttftSteps: number;
    readonly decodeMs: number;
    readonly decodeTokens: number;
  };
}

export interface SessionListMetadata {
  readonly blank: boolean;
  readonly lastPromptAt: number | null;
}

export interface ProjectionSnapshot {
  /** Seq of last event reflected; `-1` for empty log. */
  readonly asOfSeq: number;
  readonly values: Readonly<Partial<FaceProjectionMap>> &
    Readonly<Record<string, unknown>>;
}

export interface ProjectionCheckpointRow {
  readonly ver: number;
  readonly seq: number;
  readonly val: unknown;
}

export type ProjectionCheckpoint = Record<string, ProjectionCheckpointRow>;

export interface ProjectionDefinition<K extends string, S, V = unknown> {
  readonly key: K;
  readonly stateVersion: number;
  init(): S;
  /**
   * Pure transition. Return the **same reference** when unchanged
   * (`Object.is`) so the change feed stays quiet.
   */
  apply(state: S, event: SessionEvent): S;
  view(state: S): V;
  /** Validate wire payload before leaving the host. */
  parse(value: unknown): V;
}

export type ProjectionChangeListener = (
  sessionId: string,
  key: string,
  value: unknown,
  seq: number,
) => void;

interface ErasedDefinition {
  readonly key: string;
  readonly stateVersion: number;
  init(): unknown;
  apply(state: unknown, event: SessionEvent): unknown;
  view(state: unknown): unknown;
  parse(value: unknown): unknown;
}

interface UnitCell {
  state: unknown;
  observedSeq: number;
}

interface Registration {
  readonly def: ErasedDefinition;
  /** sessionId → cell */
  readonly cells: Map<string, UnitCell>;
  refs: number;
}

export interface FaceProjectionRegistryOptions {
  /** Live log reader (Face seq = 1-based index in this array). */
  getEvents(sessionId: string): readonly SessionEvent[];
}

export interface FaceProjectionRegistry {
  register<K extends string, S, V>(
    definition: ProjectionDefinition<K, S, V>,
  ): () => void;
  onChanged(listener: ProjectionChangeListener): () => void;
  /**
   * Drive every unit with one committed event at Face seq.
   * Call after `session/event` is minted for the same seq.
   */
  drive(sessionId: string, event: SessionEvent, seq: number): void;
  snapshot(sessionId: string): ProjectionSnapshot;
  checkpoint(sessionId: string): ProjectionCheckpoint;
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
}

export function createFaceProjectionRegistry(
  options: FaceProjectionRegistryOptions,
): FaceProjectionRegistry {
  const registrations = new Map<string, Registration>();
  const listeners = new Set<ProjectionChangeListener>();
  const sidecars = new Map<string, Map<string, unknown>>();

  function buildCell(
    def: ErasedDefinition,
    events: readonly SessionEvent[],
  ): UnitCell {
    let state = def.init();
    for (const event of events) state = def.apply(state, event);
    return {
      state,
      observedSeq: events.length === 0 ? -1 : events.length,
    };
  }

  function cellFor(
    registration: Registration,
    sessionId: string,
  ): UnitCell {
    let cell = registration.cells.get(sessionId);
    if (cell === undefined) {
      cell = buildCell(registration.def, options.getEvents(sessionId));
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
        const erased: ErasedDefinition = {
          key: definition.key,
          stateVersion: definition.stateVersion,
          init: () => definition.init(),
          apply: (state, event) => definition.apply(state as never, event),
          view: (state) => definition.view(state as never),
          parse: (value) => definition.parse(value),
        };
        registrations.set(key, {
          def: erased,
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
      for (const registration of registrations.values()) {
        let cell = registration.cells.get(sessionId);
        if (cell === undefined) {
          // Late build mid-stream: fold history before this event.
          const all = options.getEvents(sessionId);
          const prefix = all.slice(0, seq - 1);
          cell = buildCell(registration.def, prefix);
          registration.cells.set(sessionId, cell);
        }
        const next = registration.def.apply(cell.state, event);
        const changed = !Object.is(next, cell.state);
        cell.state = next;
        cell.observedSeq = seq;
        if (changed && listeners.size > 0) {
          const value = registration.def.parse(registration.def.view(next));
          for (const listener of listeners) {
            listener(sessionId, registration.def.key, value, seq);
          }
        }
      }
    },

    snapshot(sessionId) {
      const events = options.getEvents(sessionId);
      const values: Record<string, unknown> = {};
      for (const registration of registrations.values()) {
        const cell = cellFor(registration, sessionId);
        values[registration.def.key] = registration.def.parse(
          registration.def.view(cell.state),
        );
      }
      const extra = sidecars.get(sessionId);
      if (extra) {
        for (const [key, value] of extra) values[key] = value;
      }
      const asOfSeq = events.length === 0 ? -1 : events.length;
      return { asOfSeq, values };
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
        for (const key of map.keys()) extra.add(key);
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
  };
}
