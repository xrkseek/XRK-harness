/**
 * Minimal Cordis `credentials` store for community host halves (channel-pack).
 * Persists under `~/.xrk/community-credentials/<package>/` as JSON text values.
 *
 * Shape mirrors DSH Cordis `ctx.credentials` used by OFM channel-pack
 * (`describe` / `unset` / `resolve` / `set`) — see OFM standalone
 * `packages/standalone/channels/credentials.mjs` and auth `status()`/`logout()`.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export interface CordisCredentialResolved {
  readonly value: string;
  /** Winning layer when present (`local` for this on-disk store). */
  readonly source?: string;
}

/** Value-free view — channel-pack login status / pool UI. */
export interface CordisCredentialDescribed {
  readonly configured: boolean;
  readonly source?: string;
  readonly writable: boolean;
}

export interface CordisCredentialsBridge {
  resolve(ref: unknown): Promise<CordisCredentialResolved | undefined>;
  describe(ref: unknown): Promise<CordisCredentialDescribed>;
  set(ref: unknown, value: string): Promise<void>;
  /** Cordis / channel-pack logout path (alias of delete). */
  unset(ref: unknown): Promise<void>;
  delete?(ref: unknown): Promise<void>;
}

/**
 * On-disk store for one community package's credentials.
 * Single source of truth: the bridge writes here, and callers that need to know
 * whether a credential *exists* (Face sync gates) read the same file.
 */
export function communityCredentialsStorePath(
  xrkHome: string,
  packageName: string,
): string {
  const safePkg = packageName.replace(/[^A-Za-z0-9._@+-]+/g, "_");
  return path.join(xrkHome, "community-credentials", safePkg, "store.json");
}

function refKey(ref: unknown): string {
  const raw =
    typeof ref === "string"
      ? ref
      : ref && typeof ref === "object" && "toString" in ref
        ? String(ref)
        : "";
  const key = raw.trim();
  if (!key || key.includes("..") || key.includes("/") || key.includes("\\")) {
    throw new TypeError(`invalid credential ref: ${String(ref)}`);
  }
  return key;
}

function loadMap(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveMap(file: string, map: Record<string, string>): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`, "utf8");
}

export function createCordisCredentialsBridge(
  xrkHome: string,
  packageName: string,
): CordisCredentialsBridge {
  const file = communityCredentialsStorePath(xrkHome, packageName);
  /**
   * No in-memory cache on purpose. One package can be staged twice (initial
   * apply + a live re-apply after install/enable), so two bridges share this
   * file; a per-instance cache lets a stale copy write `{}` over a token the
   * other instance just stored — which looked like "logged in, but zero models".
   * The file is a few KB and every write rewrites the whole map anyway.
   */
  const read = (): Record<string, string> => loadMap(file);

  const remove = async (ref: unknown): Promise<void> => {
    const key = refKey(ref);
    const map = { ...read() };
    delete map[key];
    saveMap(file, map);
  };

  return {
    async resolve(ref) {
      const key = refKey(ref);
      const value = read()[key];
      return value === undefined
        ? undefined
        : { value, source: "local" };
    },
    async describe(ref) {
      const key = refKey(ref);
      const value = read()[key];
      if (value === undefined) {
        return { configured: false, writable: true };
      }
      return { configured: true, source: "local", writable: true };
    },
    async set(ref, value) {
      const key = refKey(ref);
      const map = { ...read(), [key]: String(value) };
      saveMap(file, map);
    },
    async unset(ref) {
      await remove(ref);
    },
    async delete(ref) {
      await remove(ref);
    },
  };
}
