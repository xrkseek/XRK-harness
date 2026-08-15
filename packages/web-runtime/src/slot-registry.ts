/**
 * XRK SlotRegistry — complete SlotCore semantics without Cordis / React / SlotMap merge.
 *
 * Essence from DeepSeek `ui-slots` SlotCore:
 * - kinds: single | list | keyed | chain
 * - declare via root children (or define)
 * - priority shadowing; list order; cascade dispose
 * - abdicate / reportEntryError
 */

export type SlotKind = "single" | "list" | "keyed" | "chain";
export type SlotScope = "root" | "session-maybe" | "session";

export interface SlotSpec {
  readonly kind: SlotKind;
  readonly scope: SlotScope;
}

export type ChainSelect<TOwner = unknown> = (
  owner: TOwner,
) => "matched" | null;

export interface SlotRegisterOptions {
  readonly name: string;
  readonly priority?: number;
  /** keyed */
  readonly key?: string;
  /** list */
  readonly id?: string;
  readonly order?: number;
  readonly label?: string;
  /** chain */
  readonly select?: ChainSelect;
  /** Declare child slots; this registrant becomes their sole declarer. */
  readonly children?: Readonly<Record<string, SlotSpec>>;
  /** Opaque shared handle — pinned to one scope for its lifetime. */
  readonly store?: object;
  readonly registrant?: string;
}

export interface SlotEntry<T = unknown> {
  readonly contribution: T;
  readonly options: {
    readonly key?: string;
    readonly id?: string;
    readonly order?: number;
    readonly label?: string;
    readonly priority?: number;
  };
  readonly select?: ChainSelect;
  readonly children?: Readonly<Record<string, SlotSpec>>;
  readonly store?: object;
  readonly registrant?: string;
}

export interface LiveSlotOccupant {
  readonly registrant?: string;
  readonly key?: string;
  readonly id?: string;
  readonly order?: number;
  readonly priority: number;
  readonly active: boolean;
}

export interface LiveSlotNode {
  readonly name: string;
  readonly kind: SlotKind;
  readonly scope: SlotScope;
  readonly declaredBy?: string;
  readonly occupants: readonly LiveSlotOccupant[];
  readonly children: readonly LiveSlotNode[];
}

interface SlotRecord {
  spec: SlotSpec | undefined;
  declaredBy: string | undefined;
  parent: string | undefined;
  declarationEpoch: number;
  entries: SlotEntry[];
  version: number;
  listeners: Set<() => void>;
  declarationListeners: Set<() => void>;
}

const NO_ENTRIES: SlotEntry[] = [];

export class SlotRegistry {
  private readonly records = new Map<string, SlotRecord>();
  private readonly mutateListeners = new Set<(key: string) => void>();
  private readonly handleScopes = new Map<
    object,
    { scope: SlotScope; count: number }
  >();
  private readonly dirty = new Set<SlotRecord>();
  private flushScheduled = false;
  private readonly abdicated = new WeakSet<SlotEntry>();
  private readonly entryErrorListeners = new Set<
    (
      key: string,
      entry: SlotEntry,
      error: unknown,
      info: { abdicated: boolean },
    ) => void
  >();

  constructor() {
    const root = this.record("root");
    root.spec = { kind: "single", scope: "root" };
    root.declaredBy = "(built-in)";
    root.declarationEpoch = 1;
  }

  /**
   * Explicitly declare a slot (alternative to children table).
   * Fails if already declared by another registrant.
   */
  define(name: string, spec: SlotSpec, declaredBy = "(define)"): void {
    const rec = this.record(name);
    if (rec.spec) {
      throw new Error(
        `slot "${name}" is already declared (by ${rec.declaredBy ?? "unknown"})`,
      );
    }
    rec.spec = spec;
    rec.declaredBy = declaredBy;
    rec.declarationEpoch += 1;
    this.markDirty(name, rec);
    this.notifyDeclaration(rec);
  }

