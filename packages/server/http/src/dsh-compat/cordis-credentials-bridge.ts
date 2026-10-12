/**
 * Minimal Cordis `credentials` store for community host halves (channel-pack).
 * Persists under `~/.xrk/community-credentials/<package>/` as JSON text values.
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
}

export interface CordisCredentialsBridge {
  resolve(ref: unknown): Promise<CordisCredentialResolved | undefined>;
  set(ref: unknown, value: string): Promise<void>;
  delete?(ref: unknown): Promise<void>;
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
  const safePkg = packageName.replace(/[^A-Za-z0-9._@+-]+/g, "_");
  const file = path.join(
    xrkHome,
    "community-credentials",
    safePkg,
    "store.json",
  );
  let cache: Record<string, string> | undefined;

  const read = (): Record<string, string> => {
    if (!cache) cache = loadMap(file);
    return cache;
  };

  return {
    async resolve(ref) {
      const key = refKey(ref);
      const value = read()[key];
      return value === undefined ? undefined : { value };
    },
    async set(ref, value) {
      const key = refKey(ref);
      const map = { ...read(), [key]: String(value) };
      cache = map;
      saveMap(file, map);
    },
    async delete(ref) {
      const key = refKey(ref);
      const map = { ...read() };
      delete map[key];
      cache = map;
      saveMap(file, map);
    },
  };
}
