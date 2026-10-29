/**
 * Storage domain: the durable, per-plugin JSON object `$.store` writes to.
 *
 * Upstream this is its own composable service (`dsh-storage-domain`). This
 * repository has no such service yet, so the contract lives here — with the
 * same shape the bridge was written against (`ctx.get('storageDomain').open(spec)`
 * returning a domain whose tables read synchronously and write asynchronously)
 * — plus a JSON-file implementation a Host can compose in one line:
 *
 * ```ts
 * ctx.plugin(createJsonStorageDomain({ root: path.join(home, 'mods-store') }))
 * ```
 *
 * Tables are loaded fully into memory when the domain opens: the store holds a
 * handful of small JSON objects per plugin (capped at 4 MiB by the bridge), so
 * `get` can stay synchronous as the `$.store` handlers expect.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** One table's value type, declared with the schema the host would validate. */
export interface DomainTableSpec<V> {
  /** Present for hosts that validate on write; this one only passes it through. */
  readonly schema?: unknown;
  /** Phantom marker so `DomainTableSpec<V>` infers `V` at `table()`. */
  readonly __value?: V;
}

export interface DomainSpec {
  readonly name: string;
  readonly version: number;
  readonly tables: Readonly<Record<string, DomainTableSpec<unknown>>>;
}

/** Declare a table. `V` is the stored value, `K` the key type (informational). */
export function domainTable<K, V>(schema?: unknown): DomainTableSpec<V> {
  void 0 satisfies K | undefined;
  return schema === undefined ? {} : { schema };
}

/** Declare a domain (name + version + tables). Identity function by design. */
export function defineDomain<const S extends DomainSpec>(spec: S): S {
  return spec;
}

type TableValue<S extends DomainSpec, K extends keyof S["tables"]> =
  S["tables"][K] extends DomainTableSpec<infer V> ? V : never;

/** A table inside an open domain: synchronous reads, awaited writes. */
export interface DomainTable<V> {
  get(key: string): V | undefined;
  put(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): readonly string[];
}

export interface Domain<S extends DomainSpec = DomainSpec> {
  readonly spec: S;
  table<K extends keyof S["tables"]>(name: K): DomainTable<TableValue<S, K>>;
  close(): Promise<void>;
}

/** The service a Host composes; `$.store` needs it to exist. */
export interface StorageDomainService {
  open<S extends DomainSpec>(spec: S): Promise<Domain<S>>;
}

declare module "@xrkseek/cordis" {
  interface Context {
    storageDomain: StorageDomainService;
  }
}

export interface JsonStorageDomainOptions {
  /** Directory holding one `<domain>.json` per opened domain. */
  readonly root: string;
}

type StoredTables = Record<string, Record<string, unknown>>;

/** Open domain backed by a single JSON file, read once and written on change. */
function openJsonDomain<S extends DomainSpec>(
  spec: S,
  root: string,
): Promise<Domain<S>> {
  const file = path.join(root, `${spec.name}.json`);
  const tables = new Map<string, Map<string, unknown>>();
  for (const name of Object.keys(spec.tables)) tables.set(name, new Map());

  const persist = async (): Promise<void> => {
    const encoded: StoredTables = {};
    for (const [name, table] of tables) encoded[name] = Object.fromEntries(table);
    const text = JSON.stringify(encoded);
    await mkdir(root, { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, text, "utf8");
    await rename(temporary, file);
  };

  let writes: Promise<void> = Promise.resolve();
  const serialize = (work: () => Promise<void>): Promise<void> => {
    const next = writes.then(work, work);
    writes = next.catch(() => undefined);
    return next;
  };

  return (async () => {
    try {
      const text = await readFile(file, "utf8");
      const parsed = JSON.parse(text) as StoredTables;
      for (const [name, table] of tables) {
        const stored = parsed[name];
        if (stored === undefined) continue;
        for (const [key, value] of Object.entries(stored)) table.set(key, value);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    return {
      spec,
      table<K extends keyof S["tables"]>(name: K): DomainTable<TableValue<S, K>> {
        const table = tables.get(name as string);
        if (table === undefined)
          throw new Error(
            `storage domain "${spec.name}" has no table "${String(name)}"`,
          );
        return {
          get: (key: string) => table.get(key) as TableValue<S, K> | undefined,
          put: async (key: string, value: TableValue<S, K>) => {
            table.set(key, value);
            await serialize(persist);
          },
          delete: async (key: string) => {
            table.delete(key);
            await serialize(persist);
          },
          keys: () => [...table.keys()],
        };
      },
      close: async () => {
        await writes;
      },
    };
  })();
}

/**
 * Compose a file-backed storage domain service.
 *
 * This is the one-service implementation of `StorageDomainService`; a Host that
 * already owns durable storage should provide its own instead.
 */
export function createJsonStorageDomain(
  options: JsonStorageDomainOptions,
): StorageDomainService {
  const root = options.root;
  return {
    open: <S extends DomainSpec>(spec: S) => openJsonDomain(spec, root),
  };
}
