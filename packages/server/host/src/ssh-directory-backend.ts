/**
 * Face directoryBackend for SSH remote workspace browse.
 * Paths are remote POSIX; never fall through to Host-local opendir.
 */

import {
  createSshDirectory,
  listSshDirectory,
  type SshExecutionWorld,
} from "@xrkseek/exec-ssh";

function listError(target: string, err: unknown): string {
  return `cannot list ${target}: ${err instanceof Error ? err.message : String(err)}`;
}

/** Structural FaceDirectoryBackend — avoids requiring a fresh server-face dist. */
export function createSshDirectoryBackend(world: SshExecutionWorld) {
  const root = world.workspaceRoot;
  const session = world.session;

  return {
    async list(payload: unknown) {
      const p =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : {};
      const rawPath = typeof p.path === "string" ? p.path : undefined;
      if (rawPath !== undefined && rawPath.trim() && !rawPath.startsWith("/")) {
        return {
          ok: false as const,
          error: {
            code: "directory-unreadable",
            message: `cannot list "${rawPath}": remote paths must be absolute POSIX`,
          },
        };
      }
      try {
        const listed = await listSshDirectory(session, root, rawPath);
        return { ok: true as const, value: listed };
      } catch (err) {
        return {
          ok: false as const,
          error: {
            code: "directory-unreadable",
            message: listError(rawPath ?? root, err),
          },
        };
      }
    },

    async create(payload: unknown) {
      const p =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : {};
      const parent = typeof p.path === "string" ? p.path.trim() : "";
      const name = typeof p.name === "string" ? p.name.trim() : "";
      if (
        !parent ||
        !name ||
        name === "." ||
        name === ".." ||
        /[/\\]/.test(name)
      ) {
        return {
          ok: false as const,
          error: {
            code: "invalid-payload",
            message:
              "path required; name must be a single non-blank path segment",
          },
        };
      }
      if (!parent.startsWith("/")) {
        return {
          ok: false as const,
          error: {
            code: "directory-unreadable",
            message: `cannot create under "${parent}": remote paths must be absolute POSIX`,
          },
        };
      }
      try {
        const created = await createSshDirectory(session, root, parent, name);
        return { ok: true as const, value: created };
      } catch (err) {
        return {
          ok: false as const,
          error: {
            code: "directory-create-failed",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    },
  };
}
