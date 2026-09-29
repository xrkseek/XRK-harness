/**
 * Desktop Host ↔ Electron lifecycle IPC (ADR-0008).
 *
 * Face traffic is loopback HTTP (`http://127.0.0.1:<port>`). This module carries
 * only ready / fatal / shutdown — no framed Face pipes.
 */

/** Protocol version implemented by the shell and private Desktop Host. */
export const DESKTOP_HOST_PROTOCOL_VERSION = 1 as const;

/** Commands on Node IPC only (no Fetch payload bytes). */
export type DesktopHostCommand = {
  readonly type: "shutdown";
};

/** Lifecycle events on Node IPC. */
export type DesktopHostEvent =
  | {
      readonly type: "ready";
      readonly protocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION;
      readonly hostVersion: string;
      /** Loopback Face origin (`http://127.0.0.1:<port>`). */
      readonly origin: string;
    }
  | {
      readonly type: "fatal";
      readonly message: string;
    };
