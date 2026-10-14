/**
 * Background input Provider. Separate from Windows UIA and from browser_*.
 * When the helper binary is not installed, every call returns unavailable.
 *
 * Product `mode=background` composes this with UIA for capture/listWindows
 * (see {@link composeBackgroundWithCapture}); this module owns act only.
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { ComputerUseError } from "./types.js";
import type {
  ComputerUseActRequest,
  ComputerUseActResult,
  ComputerUseCaptureRequest,
  ComputerUseService,
} from "./types.js";

export interface BackgroundInputOptions {
  /** Override the install probe (tests). */
  readonly installed?: boolean;
  /** Helper path. Default: XRK_COMPUTER_USE_BACKGROUND. */
  readonly command?: string;
  readonly send?: (
    request: ComputerUseActRequest,
  ) => Promise<void>;
}

const UNAVAILABLE =
  "background helper unavailable — set Credentials XRK_COMPUTER_USE_BACKGROUND to an installed helper binary.";

function unavailable(): never {
  throw new ComputerUseError(UNAVAILABLE, "COMPUTER_USE_UNAVAILABLE");
}

export function backgroundInputInstalled(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): boolean {
  const command = env.XRK_COMPUTER_USE_BACKGROUND?.trim();
  if (!command) return false;
  return exists(command);
}

async function spawnSend(
  command: string,
  request: ComputerUseActRequest,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [JSON.stringify(request)], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new ComputerUseError(UNAVAILABLE, "COMPUTER_USE_UNAVAILABLE"));
        return;
      }
      reject(
        new ComputerUseError(
          `background input failed: ${err.message}`,
          "COMPUTER_USE_BACKEND",
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new ComputerUseError(
            stderr.trim() || `background input exit ${code}`,
            "COMPUTER_USE_BACKEND",
          ),
        );
      }
    });
  });
}

export function createBackgroundInputProvider(
  options: BackgroundInputOptions = {},
): ComputerUseService {
  const installed = options.installed === true || Boolean(options.command);
  const send =
    options.send ??
    (options.command
      ? (request: ComputerUseActRequest) => spawnSend(options.command!, request)
      : undefined);

  return {
    providerId: "background",
    delivery: "background",
    async capture() {
      if (!installed) unavailable();
      throw new ComputerUseError(
        "background helper does not support capture — use mode=uia",
        "COMPUTER_USE_UNAVAILABLE",
      );
    },
    async listWindows() {
      if (!installed) unavailable();
      return [];
    },
    async act(request): Promise<ComputerUseActResult> {
      if (!installed || !send) unavailable();
      await send(request);
      return {
        ok: true,
        action: request.action,
        message: `background ${request.action}`,
        delivery: "background",
      };
    },
  };
}

/**
 * DSH-aligned background delivery: act via helper, capture/listWindows via a
 * desktop Provider (Windows UIA). Without a capture backend, capture keeps
 * failing honestly as in {@link createBackgroundInputProvider}.
 */
export function composeBackgroundWithCapture(
  act: ComputerUseService,
  capture: ComputerUseService | undefined,
): ComputerUseService {
  if (capture === undefined) return act;
  return {
    providerId: "background",
    delivery: "background",
    capture: (request?: ComputerUseCaptureRequest, signal?: AbortSignal) =>
      capture.capture(request, signal),
    listWindows: (signal?: AbortSignal) => capture.listWindows(signal),
    act: (request, signal) => act.act(request, signal),
  };
}
