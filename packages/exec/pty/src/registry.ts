import {
  TerminalBackendCleanupError,
  TerminalError,
  type DisposableTerminalSessionService,
  type TerminalBackend,
  type TerminalBackendSession,
  type TerminalReadRequest,
  type TerminalSendOperation,
  type TerminalSessionSnapshot,
  type TerminalSignal,
  type TerminalSignalResult,
  type TerminalSpawnResult,
} from "./types.js";

interface SessionRecord {
  readonly id: string;
  readonly name: string | undefined;
  readonly type: string;
  readonly session: TerminalBackendSession;
  active: TerminalSendOperation | undefined;
  closing: Promise<void> | undefined;
}

/**
 * Clarify common model mistakes: chat `sess_*` ids from the volatile block are
 * not PTY ids (`pty-N` from terminal_open / terminal_list).
 */
export function unknownSessionHint(
  sessionId: string,
  liveCount: number,
): string {
  if (/^sess[_-]/i.test(sessionId)) {
    return (
      " — that looks like a chat/agent session id from the volatile prompt, " +
      "not a terminal id. Call terminal_open (or terminal_list) and use a " +
      "`pty-N` id."
    );
  }
  if (liveCount === 0) {
    return " — no live terminals; call terminal_open first.";
  }
  return " — use an id from terminal_list / terminal_open (form `pty-N`).";
}

interface PendingSpawn {
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  resolveSettled: () => void;
  cleanupFailure: { error: unknown } | undefined;
}

/**
 * One composition, one registry. Owner isolation is the composition itself —
 * XRK has no `exec.agent` bags.
 */
