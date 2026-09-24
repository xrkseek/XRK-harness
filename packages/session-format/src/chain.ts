/**
 * Adjacent migration vocabulary (learned from dsh `session-format` chain).
 * Exact from→from+1 edges only — no skip versions.
 */

export class SessionFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionFormatError";
  }
}

/** Stored format is newer than this build, or a required adjacent edge is missing. */
export class SessionFormatUnsupportedMigrationError extends SessionFormatError {
  constructor(message: string) {
    super(message);
    this.name = "SessionFormatUnsupportedMigrationError";
  }
}

/** One independently maintained adjacent conversion. */
export interface AdjacentMigration<TCtx> {
  readonly name: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  apply(ctx: TCtx): void;
}

export interface AdjacentChainOptions<TCtx> {
  readonly currentVersion: number;
  readonly migrations: readonly AdjacentMigration<TCtx>[];
}

/** Pure adjacent planner — apply in order from stored version to current. */
export interface AdjacentChain<TCtx> {
  readonly currentVersion: number;
  /** Ordered edges from `fromVersion` (exclusive of already-current). */
  plan(fromVersion: number): readonly AdjacentMigration<TCtx>[];
  /** Run all planned edges; return {@link currentVersion}. */
  migrate(fromVersion: number, ctx: TCtx): number;
}

function requireVersion(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new SessionFormatError(`${label} must be a non-negative integer`);
  }
  return value;
}

/** Validate and freeze one adjacent migration declaration. */
export function defineAdjacentMigration<TCtx>(
  migration: AdjacentMigration<TCtx>,
): AdjacentMigration<TCtx> {
  if (typeof migration.name !== "string" || migration.name.length === 0) {
    throw new SessionFormatError("migration name must be a non-empty string");
  }
  const from = requireVersion(migration.fromVersion, `${migration.name} fromVersion`);
  const to = requireVersion(migration.toVersion, `${migration.name} toVersion`);
  if (to !== from + 1) {
    throw new SessionFormatError(
      `${migration.name} must declare adjacent v${from}->v${from + 1}`,
    );
  }
  return Object.freeze({ ...migration });
}

/**
 * Compile a unique, complete adjacent migration chain (dsh-style).
 * Requires exactly one edge for each `v → v+1` where `0 ≤ v < currentVersion`.
 */
export function createAdjacentChain<TCtx>(
  options: AdjacentChainOptions<TCtx>,
): AdjacentChain<TCtx> {
  const currentVersion = requireVersion(
    options.currentVersion,
    "current format version",
  );
  const byFrom = new Map<number, AdjacentMigration<TCtx>>();
  const names = new Set<string>();
  for (const candidate of options.migrations) {
    const migration = defineAdjacentMigration(candidate);
    if (byFrom.has(migration.fromVersion)) {
      throw new SessionFormatError(
        `migration v${migration.fromVersion}->v${migration.toVersion} is duplicated`,
      );
    }
    if (names.has(migration.name)) {
      throw new SessionFormatError(
        `migration name ${JSON.stringify(migration.name)} is duplicated`,
      );
    }
    byFrom.set(migration.fromVersion, migration);
    names.add(migration.name);
  }
  const ordered: AdjacentMigration<TCtx>[] = [];
  for (let version = 0; version < currentVersion; version += 1) {
    const migration = byFrom.get(version);
    if (migration === undefined) {
      throw new SessionFormatUnsupportedMigrationError(
        `migration v${version}->v${version + 1} is missing`,
      );
    }
    ordered.push(migration);
  }
  if (byFrom.size !== ordered.length) {
    const invalid = [...byFrom.keys()].find((v) => v >= currentVersion);
    throw new SessionFormatError(
      `migration from v${invalid} does not lead to current v${currentVersion}`,
    );
  }
  const migrations = Object.freeze(ordered);

  function plan(fromVersion: number): readonly AdjacentMigration<TCtx>[] {
    const from = requireVersion(fromVersion, "stored format version");
    if (from > currentVersion) {
      throw new SessionFormatUnsupportedMigrationError(
        `stored format uses newer v${from}; this build writes v${currentVersion}`,
      );
    }
    return Object.freeze(migrations.slice(from));
  }

  return Object.freeze({
    currentVersion,
    plan,
    migrate(fromVersion: number, ctx: TCtx): number {
      for (const step of plan(fromVersion)) {
        step.apply(ctx);
      }
      return currentVersion;
    },
  });
}
