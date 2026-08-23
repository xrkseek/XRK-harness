/**
 * XRK dsh-compat 底层：带 revision 的 JSON 文档读写（~/.xrk/…）。
 * Adapter 只装配路径；业务模块用此 primitive 持久化。
 */
import { dataPath, readJsonFile, writeJsonFile } from "./json-store.js";

export interface XrkRevisionedDoc<T> {
  readonly revision: number;
  readonly updatedAt: string;
  readonly data: T;
}

function isRevisioned<T>(
  raw: unknown,
): raw is { revision?: number; updatedAt?: string; data: T } {
  return (
    !!raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "data" in (raw)
  );
}

export function readRevisionedDoc<T>(
  xrkHome: string | undefined,
  parts: readonly string[],
  defaultData: T,
): XrkRevisionedDoc<T> {
  const file = dataPath(xrkHome, ...parts);
  const raw = readJsonFile<unknown>(file, defaultData);
  if (isRevisioned<T>(raw)) {
    return {
      revision: typeof raw.revision === "number" ? raw.revision : 0,
      updatedAt:
        typeof raw.updatedAt === "string"
          ? raw.updatedAt
          : new Date(0).toISOString(),
      data: raw.data,
    };
  }
  return {
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    data: raw as T,
  };
}

export function writeRevisionedDoc<T>(
  xrkHome: string | undefined,
  parts: readonly string[],
  data: T,
  revision?: number,
): XrkRevisionedDoc<T> {
  const prev = readRevisionedDoc(xrkHome, parts, data);
  const next: XrkRevisionedDoc<T> = {
    revision: revision ?? prev.revision + 1,
    updatedAt: new Date().toISOString(),
    data,
  };
  writeJsonFile(dataPath(xrkHome, ...parts), next);
  return next;
}

export function patchRevisionedDoc<T>(
  xrkHome: string | undefined,
  parts: readonly string[],
  defaultData: T,
  mutator: (current: T, revision: number) => T,
): XrkRevisionedDoc<T> {
  const prev = readRevisionedDoc(xrkHome, parts, defaultData);
  return writeRevisionedDoc(xrkHome, parts, mutator(prev.data, prev.revision));
}