export function createTerminalSessionService(): DisposableTerminalSessionService {
  const backends = new Map<string, TerminalBackend>();
  const sessions = new Map<string, SessionRecord>();
  const reservedNames = new Set<string>();
  const pendingSpawns = new Set<PendingSpawn>();
  let nextId = 0;
  let disposing = false;

  function assertActive(): void {
    if (disposing) {
      throw new TerminalError("PTY service is disposing", "SERVICE_DISPOSING");
    }
  }

  function snapshot(record: SessionRecord): TerminalSessionSnapshot;
  function snapshot(record: SessionRecord, motd: string): TerminalSpawnResult;
  function snapshot(
    record: SessionRecord,
    motd?: string,
  ): TerminalSpawnResult | TerminalSessionSnapshot {
    return {
      sessionId: record.id,
      ...(record.name !== undefined ? { name: record.name } : {}),
      type: record.type,
      ...(record.session.pid !== undefined ? { pid: record.session.pid } : {}),
      status: record.session.status(),
      ...(motd !== undefined ? { motd } : {}),
    };
  }

  function expectSession(sessionId: string): SessionRecord {
    const record = sessions.get(sessionId);
    if (record === undefined) {
      const hint = unknownSessionHint(sessionId, sessions.size);
      throw new TerminalError(
        `unknown PTY session ${sessionId}${hint}`,
        "NO_SESSION",
      );
    }
    return record;
  }

  function reserveName(name: string | undefined): () => void {
    if (name === undefined) return () => {};
    if (name.length === 0) throw new Error("PTY session name must be non-empty");
    if ([...sessions.values()].some((record) => record.name === name)) {
      throw new TerminalError(
        `PTY session name "${name}" already exists`,
        "DUPLICATE_NAME",
      );
    }
    if (reservedNames.has(name)) {
      throw new TerminalError(
        `PTY session name "${name}" is already being created`,
        "DUPLICATE_NAME",
      );
    }
    reservedNames.add(name);
    return () => {
      reservedNames.delete(name);
    };
  }

  function reserveSpawn(): {
    readonly signal: AbortSignal;
    release(cleanupFailure: { error: unknown } | undefined): void;
  } {
    let resolveSettled!: () => void;
    const pending: PendingSpawn = {
      controller: new AbortController(),
      settled: new Promise<void>((resolve) => {
        resolveSettled = resolve;
      }),
      resolveSettled: () => {},
      cleanupFailure: undefined,
    };
    pending.resolveSettled = resolveSettled;
    pendingSpawns.add(pending);
    return {
      signal: pending.controller.signal,
      release(cleanupFailure) {
        pending.cleanupFailure = cleanupFailure;
        if (cleanupFailure === undefined) pendingSpawns.delete(pending);
        pending.resolveSettled();
      },
    };
  }

  async function abortPending(reason: TerminalError): Promise<void> {
    const pending = [...pendingSpawns];
    for (const spawn of pending) spawn.controller.abort(reason);
    await Promise.all(pending.map((spawn) => spawn.settled));
    const failures = pending.flatMap((spawn) =>
      spawn.cleanupFailure === undefined ? [] : [spawn.cleanupFailure.error],
    );
    for (const spawn of pending) pendingSpawns.delete(spawn);
    if (failures.length > 0) {
      throw new AggregateError(failures, "failed to roll back unpublished PTY setup");
    }
  }

  async function closeRecords(records: SessionRecord[], reason: string): Promise<void> {
    const results = await Promise.allSettled(
      records.map(async (record) => {
        const closing = record.closing ?? record.session.close(reason);
        record.closing = closing;
        try {
          await closing;
          sessions.delete(record.id);
        } catch (error: unknown) {
          if (record.closing === closing) record.closing = undefined;
          throw error;
        }
      }),
    );
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `failed to close ${failures.length} PTY session(s)`,
      );
    }
  }

  const service: DisposableTerminalSessionService = {
    registerBackend(backend) {
      if (backend.type.length === 0) {
        throw new Error("pty backend type must be non-empty");
      }
      if (backends.has(backend.type)) {
        throw new TerminalError(
          `a PTY backend named "${backend.type}" is already registered`,
          "DUPLICATE_BACKEND",
        );
      }
      backends.set(backend.type, backend);
      return () => {
        if (backends.get(backend.type) === backend) backends.delete(backend.type);
      };
    },

    listBackends() {
      return [...backends.keys()];
    },

    async spawn(request, signal) {
      assertActive();
      signal?.throwIfAborted();
      if (request.type.length === 0) {
        throw new Error("PTY backend type must be non-empty");
      }
      const backend = backends.get(request.type);
      if (backend === undefined) {
        throw new TerminalError(
          `no PTY backend registered for "${request.type}"`,
          "NO_BACKEND",
        );
      }
      const releaseName = reserveName(request.name);
      const spawnReservation = reserveSpawn();
      const backendSignal =
        signal === undefined
          ? spawnReservation.signal
          : AbortSignal.any([signal, spawnReservation.signal]);
      const sessionId = `pty-${++nextId}`;
      let session: TerminalBackendSession | undefined;
      let cleanupFailure: { error: unknown } | undefined;
      try {
        session = await backend.spawn({
          sessionId,
          type: request.type,
          ...(request.name !== undefined ? { name: request.name } : {}),
          ...(request.cwd !== undefined ? { cwd: request.cwd } : {}),
          ...(request.ownerSessionId !== undefined
            ? { ownerSessionId: request.ownerSessionId }
            : {}),
          signal: backendSignal,
        });
        signal?.throwIfAborted();
        if (disposing) {
          throw new TerminalError("PTY service is disposing", "SERVICE_DISPOSING");
        }
        const record: SessionRecord = {
          id: sessionId,
          name: request.name,
          type: request.type,
          session,
          active: undefined,
          closing: undefined,
        };
        sessions.set(sessionId, record);
        return snapshot(record, session.motd);
      } catch (error) {
        if (error instanceof TerminalBackendCleanupError) {
          cleanupFailure = { error: error.cleanupError };
        }
        let rollbackFailure: { error: unknown } | undefined;
        if (session !== undefined && !sessions.has(sessionId)) {
          try {
            await session.close("PTY spawn rolled back");
          } catch (closeError: unknown) {
            rollbackFailure = { error: closeError };
            cleanupFailure = rollbackFailure;
          }
        }
        let failure: unknown = error;
        try {
          signal?.throwIfAborted();
          spawnReservation.signal.throwIfAborted();
        } catch (cancellation: unknown) {
          failure = cancellation;
        }
        if (rollbackFailure !== undefined && signal?.aborted !== true) {
          throw new AggregateError(
            [failure, rollbackFailure.error],
            "PTY spawn and rollback both failed",
            { cause: error },
          );
        }
        throw failure instanceof Error
          ? failure
          : new Error(String(failure), {
              cause: failure,
            });
      } finally {
        spawnReservation.release(cleanupFailure);
        releaseName();
      }
    },

    startSend(sessionId, request) {
      const record = expectSession(sessionId);
      if (record.closing !== undefined) {
        throw new Error(`PTY session ${sessionId} is closing`);
      }
      if (record.active !== undefined) {
        throw new TerminalError(
          `PTY session ${sessionId} already has an active send`,
          "SEND_ACTIVE",
        );
      }
      const operation = record.session.startSend(request);
      record.active = operation;
      void operation.done.then(
        () => {
          record.active = undefined;
        },
        () => {
          record.active = undefined;
        },
      );
      return operation;
    },

    read(sessionId, request: TerminalReadRequest = {}) {
      return expectSession(sessionId).session.read(request);
    },

    signal(sessionId, signal: TerminalSignal): Promise<TerminalSignalResult> {
      return expectSession(sessionId).session.signal(signal);
    },

    async kill(sessionId, reason = "model request") {
      const record = expectSession(sessionId);
      if (record.closing !== undefined) {
        await record.closing;
        return false;
      }
      const closing = record.session.close(reason);
      record.closing = closing;
      try {
        await closing;
        sessions.delete(sessionId);
        return true;
      } catch (error) {
        record.closing = undefined;
        throw error;
      }
    },

    list() {
      return [...sessions.values()].map((record) => snapshot(record));
    },

    hasActivity() {
      return pendingSpawns.size > 0 || sessions.size > 0;
    },

    async dispose() {
      disposing = true;
      const failures: unknown[] = [];
      try {
        await abortPending(
          new TerminalError("PTY service is disposing", "SERVICE_DISPOSING"),
        );
      } catch (error: unknown) {
        failures.push(error);
      }
      try {
        await closeRecords([...sessions.values()], "PTY service disposed");
      } catch (error: unknown) {
        failures.push(error);
      }
      backends.clear();
      reservedNames.clear();
      pendingSpawns.clear();
      if (failures.length > 0) {
        throw new AggregateError(failures, "failed to clean up PTY lifecycle");
      }
    },
  };

  return service;
}