  register<T>(options: SlotRegisterOptions, contribution: T): () => void {
    const rec = this.records.get(options.name);
    if (!rec?.spec) {
      throw new Error(
        `slot "${options.name}" is not declared (a parent entry's children table must declare it, or call define)`,
      );
    }
    const spec = rec.spec;
    const priority = options.priority ?? 0;
    const occupantHint = (occupant: SlotEntry) =>
      `at priority ${priority}${occupant.registrant !== undefined ? ` (registered by ${occupant.registrant})` : ""} — register at a different priority to shadow it (lowest renders)`;

    switch (spec.kind) {
      case "single": {
        const occupant = rec.entries.find(
          (e) => (e.options.priority ?? 0) === priority,
        );
        if (occupant) {
          throw new Error(
            `single slot "${options.name}" already has a registration ${occupantHint(occupant)}`,
          );
        }
        break;
      }
      case "keyed": {
        if (options.key === undefined) {
          throw new Error(`keyed slot "${options.name}" requires options.key`);
        }
        const occupant = rec.entries.find(
          (e) =>
            e.options.key === options.key &&
            (e.options.priority ?? 0) === priority,
        );
        if (occupant) {
          throw new Error(
            `keyed slot "${options.name}" already has an entry for key "${options.key}" ${occupantHint(occupant)}`,
          );
        }
        break;
      }
      case "list": {
        if (options.id === undefined) {
          throw new Error(`list slot "${options.name}" requires options.id`);
        }
        const occupant = rec.entries.find(
          (e) =>
            e.options.id === options.id &&
            (e.options.priority ?? 0) === priority,
        );
        if (occupant) {
          throw new Error(
            `list slot "${options.name}" already has an entry with id "${options.id}" ${occupantHint(occupant)}`,
          );
        }
        break;
      }
      case "chain":
        if (options.select === undefined) {
          throw new Error(
            `chain slot "${options.name}" requires options.select`,
          );
        }
        break;
    }

    if (options.children) {
      for (const childKey of Object.keys(options.children)) {
        const childRec = this.records.get(childKey);
        if (childRec?.spec) {
          throw new Error(
            `slot "${childKey}" is already declared (by ${childRec.declaredBy ?? "an unknown entry"})`,
          );
        }
      }
    }

    if (options.store !== undefined) {
      const pinned = this.handleScopes.get(options.store);
      if (pinned && pinned.scope !== spec.scope) {
        throw new Error(
          `store handle mounted under "${options.name}" (scope "${spec.scope}") is already mounted under scope "${pinned.scope}" — one handle, one scope`,
        );
      }
      if (pinned) pinned.count += 1;
      else this.handleScopes.set(options.store, { scope: spec.scope, count: 1 });
    }

    const entry: SlotEntry<T> = {
      contribution,
      options: {
        ...(options.key !== undefined ? { key: options.key } : {}),
        ...(options.id !== undefined ? { id: options.id } : {}),
        ...(options.order !== undefined ? { order: options.order } : {}),
        ...(options.label !== undefined ? { label: options.label } : {}),
        ...(options.priority !== undefined
          ? { priority: options.priority }
          : {}),
      },
      ...(options.select !== undefined ? { select: options.select } : {}),
      ...(options.children !== undefined ? { children: options.children } : {}),
      ...(options.store !== undefined ? { store: options.store } : {}),
      ...(options.registrant !== undefined
        ? { registrant: options.registrant }
        : {}),
    };

    const next = [...rec.entries, entry];
    next.sort(
      spec.kind === "list"
        ? (a, b) =>
            (a.options.priority ?? 0) - (b.options.priority ?? 0) ||
            (a.options.order ?? 0) - (b.options.order ?? 0)
        : (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0),
    );
    rec.entries = next;
    this.markDirty(options.name, rec);

    if (options.children) {
      const declarations: [string, SlotRecord][] = [];
      for (const [childKey, childSpec] of Object.entries(options.children)) {
        const childRec = this.record(childKey);
        childRec.spec = childSpec;
        childRec.declaredBy = `an entry in "${options.name}"${options.registrant ? ` (${options.registrant})` : ""}`;
        childRec.parent = options.name;
        childRec.declarationEpoch += 1;
        declarations.push([childKey, childRec]);
      }
      for (const [childKey, childRec] of declarations) {
        this.markDirty(childKey, childRec);
      }
      for (const [, childRec] of declarations) {
        this.notifyDeclaration(childRec);
      }
    }

    return () => {
      if (!rec.entries.includes(entry)) return;
      rec.entries = rec.entries.filter((e) => e !== entry);
      this.markDirty(options.name, rec);
      this.releaseEntry(entry);
    };
  }

  isLive(entry: SlotEntry): boolean {
    for (const rec of this.records.values()) {
      if (rec.entries.includes(entry)) return true;
    }
    return false;
  }

  entries(key: string): readonly SlotEntry[] {
    return this.records.get(key)?.entries ?? NO_ENTRIES;
  }

  /**
   * Shadowing winners per cell. Chain returns raw ledger (election at select time).
   */
  entriesOfSlot(key: string): readonly SlotEntry[] {
    const rec = this.records.get(key);
    if (!rec?.spec) return NO_ENTRIES;
    const kind = rec.spec.kind;
    if (kind === "chain") return rec.entries;
    const heads: SlotEntry[] = [];
    const seenCells = new Set<string | undefined>();
    for (const entry of rec.entries) {
      if (this.abdicated.has(entry)) continue;
      const cell =
        kind === "keyed"
          ? entry.options.key
          : kind === "list"
            ? entry.options.id
            : undefined;
      if (seenCells.has(cell)) continue;
      seenCells.add(cell);
      heads.push(entry);
    }
    return heads;
  }

  /**
   * Elect first chain entry whose select(owner) returns "matched".
   */
  electChain<TOwner>(key: string, owner: TOwner): SlotEntry | undefined {
    const rec = this.records.get(key);
    if (!rec?.spec || rec.spec.kind !== "chain") return undefined;
    for (const entry of rec.entries) {
      if (this.abdicated.has(entry)) continue;
      if (entry.select?.(owner) === "matched") return entry;
    }
    return undefined;
  }

  spec(key: string): SlotSpec | undefined {
    return this.records.get(key)?.spec;
  }

