/**
 * Last-good config retention (DSH settings-file.refresh / Codex instructions).
 * Parse failure keeps the previous valid document; never silently treat
 * corrupt on-disk text as empty and continue writing over it.
 */

export class ConfigParseError extends Error {
  readonly file: string;

  constructor(file: string, detail: string) {
    super(`${file}: ${detail}`);
    this.name = "ConfigParseError";
    this.file = file;
  }
}

export function isEnoent(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      (err as NodeJS.ErrnoException).code === "ENOENT",
  );
}

export type ConfigDocLoad =
  | { readonly status: "ok"; readonly doc: Record<string, unknown> }
  | { readonly status: "missing"; readonly doc: Record<string, unknown> }
  | {
      readonly status: "invalid";
      readonly error: string;
      /** Last successfully parsed doc, or `{}` when none yet. */
      readonly doc: Record<string, unknown>;
    };

/**
 * Classify a load of a mapping document.
 * `lastGood` is returned unchanged on missing/invalid (caller owns the cache).
 */
export function classifyConfigDoc(
  parsed: unknown,
  lastGood: Record<string, unknown> | undefined,
): ConfigDocLoad {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      status: "invalid",
      error: "root must be a mapping object",
      doc: lastGood ? structuredClone(lastGood) : {},
    };
  }
  return { status: "ok", doc: parsed as Record<string, unknown> };
}

export function keepLastGoodMessage(
  file: string,
  error: string,
): string {
  return `${file}: parse failed; keeping last good document (${error})`;
}

export function refuseOverwriteDetail(error: string): string {
  return `unparsable; refusing to overwrite (keeping last good) (${error})`;
}
