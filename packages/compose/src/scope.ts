import { keyLabel, realmKey } from "./realm.js";
import {
  ComposeInjectError,
  ComposeStateError,
  ScopeState,
  type Disposer,
  type EffectMeta,
  type InjectInterceptor,
  type RealmRef,
  type Scope,
  type ServiceKey,
} from "./types.js";

interface Binding {
  value: unknown;
  owner: ScopeImpl;
  consumers: Set<ScopeImpl>;
}

interface DepSpec {
  name: ServiceKey;
  label?: string;
}

interface EffectEntry {
  dispose: Disposer;
  meta: EffectMeta;
  /** Provide withdrawal runs with effects; track binding for consumer graph. */
  bindingKey?: string;
}

let nextId = 1;

/** Shared registry for one root tree. */
class BindingRegistry {
  readonly map = new Map<string, Binding>();
  readonly waiters = new Set<() => void>();

  get(key: string): Binding | undefined {
    return this.map.get(key);
  }

  set(key: string, binding: Binding): void {
    if (this.map.has(key)) {
      throw new ComposeStateError(`binding already provided: ${key}`);
    }
    this.map.set(key, binding);
    this.notify();
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  onProvide(fn: () => void): Disposer {
    this.waiters.add(fn);
    return () => {
      this.waiters.delete(fn);
    };
  }

  private notify(): void {
    for (const fn of [...this.waiters]) {
      fn();
    }
  }
}

export class ScopeImpl implements Scope {
  readonly id: string;
  readonly parent: ScopeImpl | null;
  readonly registry: BindingRegistry;
  /** name → isolate label for this scope's default resolution. */
  readonly isolates: Map<ServiceKey, string | undefined>;
  readonly children: ScopeImpl[] = [];
  readonly deps: DepSpec[] = [];
  readonly effects: EffectEntry[] = [];
  /** Keys this scope currently provides. */
  readonly providedKeys = new Set<string>();
  /** C2 inject interceptors (registration order; last runs outermost). */
  private readonly injectInterceptors: InjectInterceptor[] = [];

  state: ScopeState;
  failReason: unknown = undefined;
  private inertia: Promise<void> | undefined;
  private disposedEffects = false;

  constructor(opts: {
    id?: string;
    parent: ScopeImpl | null;
    registry: BindingRegistry;
    isolates: Map<ServiceKey, string | undefined>;
    state: ScopeState;
  }) {
    this.id = opts.id ?? `scope-${nextId++}`;
    this.parent = opts.parent;
    this.registry = opts.registry;
    this.isolates = opts.isolates;
    this.state = opts.state;
  }

  depend(key: ServiceKey, opts?: { label?: string }): void {
    this.assertNotTerminal();
    if (this.state === ScopeState.Active || this.state === ScopeState.Unloading) {
      throw new ComposeStateError(
        `depend() after activate is not supported on scope "${this.id}"`,
      );
    }
    const label = opts?.label ?? this.resolveDefaultLabel(key);
    this.deps.push(
      label === undefined ? { name: key } : { name: key, label },
    );
  }

  inject<T>(key: ServiceKey, opts?: { label?: string }): T {
    if (
      this.state !== ScopeState.Active &&
      this.state !== ScopeState.Loading &&
      this.state !== ScopeState.Unloading
    ) {
      throw new ComposeStateError(
        `inject() requires Active, Loading, or Unloading (scope "${this.id}" is ${this.state})`,
      );
    }
    const value = this.resolveInjected<T>(key, opts);
    if (value === undefined && !this.hasBinding(key, opts)) {
      throw new ComposeInjectError(
        `service not found: ${keyLabel(key)} (scope "${this.id}")`,
      );
    }
    return value as T;
  }

  tryInject<T>(key: ServiceKey, opts?: { label?: string }): T | undefined {
    return this.resolveInjected<T>(key, opts);
  }

  interceptInject(interceptor: InjectInterceptor): Disposer {
    this.assertNotTerminal();
    this.injectInterceptors.push(interceptor);
    let once = false;
    return () => {
      if (once) return;
      once = true;
      const idx = this.injectInterceptors.indexOf(interceptor);
      if (idx >= 0) this.injectInterceptors.splice(idx, 1);
    };
  }

  private resolveInjected<T>(
    key: ServiceKey,
    opts?: { label?: string },
  ): T | undefined {
    const label = opts?.label ?? this.resolveDefaultLabel(key);
    const ctx =
      label === undefined ? { key } : { key, label };

    const lookup = (): T | undefined => {
      const rk = this.realmOf(key, opts);
      const binding = this.lookupBinding(rk);
      if (!binding) return undefined;
      if (
        this.state === ScopeState.Active ||
        this.state === ScopeState.Loading ||
        this.state === ScopeState.Unloading
      ) {
        binding.consumers.add(this);
      }
      return binding.value as T;
    };

    if (this.injectInterceptors.length === 0) return lookup();

    let i = this.injectInterceptors.length;
    const run = (): T => {
      if (i === 0) return lookup() as T;
      i -= 1;
      const interceptor = this.injectInterceptors[i]!;
      return interceptor(ctx, run);
    };
    return run();
  }