  declarationEpoch(key: string): number {
    return this.records.get(key)?.declarationEpoch ?? 0;
  }

  getVersion(key: string): number {
    return this.records.get(key)?.version ?? 0;
  }

  subscribe(key: string, fn: () => void): () => void {
    const rec = this.record(key);
    rec.listeners.add(fn);
    return () => {
      rec.listeners.delete(fn);
    };
  }

  subscribeDeclaration(key: string, fn: () => void): () => void {
    const rec = this.record(key);
    rec.declarationListeners.add(fn);
    return () => {
      rec.declarationListeners.delete(fn);
    };
  }

  onMutate(fn: (key: string) => void): () => void {
    this.mutateListeners.add(fn);
    return () => {
      this.mutateListeners.delete(fn);
    };
  }

  reportEntryError(
    key: string,
    entry: SlotEntry,
    error: unknown,
    info: { abdicate: boolean },
  ): void {
    if (info.abdicate) {
      if (this.abdicated.has(entry)) return;
      this.abdicated.add(entry);
      const rec = this.records.get(key);
      if (rec !== undefined) this.markDirty(key, rec);
    }
    for (const fn of [...this.entryErrorListeners]) {
      fn(key, entry, error, { abdicated: info.abdicate });
    }
  }

  onEntryError(
    fn: (
      key: string,
      entry: SlotEntry,
      error: unknown,
      info: { abdicated: boolean },
    ) => void,
  ): () => void {
    this.entryErrorListeners.add(fn);
    return () => {
      this.entryErrorListeners.delete(fn);
    };
  }

  snapshot(root?: string): LiveSlotNode[] {
    const build = (name: string, seen: Set<string>): LiveSlotNode | undefined => {
      const record = this.records.get(name);
      if (record?.spec === undefined || seen.has(name)) return undefined;
      const branch = new Set(seen);
      branch.add(name);
      const active = new Set(this.entriesOfSlot(name));
      const children = [...this.records.entries()]
        .filter(
          ([, candidate]) =>
            candidate.spec !== undefined && candidate.parent === name,
        )
        .flatMap(([child]) => {
          const node = build(child, branch);
          return node === undefined ? [] : [node];
        });
      return {
        name,
        kind: record.spec.kind,
        scope: record.spec.scope,
        ...(record.declaredBy === undefined
          ? {}
          : { declaredBy: record.declaredBy }),
        occupants: record.entries.map((entry) => ({
          ...(entry.registrant === undefined
            ? {}
            : { registrant: entry.registrant }),
          ...(entry.options.key === undefined ? {} : { key: entry.options.key }),
          ...(entry.options.id === undefined ? {} : { id: entry.options.id }),
          ...(entry.options.order === undefined
            ? {}
            : { order: entry.options.order }),
          priority: entry.options.priority ?? 0,
          active: active.has(entry),
        })),
        children,
      };
    };

    if (root !== undefined) {
      const node = build(root, new Set());
      return node === undefined ? [] : [node];
    }
    return [...this.records.entries()]
      .filter(
        ([, record]) =>
          record.spec !== undefined &&
          (record.parent === undefined ||
            this.records.get(record.parent)?.spec === undefined),
      )
      .flatMap(([name]) => {
        const node = build(name, new Set());
        return node === undefined ? [] : [node];
      });
  }

  private releaseEntry(entry: SlotEntry): void {
    if (entry.store !== undefined) {
      const pinned = this.handleScopes.get(entry.store);
      if (pinned && --pinned.count === 0) this.handleScopes.delete(entry.store);
    }
    if (!entry.children) return;
    for (const childKey of Object.keys(entry.children)) {
      const childRec = this.records.get(childKey);
      if (!childRec) continue;
      const doomed = childRec.entries;
      childRec.spec = undefined;
      childRec.declaredBy = undefined;
      childRec.parent = undefined;
      childRec.declarationEpoch += 1;
      childRec.entries = NO_ENTRIES;
      this.markDirty(childKey, childRec);
      this.notifyDeclaration(childRec);
      for (const dead of doomed) this.releaseEntry(dead);
    }
  }

  private record(key: string): SlotRecord {
    let rec = this.records.get(key);
    if (!rec) {
      rec = {
        spec: undefined,
        declaredBy: undefined,
        parent: undefined,
        declarationEpoch: 0,
        entries: NO_ENTRIES,
        version: 0,
        listeners: new Set(),
        declarationListeners: new Set(),
      };
      this.records.set(key, rec);
    }
    return rec;
  }

  private markDirty(key: string, rec: SlotRecord): void {
    rec.version += 1;
    for (const fn of [...this.mutateListeners]) fn(key);
    this.dirty.add(rec);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => {
        this.flush();
      });
    }
  }

  private flush(): void {
    this.flushScheduled = false;
    const batch = [...this.dirty];
    this.dirty.clear();
    for (const rec of batch) {
      for (const fn of [...rec.listeners]) fn();
    }
  }

  private notifyDeclaration(rec: SlotRecord): void {
    for (const fn of [...rec.declarationListeners]) fn();
  }
}
