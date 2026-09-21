/**
 * Watch `XRK_POLICY_FILE` / Host `runtime.policyFile` and reload JSON rulesets.
 * Invalid JSON keeps the previous engine (fail-stable). Debounced for editor
 * atomic replace (write → rename) on Windows.
 */
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import {
  loadPolicyRulesetFile,
  type CreatePolicyEngineOptions,
} from "@xrkseek/policy";

export interface PolicyFileWatchOptions {
  readonly filePath: string;
  /** Default 150ms — coalesces multi-event saves. */
  readonly debounceMs?: number;
  readonly load?: (filePath: string) => Promise<CreatePolicyEngineOptions>;
  readonly onReload: (file: CreatePolicyEngineOptions) => void | Promise<void>;
  readonly onError?: (err: unknown) => void;
}

export interface PolicyFileWatchHandle {
  dispose(): void;
}

/**
 * Watch one policy JSON path. Reloads via {@link loadPolicyRulesetFile}
 * (or injectable `load`) then invokes `onReload`. Dispose closes the watcher.
 */
export function watchPolicyFile(
  options: PolicyFileWatchOptions,
): PolicyFileWatchHandle {
  const filePath = path.resolve(options.filePath);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const debounceMs = options.debounceMs ?? 150;
  const load = options.load ?? loadPolicyRulesetFile;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let reloading: Promise<void> | undefined;

  const reload = (): void => {
    if (disposed) return;
    reloading = (async () => {
      try {
        const file = await load(filePath);
        if (disposed) return;
        await options.onReload(file);
      } catch (err) {
        if (!disposed) options.onError?.(err);
      }
    })();
  };

  const schedule = (): void => {
    if (disposed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      reload();
    }, debounceMs);
  };

  let watcher: FSWatcher;
  try {
    // Watch the directory so atomic replace (temp → rename) is visible.
    watcher = watch(dir, { persistent: false }, (_event, filename) => {
      if (disposed) return;
      if (
        typeof filename === "string" &&
        filename.length > 0 &&
        filename !== base
      ) {
        return;
      }
      schedule();
    });
  } catch (err) {
    options.onError?.(err);
    return {
      dispose() {
        disposed = true;
      },
    };
  }

  watcher.on("error", (err) => {
    if (!disposed) options.onError?.(err);
  });

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      try {
        watcher.close();
      } catch {
        // already closed
      }
      void reloading;
    },
  };
}