  provide<T>(
    key: ServiceKey,
    value: T,
    opts?: { label?: string },
  ): Disposer {
    this.assertMutable();
    const rk = this.realmOf(key, opts);
    const binding: Binding = {
      value,
      owner: this,
      consumers: new Set(),
    };
    this.registry.set(rk, binding);
    this.providedKeys.add(rk);

    const entry: EffectEntry = {
      dispose: () => {
        const current = this.registry.get(rk);
        if (current === binding) {
          this.registry.delete(rk);
        }
        this.providedKeys.delete(rk);
      },
      meta: { label: `provide(${keyLabel(key)})`, children: [] },
      bindingKey: rk,
    };
    this.effects.push(entry);

    let once = false;
    return () => {
      if (once) return;
      once = true;
      const idx = this.effects.indexOf(entry);
      if (idx >= 0) this.effects.splice(idx, 1);
      void entry.dispose();
    };
  }

  effect(
    run: () => Disposer | Promise<Disposer>,
    meta?: { label?: string },
  ): Disposer {
    this.assertMutable();
    const result = run();
    if (result instanceof Promise) {
      throw new ComposeStateError(
        `async effect factory is not supported in C0; await inside activate(setup) then register sync disposer (scope "${this.id}")`,
      );
    }
    const entry: EffectEntry = {
      dispose: result,
      meta:
        meta?.label !== undefined
          ? { label: meta.label, children: [] }
          : { children: [] },
    };
    this.effects.push(entry);

    let once = false;
    const publicDispose: Disposer = () => {
      if (once) return;
      once = true;
      const idx = this.effects.indexOf(entry);
      if (idx >= 0) this.effects.splice(idx, 1);
      return entry.dispose();
    };
    return publicDispose;
  }

  child(opts?: {
    id?: string;
    isolate?: RealmRef[];
    depend?: RealmRef[];
  }): Scope {
    this.assertMutable();
    const isolates = new Map(this.isolates);
    for (const ref of opts?.isolate ?? []) {
      isolates.set(ref.name, ref.label);
    }
    const child = new ScopeImpl({
      ...(opts?.id !== undefined ? { id: opts.id } : {}),
      parent: this,
      registry: this.registry,
      isolates,
      state: ScopeState.Pending,
    });
    for (const ref of opts?.depend ?? []) {
      child.depend(
        ref.name,
        ref.label === undefined ? undefined : { label: ref.label },
      );
    }
    this.children.push(child);
    return child;
  }

  async activate(setup?: () => void | Promise<void>): Promise<void> {
    if (this.state === ScopeState.Active) return;
    if (
      this.state === ScopeState.Disposed ||
      this.state === ScopeState.Unloading ||
      this.state === ScopeState.Failed
    ) {
      throw new ComposeStateError(
        `cannot activate scope "${this.id}" in state ${this.state}`,
      );
    }

    if (!this.depsSatisfied()) {
      this.state = ScopeState.Pending;
      return;
    }

    this.state = ScopeState.Loading;
    try {
      if (setup) await setup();
      // Wire consumer edges for declared deps now that we are becoming Active.
      for (const dep of this.deps) {
        const rk = realmKey(dep.name, dep.label);
        const binding = this.registry.get(rk);
        binding?.consumers.add(this);
      }
      this.state = ScopeState.Active;
    } catch (err) {
      this.state = ScopeState.Failed;
      this.failReason = err;
      throw err;
    }
  }

  whenReady(handler: () => void | Promise<void>): Disposer {
    if (
      this.state === ScopeState.Disposed ||
      this.state === ScopeState.Unloading ||
      this.state === ScopeState.Failed
    ) {
      throw new ComposeStateError(
        `whenReady() on scope "${this.id}" in state ${this.state}`,
      );
    }

    let cancelled = false;
    let gate: Promise<void> | undefined;

    const kick = (): void => {
      if (cancelled || gate) return;

      if (this.state === ScopeState.Active) {
        gate = (async () => {
          try {
            if (cancelled) return;
            await handler();
            cancelled = true;
            void off();
          } finally {
            gate = undefined;
          }
        })();
        void gate.catch(() => undefined);
        return;
      }

      if (
        this.state !== ScopeState.Pending &&
        this.state !== ScopeState.Loading
      ) {
        return;
      }
      // Sync gate: do not hold `gate` while still waiting on deps (notify race).
      if (!this.depsSatisfied()) return;

      gate = (async () => {
        try {
          if (cancelled) return;
          await this.activate();
          if (cancelled || this.state !== ScopeState.Active) return;
          await handler();
          cancelled = true;
          void off();
        } finally {
          gate = undefined;
        }
      })();
      void gate.catch(() => undefined);
    };

    const off = this.registry.onProvide(kick);
    kick();
    return () => {
      cancelled = true;
      void off();
    };
  }

