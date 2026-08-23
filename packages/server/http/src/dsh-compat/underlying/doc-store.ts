/**
 * 底层标准：具名 JSON 文档 store（`~/.xrk/<parts>` + revision 信封）。
 * 业务模块只声明 `parts` + 默认 data + RPC/HTTP 逻辑；adapter 只装配。
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
