/**
 * Default local ExecEnvironment — host disk + local subprocess.
 * Same capabilities Host uses when SSH / HTTP world is off.
 */

import { createFsLocalProvider } from "@xrkseek/exec-fs";
import { createLocalSubprocess } from "@xrkseek/exec-subprocess";
import type { ExecEnvironmentProvider, ExecWorld } from "./types.js";

export interface LocalExecEnvironmentOptions {
  /** Extra host-readable roots for absolute reads (attachments / spill). */
  readonly hostReadableRoots?: readonly string[];
}

export function createLocalExecEnvironment(
  options: LocalExecEnvironmentOptions = {},
): ExecEnvironmentProvider {
  return {
    providerName: "local",
    isAvailable: () => true,
    createWorld({ workspaceRoot }) {
      const root = workspaceRoot.trim() || process.cwd();
      const world: ExecWorld = {
        workspaceRoot: root,
        fs: createFsLocalProvider({
          root,
          ...(options.hostReadableRoots
            ? { hostReadableRoots: options.hostReadableRoots }
            : {}),
        }),
        subprocess: createLocalSubprocess(),
        dispose() {
          /* local world has no session to close */
        },
      };
      return world;
    },
  };
}
