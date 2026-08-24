/**
 * Named revisioned JSON doc store (`~/.xrk/<parts>` + revision envelope).
 * Feature modules declare `parts` + defaults; adapters only wire routes.
 */
import {
  patchRevisionedDoc,
  readRevisionedDoc,
  type XrkRevisionedDoc,
} from "../xrk-json-store.js";

export interface XrkDocStore<T> {
  readonly parts: readonly string[];
  readonly defaultData: T;
  read(xrkHome?: string): XrkRevisionedDoc<T>;
  write(xrkHome: string | undefined, data: T): XrkRevisionedDoc<T>;
  patch(
    xrkHome: string | undefined,
    mutator: (current: T, revision: number) => T,
  ): XrkRevisionedDoc<T>;
}

export function createXrkDocStore<T>(
  parts: readonly string[],
  defaultData: T,
): XrkDocStore<T> {
  return {
    parts,
    defaultData,
    read(xrkHome) {
      return readRevisionedDoc(xrkHome, parts, defaultData);
    },
    write(xrkHome, data) {
      return patchRevisionedDoc(xrkHome, parts, defaultData, () => data);
    },
    patch(xrkHome, mutator) {
      return patchRevisionedDoc(xrkHome, parts, defaultData, mutator);
    },
  };
}
