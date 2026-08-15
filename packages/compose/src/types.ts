/** Service lookup key — same shape as kernel, owned here to keep C0 dep-free. */
export type ServiceKey = string | symbol;

export type Disposer = () => void | Promise<void>;

export interface RealmRef {
  name: ServiceKey;
  label?: string;
}

export enum ScopeState {
  Pending = "pending",
  Loading = "loading",
  Active = "active",
  Unloading = "unloading",
  Disposed = "disposed",
  Failed = "failed",
}

export class ComposeError extends Error {
  override name = "ComposeError";
}

export class ComposeInjectError extends ComposeError {
  override name = "ComposeInjectError";
}

export class ComposeStateError extends ComposeError {
  override name = "ComposeStateError";
}

export interface EffectMeta {
  label?: string;
  children: EffectMeta[];
}

export interface Scope {
  readonly id: string;
  readonly state: ScopeState;
  readonly parent: Scope | null;
  readonly failReason: unknown;

  /**
   * Register a hard dependency before `activate`.
   * Missing deps keep the scope in `Pending` (does not throw).
   */
  depend(key: ServiceKey, opts?: { label?: string }): void;

  /** Resolve a provided value while Active or Unloading. */
  inject<T>(key: ServiceKey, opts?: { label?: string }): T;

  /** Soft resolve; never throws for missing binding. */
  tryInject<T>(key: ServiceKey, opts?: { label?: string }): T | undefined;

  provide<T>(
    key: ServiceKey,
    value: T,
    opts?: { label?: string },
  ): Disposer;

  effect(
    run: () => Disposer | Promise<Disposer>,
    meta?: { label?: string },
  ): Disposer;

  child(opts?: { id?: string; isolate?: RealmRef[]; depend?: RealmRef[] }): Scope;

  activate(setup?: () => void | Promise<void>): Promise<void>;

  dispose(): Promise<void>;

  /** Debug tree of effect labels (C0). */
  dumpEffects(): EffectMeta[];
}
