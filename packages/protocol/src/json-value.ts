/**
 * Lossless JSON snapshot (DSH `snapshotJsonValue` subset).
 *
 * Rejects BigInt / function / symbol / undefined / -0 / non-finite numbers /
 * cycles / sparse arrays / Map / Set / Date / class instances. One walk both
 * validates and detaches so append never stores a value `JSON.stringify`
 * would silently reshape.
 */

/** A value that round-trips through JSON without loss. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

function hasPlainArrayPrototype(value: unknown[]): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Array.prototype;
}

function hasPlainObjectPrototype(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function enumerableStringKeys(value: object): string[] | undefined {
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key !== "string") return undefined;
    if (!Object.prototype.propertyIsEnumerable.call(value, key)) return undefined;
  }
  return keys as string[];
}

type SnapshotDestination =
  | { readonly kind: "root" }
  | { readonly kind: "array"; readonly target: JsonValue[]; readonly index: number }
  | {
      readonly kind: "object";
      readonly target: { [key: string]: JsonValue };
      readonly key: string;
    };

type JsonWalkTask =
  | { readonly kind: "visit"; readonly value: unknown; readonly destination?: SnapshotDestination }
  | {
      readonly kind: "array-item";
      readonly source: unknown[];
      readonly index: number;
      readonly target?: JsonValue[];
    }
  | {
      readonly kind: "object-property";
      readonly source: Record<string, unknown>;
      readonly key: string;
      readonly target?: { [key: string]: JsonValue };
    }
  | { readonly kind: "leave"; readonly source: object };

function walkJsonValue(value: unknown, detach: boolean): JsonValue | true | undefined {
  const ancestors = new Set<object>();
  let root: JsonValue | undefined;
  const assign = (destination: SnapshotDestination | undefined, item: JsonValue): void => {
    if (destination === undefined) return;
    if (destination.kind === "root") {
      root = item;
    } else if (destination.kind === "array") {
      destination.target[destination.index] = item;
    } else {
      Object.defineProperty(destination.target, destination.key, {
        value: item,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  };

  const tasks: JsonWalkTask[] = [
    {
      kind: "visit",
      value,
      ...(detach ? { destination: { kind: "root" } as const } : {}),
    },
  ];
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if (task.kind === "leave") {
      ancestors.delete(task.source);
      continue;
    }
    if (task.kind === "array-item") {
      if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) {
        return undefined;
      }
      tasks.push({
        kind: "visit",
        value: task.source[task.index],
        ...(task.target === undefined
          ? {}
          : {
              destination: {
                kind: "array",
                target: task.target,
                index: task.index,
              } as const,
            }),
      });
      continue;
    }
    if (task.kind === "object-property") {
      tasks.push({
        kind: "visit",
        value: task.source[task.key],
        ...(task.target === undefined
          ? {}
          : {
              destination: {
                kind: "object",
                target: task.target,
                key: task.key,
              } as const,
            }),
      });
      continue;
    }

    const current = task.value;
    if (current === null) {
      assign(task.destination, null);
      continue;
    }
    if (typeof current === "boolean" || typeof current === "string") {
      assign(task.destination, current);
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current) || Object.is(current, -0)) return undefined;
      assign(task.destination, current);
      continue;
    }
    if (typeof current !== "object") return undefined;
    if (ancestors.has(current)) return undefined;

    if (Array.isArray(current)) {
      if (!hasPlainArrayPrototype(current)) return undefined;
      const length = current.length;
      if (Reflect.ownKeys(current).length !== length + 1) return undefined;
      const target = detach ? ([] as JsonValue[]) : undefined;
      if (target !== undefined) assign(task.destination, target);
      ancestors.add(current);
      tasks.push({ kind: "leave", source: current });
      for (let index = length - 1; index >= 0; index--) {
        tasks.push({
          kind: "array-item",
          source: current,
          index,
          ...(target === undefined ? {} : { target }),
        });
      }
      continue;
    }

    if (!hasPlainObjectPrototype(current)) return undefined;
    const keys = enumerableStringKeys(current);
    if (keys === undefined) return undefined;
    const target = detach ? ({} as { [key: string]: JsonValue }) : undefined;
    if (target !== undefined) assign(task.destination, target);
    ancestors.add(current);
    tasks.push({ kind: "leave", source: current });
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === undefined) return undefined;
      tasks.push({
        kind: "object-property",
        source: current as Record<string, unknown>,
        key,
        ...(target === undefined ? {} : { target }),
      });
    }
  }
  return detach ? root : true;
}

/**
 * Validate and detach lossless JSON in one read per property.
 * @returns the detached snapshot, or `undefined` when not losslessly serializable.
 */
export function snapshotJsonValue<T>(value: T): T | undefined {
  return walkJsonValue(value, true) as T | undefined;
}

/** Same rules as {@link snapshotJsonValue} without detaching. */
export function isJsonValue(value: unknown): boolean {
  return walkJsonValue(value, false) === true;
}

/**
 * Throw when `value` is not lossless JSON. Used at session append / seed so
 * flush never discovers Map/Date/BigInt mid-batch.
 */
export function assertLosslessJson<T>(value: T, label = "value"): T {
  const snapshot = snapshotJsonValue(value);
  if (snapshot === undefined) {
    throw new Error(`${label} is not losslessly JSON-serializable`);
  }
  return snapshot;
}