  async dispose(): Promise<void> {
    if (this.state === ScopeState.Disposed) return;
    if (this.inertia) return this.inertia;

    this.inertia = this.runDispose();
    try {
      await this.inertia;
    } finally {
      this.inertia = undefined;
    }
  }

  dumpEffects(): EffectMeta[] {
    return this.effects.map((e) => ({
      ...(e.meta.label !== undefined ? { label: e.meta.label } : {}),
      children: [...e.meta.children],
    }));
  }

  private async runDispose(): Promise<void> {
    if (this.state === ScopeState.Disposed) return;

    // Pending / Failed / Loading with no effects: mark disposed and detach.
    if (
      this.state === ScopeState.Pending ||
      this.state === ScopeState.Failed ||
      this.state === ScopeState.Loading
    ) {
      await this.disposeChildrenOnly();
      this.state = ScopeState.Disposed;
      this.detachFromParent();
      this.clearConsumerEdges();
      return;
    }

    this.state = ScopeState.Unloading;

    // Ordering: dependents that still resolve to our provides unload first.
    const dependents = this.collectDependents();
    for (const dep of dependents) {
      if (dep.state !== ScopeState.Disposed) {
        await dep.dispose();
      }
    }

    // Remaining children (not already disposed via depend graph).
    await this.disposeChildrenOnly();

    // LIFO effects (includes provide withdrawals registered as effects).
    if (!this.disposedEffects) {
      this.disposedEffects = true;
      for (let i = this.effects.length - 1; i >= 0; i -= 1) {
        const entry = this.effects[i];
        if (!entry) continue;
        await entry.dispose();
      }
      this.effects.length = 0;
    }

    this.clearConsumerEdges();
    this.state = ScopeState.Disposed;
    this.detachFromParent();
  }

  private async disposeChildrenOnly(): Promise<void> {
    const kids = [...this.children].reverse();
    for (const child of kids) {
      if (child.state !== ScopeState.Disposed) {
        await child.dispose();
      }
    }
  }

  private collectDependents(): ScopeImpl[] {
    const out: ScopeImpl[] = [];
    const seen = new Set<ScopeImpl>();
    for (const rk of this.providedKeys) {
      const binding = this.registry.get(rk);
      if (!binding) continue;
      for (const consumer of binding.consumers) {
        if (consumer === this) continue;
        if (seen.has(consumer)) continue;
        // Only scopes that are still alive and not an ancestor disposing us.
        if (
          consumer.state === ScopeState.Disposed ||
          consumer.state === ScopeState.Unloading
        ) {
          continue;
        }
        seen.add(consumer);
        out.push(consumer);
      }
    }
    return out;
  }

  private depsSatisfied(): boolean {
    for (const dep of this.deps) {
      const rk = realmKey(dep.name, dep.label);
      if (!this.registry.get(rk)) return false;
    }
    return true;
  }

  private hasBinding(key: ServiceKey, opts?: { label?: string }): boolean {
    return this.lookupBinding(this.realmOf(key, opts)) !== undefined;
  }

  private lookupBinding(rk: string): Binding | undefined {
    return this.registry.get(rk);
  }

  private realmOf(key: ServiceKey, opts?: { label?: string }): string {
    const label =
      opts && "label" in opts ? opts.label : this.resolveDefaultLabel(key);
    return realmKey(key, label);
  }

  private resolveDefaultLabel(key: ServiceKey): string | undefined {
    if (this.isolates.has(key)) {
      return this.isolates.get(key);
    }
    return this.parent?.resolveDefaultLabel(key);
  }

  private assertMutable(): void {
    if (
      this.state !== ScopeState.Active &&
      this.state !== ScopeState.Loading
    ) {
      throw new ComposeStateError(
        `scope "${this.id}" must be Active or Loading (is ${this.state})`,
      );
    }
  }

  private assertNotTerminal(): void {
    if (
      this.state === ScopeState.Disposed ||
      this.state === ScopeState.Unloading ||
      this.state === ScopeState.Failed
    ) {
      throw new ComposeStateError(
        `scope "${this.id}" is ${this.state}`,
      );
    }
  }

  private detachFromParent(): void {
    if (!this.parent) return;
    const idx = this.parent.children.indexOf(this);
    if (idx >= 0) this.parent.children.splice(idx, 1);
  }

  private clearConsumerEdges(): void {
    for (const binding of this.registry.map.values()) {
      binding.consumers.delete(this);
    }
  }
}

export function createRootScope(opts?: { id?: string }): Scope {
  return new ScopeImpl({
    id: opts?.id ?? "root",
    parent: null,
    registry: new BindingRegistry(),
    isolates: new Map(),
    state: ScopeState.Active,
  });
}
