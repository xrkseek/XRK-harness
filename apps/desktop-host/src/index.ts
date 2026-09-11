/**
 * Private Desktop Host child entry ([ADR-0008](../../../docs/adr/0008-desktop-shell-private-host.md)).
 *
 * - Run under **bundled upstream Node** (not Electron's Node)
 * - Compose this repo's Host / Face / assembled Web (`apps/web/dist`)
 * - **No** listen socket; Fetch over framed pipes (fds 3/4) + IPC lifecycle
 * - **Forbidden:** Cordis `boot` / overlay apply, `*.cordis*.yml`, embedding a Cordis Host
 *
 * Package `@xrkseek/harness-desktop-host` is private and not on public npm.
 * Electron spawn: `node dist/index.js <projectDir>` with stdio pipes + IPC.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  type DesktopHostCommand,
  type DesktopHostEvent,
} from "@xrkseek/harness-desktop";
import {
  bootXrkDesktopHost,
  DESKTOP_HOST_PACKAGE_NAME,
  type BootedDesktopHost,
} from "./boot.js";
import { startDesktopHostPipeRuntime } from "./pipe-runtime.js";

export { DESKTOP_HOST_PACKAGE_NAME } from "./boot.js";
export {
  bootXrkDesktopHost,
  declareDesktopNativeOpenCapabilities,
  type BootedDesktopHost,
} from "./boot.js";
export {
  startDesktopHostPipeRuntime,
  type DesktopHostPipeFetch,
  type DesktopHostPipeRuntime,
} from "./pipe-runtime.js";

/** Reserved profile name owned by Desktop (CLI must refuse). */
export const DESKTOP_HOST_PROFILE_NAME = "desktop" as const;

/**
 * Composition path for this entry — XRK only.
 * Do not substitute Cordis app-boot / desktop-host overlay.
 */
export const DESKTOP_HOST_COMPOSITION = {
  compose: "@xrkseek/compose",
  face: "@xrkseek/server-face",
  host: "@xrkseek/server-host",
  webDist: "apps/web/dist",
  cordisBoot: false,
} as const;

export {
  DESKTOP_HOST_PROTOCOL_VERSION,
  DESKTOP_PIPE_CHUNK_BYTES,
  DESKTOP_REQUEST_PIPE_FD,
  DESKTOP_RESPONSE_PIPE_FD,
  DesktopHostRequestDecoder,
  encodeDesktopResponseData,
  encodeDesktopResponseEnd,
  encodeDesktopResponseError,
  encodeDesktopResponseStart,
  iterDesktopPipeChunks,
  writeDesktopPipeFrame,
  type DesktopHostRequestFrame,
} from "./wire.js";

export interface DesktopHostController {
  readonly hostVersion: string;
  readonly protocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION;
  readonly fetch: BootedDesktopHost["fetch"];
  dispose(): Promise<void>;
}

function isDesktopHostCommand(message: unknown): message is DesktopHostCommand {
  if (typeof message !== "object" || message === null || !("type" in message)) {
    return false;
  }
  return message.type === "shutdown";
}

function sendIpc(event: DesktopHostEvent): void {
  if (process.send === undefined || !process.connected) return;
  try {
    process.send(event);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ERR_IPC_CHANNEL_CLOSED") {
      throw error;
    }
  }
}

/**
 * Boot Host (listen disabled) and register Fetch on framed pipes.
 * When `fetch` is injected, skips Host spawn (unit tests).
 */
export async function startDesktopHost(options: {
  readonly projectDir: string;
  readonly webDist?: string;
  readonly workspaceRoot?: string;
  readonly fetch?: BootedDesktopHost["fetch"];
  readonly hostVersion?: string;
  readonly request?: import("node:stream").Readable;
  readonly response?: import("node:stream").Writable;
}): Promise<DesktopHostController> {
  const booted =
    options.fetch === undefined
      ? await bootXrkDesktopHost({
          projectDir: options.projectDir,
          ...(options.webDist !== undefined
            ? { webDist: options.webDist }
            : {}),
          ...(options.workspaceRoot !== undefined
            ? { workspaceRoot: options.workspaceRoot }
            : {}),
        })
      : undefined;
  const fetch =
    options.fetch ??
    ((request: Request) => {
      if (booted === undefined) {
        throw new Error(
          `${DESKTOP_HOST_PACKAGE_NAME}: Host fetch unavailable before boot`,
        );
      }
      return booted.fetch(request);
    });
  const hostVersion = options.hostVersion ?? booted?.hostVersion ?? "0.0.0";
  const pipes = startDesktopHostPipeRuntime(fetch, {
    ...(options.request !== undefined ? { request: options.request } : {}),
    ...(options.response !== undefined ? { response: options.response } : {}),
  });

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    await pipes.dispose();
    await booted?.dispose();
  };

  return {
    hostVersion,
    protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    fetch,
    dispose,
  };
}

/** True after child entry can accept pipe Fetch (module loaded + API present). */
export function isDesktopHostReady(): boolean {
  return true;
}

function isDirectEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return (
      path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const projectDir = process.argv[2];
  if (projectDir === undefined || process.send === undefined) {
    throw new Error(
      `${DESKTOP_HOST_PACKAGE_NAME}: expected project directory, byte pipes, and a Node IPC channel`,
    );
  }

  let controller: DesktopHostController | undefined;
  let stopping: Promise<void> | undefined;

  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      await controller?.dispose();
      if (process.connected) process.disconnect();
      process.exitCode = process.exitCode ?? 0;
    })();
    return stopping;
  };

  try {
    controller = await startDesktopHost({ projectDir });
    sendIpc({
      type: "ready",
      protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      hostVersion: controller.hostVersion,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendIpc({ type: "fatal", message });
    process.exitCode = 1;
    await stop();
    return;
  }

  process.on("message", (message: unknown) => {
    if (!isDesktopHostCommand(message)) {
      sendIpc({
        type: "fatal",
        message: `${DESKTOP_HOST_PACKAGE_NAME}: invalid Electron IPC command`,
      });
      void stop().then(() => {
        process.exitCode = 1;
      });
      return;
    }
    void stop();
  });
  process.once("disconnect", () => {
    void stop();
  });
  process.once("SIGTERM", () => {
    void stop();
  });
  process.once("SIGINT", () => {
    void stop();
  });
}

if (isDirectEntry()) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    sendIpc({ type: "fatal", message });
    process.stderr.write(`${DESKTOP_HOST_PACKAGE_NAME}: ${message}\n`);
    process.exitCode = 1;
  });
}
