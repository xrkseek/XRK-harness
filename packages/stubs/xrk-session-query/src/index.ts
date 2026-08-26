/**
 * Cordis session-query service seam (stub). Full corpus/search lives in bar
 * `session-query`; XRK Host Face uses {@link @xrkseek/face-session-query} instead.
 *
 * @module @xrkseek/xrk-session-query
 */

import type { SessionId } from "@xrkseek/xrk-session";
import type {
  SessionLineageTrace,
  SessionRecord,
  SessionSearchExecContext,
  SessionSearchHit,
  SessionSearchPage,
  SessionSearchRequest,
  SessionSurfaceSnapshot,
  SessionTitleObservationResult,
} from "./types.js";
import {
  SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
  SESSION_QUERY_READ_WINDOW_MAX,
  SessionQueryError,
  type Config,
} from "./config.js";

export type * from "./types.js";
export { SessionSearchCursor } from "./cursor.js";
export type { Config, SessionQueryErrorCode } from "./config.js";
export {
  SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
  SESSION_QUERY_READ_WINDOW_MAX,
  SessionQueryError,
} from "./config.js";

/**
 * Unified live-preferred session query service (Cordis). Host Face presets do
 * not mount this; they read {@link SessionStore} via face-session-query.
 */
export abstract class SessionQueryEngine {
  abstract searchSessions(
    request: SessionSearchRequest,
    exec?: SessionSearchExecContext,
  ): Promise<SessionSearchPage<SessionSearchHit>>;

  abstract listSessions(
    signal?: AbortSignal,
  ): Promise<readonly SessionRecord[]>;

  abstract readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot>;

  abstract readTitleSnapshots(
    sessionIds: readonly SessionId[],
    signal?: AbortSignal,
  ): Promise<readonly SessionTitleObservationResult[]>;

  abstract traceSession(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionLineageTrace>;
}

export type { Config as SessionQueryConfig };

export default SessionQueryEngine;
