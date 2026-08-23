/**
 * dsh-compat 底层标准入口 — 业务模块应优先组合这些 primitive。
 *
 * | Primitive | 用途 |
 * |-----------|------|
 * | `createXrkDocStore` | 具名 revision 文档（wallet、memento、IM…） |
 * | `parseJsonBody` / `httpMethod` | HTTP 路由只读一次 body |
 * | `honest-envelope` | 诚实 `*-host` / ready JSON |
 * | `persisted-settings-store` | Cordis `*-settings` RPC |
 */
export {
  createXrkDocStore,
  type XrkDocStore,
} from "./doc-store.js";
export {
  drainMutatingBody,
  httpMethod,
  isMutatingMethod,
  parseJsonBody,
} from "./http-kit.js";

/** 底层模块契约（文档用；运行时无强制）。 */
export interface DshUnderlyingModule {
  /** 稳定 id，对齐 `dsh-compat-matrix` genericModule */
  readonly id: string;
  /** `~/.xrk` 下相对路径段（可多个 doc） */
  readonly storageParts: readonly (readonly string[])[];
  /** HTTP 能力表前缀或 RPC channel（由 adapter-providers 挂载） */
  readonly surfaces: readonly string[];
}
