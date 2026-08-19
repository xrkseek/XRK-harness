/**
 * host.pickDirectory — OS folder chooser. Cancel → `{ path: null }`.
 * Win: PowerShell FolderBrowserDialog (STA). macOS: osascript. Linux: zenity → kdialog.
 */

import { spawn } from "node:child_process";
import type { FaceRpcResult } from "./types.js";

export function canPickNativeDirectory(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" || platform === "darwin" || platform === "linux";
}

/** Testable command boundary; implementations should not invoke a shell. */
export type DirectoryPickerRunner = (
  command: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<{ readonly stdout: string }>;

export interface DirectoryPickerInternals {
  readonly platform?: NodeJS.Platform;
  readonly run?: DirectoryPickerRunner;
}

/** Thrown when a native picker command exits non-zero or cannot start. */
export class NativePickerCommandError extends Error {
  readonly code: string | number;
  readonly stderr: string;
  readonly stdout: string;

  constructor(
    message: string,
    opts: { code: string | number; stderr?: string; stdout?: string },
  ) {
    super(message);
    this.name = "NativePickerCommandError";
    this.code = opts.code;
    this.stderr = opts.stderr ?? "";
    this.stdout = opts.stdout ?? "";
  }
}

/** STA FolderBrowserDialog — no koffi; cancel exits 1. */
export const WIN32_POWERSHELL_PICK = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$dialog.Description = 'Select Workspace Directory'",
  "$dialog.ShowNewFolderButton = $true",
  "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath); exit 0 }",
  "exit 1",
].join("; ");

function outputPath(stdout: string): string | null {
  const picked = stdout.replace(/[\r\n]+$/, "");
  return picked === "" ? null : picked;
}

function errorCode(error: unknown): string | number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

function errorStderr(error: unknown): string {
  if (typeof error !== "object" || error === null || !("stderr" in error)) {
    return "";
  }
  const stderr = (error as { stderr?: unknown }).stderr;
  return typeof stderr === "string" ? stderr : "";
}

function isMissingCommand(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error).name === "AbortError"
  );
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

function rethrowIfAborted(signal: AbortSignal, error: unknown): void {
  if (signal.aborted) throw isAbortError(error) ? error : abortError(signal);
}

export function runNativePickerCommand(
  command: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<{ readonly stdout: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    const onAbort = () => {
      child.kill();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const settle = (fn: () => void) => {
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    child.once("error", (err) => {
      settle(() => reject(err));
    });
    child.once("close", (code) => {
      settle(() => {
        if (signal.aborted) {
          reject(abortError(signal));
          return;
        }
        if (code === 0) {
          resolve({ stdout });
          return;
        }
        reject(
          new NativePickerCommandError(
            `directory picker exited ${code ?? "null"}`,
            { code: code ?? 1, stderr, stdout },
          ),
        );
      });
    });
  });
}

/**
 * Open the platform directory picker.
 * @returns selected path, or `null` when the user cancels.
 */
export async function pickNativeDirectory(
  signal: AbortSignal,
  internals: DirectoryPickerInternals = {},
): Promise<string | null> {
  if (signal.aborted) throw abortError(signal);
  const platform = internals.platform ?? process.platform;
  const run = internals.run ?? runNativePickerCommand;

  if (platform === "darwin") {
    try {
      const result = await run(
        "osascript",
        [
          "-e",
          'set selectedFolder to choose folder with prompt "Select Workspace Directory"',
          "-e",
          "POSIX path of selectedFolder",
        ],
        signal,
      );
      return outputPath(result.stdout);
    } catch (error: unknown) {
      rethrowIfAborted(signal, error);
      if (
        errorCode(error) === 1 &&
        /(?:User canceled|-128)/i.test(errorStderr(error))
      ) {
        return null;
      }
      throw error;
    }
  }

  if (platform === "win32") {
    try {
      const result = await run(
        "powershell.exe",
        ["-NoProfile", "-STA", "-Command", WIN32_POWERSHELL_PICK],
        signal,
      );
      return outputPath(result.stdout);
    } catch (error: unknown) {
      rethrowIfAborted(signal, error);
      if (errorCode(error) === 1) return null;
      throw error;
    }
  }

  if (platform === "linux") {
    try {
      const result = await run(
        "zenity",
        [
          "--file-selection",
          "--directory",
          "--title=Select Workspace Directory",
        ],
        signal,
      );
      return outputPath(result.stdout);
    } catch (error: unknown) {
      rethrowIfAborted(signal, error);
      if (errorCode(error) === 1) return null;
      if (!isMissingCommand(error)) throw error;
    }

    try {
      const result = await run(
        "kdialog",
        [
          "--getexistingdirectory",
          ".",
          "--title",
          "Select Workspace Directory",
        ],
        signal,
      );
      return outputPath(result.stdout);
    } catch (error: unknown) {
      rethrowIfAborted(signal, error);
      if (errorCode(error) === 1) return null;
      if (isMissingCommand(error)) {
        throw new Error(
          "no supported native directory picker found (install zenity or kdialog)",
          { cause: error },
        );
      }
      throw error;
    }
  }

  throw new Error(`native directory picker is unsupported on ${platform}`);
}

export type NativeDirectoryPicker = (
  signal: AbortSignal,
) => Promise<string | null>;

function pickerUnavailable(message: string): FaceRpcResult<{ path: string | null }> {
  return {
    ok: false,
    error: { code: "directory-picker-unavailable", message },
  };
}

/**
 * Face RPC wrapper. Inject `pickNativeDirectory` on the runtime in tests —
 * never pop a real dialog in CI.
 */
export async function hostPickDirectoryRpc(runtime: {
  pickNativeDirectory?: NativeDirectoryPicker;
}): Promise<FaceRpcResult<{ path: string | null }>> {
  const signal = new AbortController().signal;
  try {
    const pick = runtime.pickNativeDirectory ?? ((s) => pickNativeDirectory(s));
    const path = await pick(signal);
    return { ok: true, value: { path } };
  } catch (err) {
    if (isAbortError(err)) {
      return {
        ok: false,
        error: { code: "cancelled", message: "directory pick aborted" },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (isMissingCommand(err)) {
      return pickerUnavailable("native directory picker command not found");
    }
    return pickerUnavailable(message);
  }
}
