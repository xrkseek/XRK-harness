/**
 * Startup audit classification (DSH app-boot inactiveEntries / startupDiagnostic).
 * Distinguishes hard failures from plugins still waiting on services.
 */

export type StartupFailureOutcome =
  | { readonly kind: "failed"; readonly error: unknown; readonly phase?: string }
  | { readonly kind: "pending"; readonly missing: readonly string[] };

export interface StartupEntryDiagnostic {
  readonly id: string;
  readonly required: boolean;
  readonly outcome: StartupFailureOutcome;
  /** Optional module / entry path for the full log. */
  readonly module?: string;
}

/** Concise terminal diagnostic with non-enumerable entry metadata (DSH StartupError). */
export class StartupError extends Error {
  constructor(
    message: string,
    readonly entries: readonly StartupEntryDiagnostic[],
  ) {
    const failures = entries.flatMap((e) =>
      e.outcome.kind === "failed" ? [e.outcome.error] : [],
    );
    super(
      message,
      failures.length > 0
        ? { cause: new AggregateError(failures, "Plugin activation failures") }
        : undefined,
    );
    this.name = "StartupError";
    Object.defineProperty(this, "entries", { enumerable: false });
  }
}

/** Parse "waiting for service(s): a, b" style messages into pending missing ids. */
export function missingServicesFromMessage(
  message: string,
): readonly string[] | undefined {
  const m = message.match(
    /waiting for services?:\s*([^\n)]+)/i,
  );
  if (!m?.[1]) return undefined;
  const parts = m[1]
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "unknown");
  return parts.length > 0 ? parts : ["unknown"];
}

/**
 * Heuristic: Cordis / loader messages that mean inject not ready yet
 * (not a hard import/execute failure).
 */
export function isPendingServiceMessage(message: string): boolean {
  return (
    /waiting for service/i.test(message) ||
    /missing service/i.test(message) ||
    /unresolved inject/i.test(message) ||
    /service not (yet )?available/i.test(message)
  );
}

function failureDetail(
  outcome: Extract<StartupFailureOutcome, { kind: "failed" }>,
): string {
  const err = outcome.error;
  const base =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  return outcome.phase ? `${base} (${outcome.phase})` : base;
}

function entryLine(entry: StartupEntryDiagnostic): string {
  const detail =
    entry.outcome.kind === "failed"
      ? failureDetail(entry.outcome)
      : `pending (waiting for ${
          entry.outcome.missing.length === 1 ? "service" : "services"
        }: ${entry.outcome.missing.join(", ") || "unknown"})`;
  const req = entry.required ? " [required]" : "";
  return `  - ${entry.id}${req}: ${detail}`;
}

/**
 * Group startup failures vs waiting services (required pending listed first).
 * Bin name defaults to `xrkh`.
 */
export function formatStartupDiagnostic(
  entries: readonly StartupEntryDiagnostic[],
  binName = "xrkh",
): string {
  const required = entries.filter((e) => e.required);
  const requiredCount = required.length > 0 ? required.length : entries.length;
  const lines = [
    `${binName}: startup failed: ${String(requiredCount)} required ${
      requiredCount === 1 ? "plugin" : "plugins"
    } did not activate`,
  ];
  const failed = entries.filter((e) => e.outcome.kind === "failed");
  const pending = entries
    .filter((e) => e.outcome.kind === "pending")
    .slice()
    .sort((a, b) => Number(b.required) - Number(a.required));

  if (failed.length > 0) {
    lines.push("", `Failed plugins (${String(failed.length)}):`);
    for (const entry of failed) lines.push(entryLine(entry));
  }
  if (pending.length > 0) {
    const width =
      Math.max("Plugin".length, ...pending.map((e) => e.id.length)) + 2;
    lines.push(
      "",
      `Plugins waiting for services (${String(pending.length)}):`,
      `  ${"Plugin".padEnd(width)}Missing services`,
    );
    for (const entry of pending) {
      const missing =
        entry.outcome.kind === "pending"
          ? entry.outcome.missing.join(", ") || "unknown"
          : "unknown";
      const mark = entry.required ? " *" : "";
      lines.push(`  ${`${entry.id}${mark}`.padEnd(width)}${missing}`);
    }
  }
  return lines.join("\n");
}

export function entriesFromPluginFailures(
  failures: readonly {
    readonly id: string;
    readonly required: boolean;
    readonly message: string;
    readonly kind?: "failed" | "pending";
    readonly missing?: readonly string[];
  }[],
): StartupEntryDiagnostic[] {
  return failures.map((f) => {
    if (f.kind === "pending" || isPendingServiceMessage(f.message)) {
      const missing =
        f.missing ??
        missingServicesFromMessage(f.message) ??
        (["unknown"] as const);
      return {
        id: f.id,
        required: f.required,
        outcome: { kind: "pending", missing },
      };
    }
    return {
      id: f.id,
      required: f.required,
      outcome: { kind: "failed", error: f.message },
    };
  });
}

/** Build a StartupError from classified entries (or a single host-level failure). */
export function startupErrorFromUnknown(
  err: unknown,
  binName = "xrkh",
): StartupError {
  if (err instanceof StartupError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const entries: StartupEntryDiagnostic[] = [
    {
      id: "host",
      required: true,
      outcome: { kind: "failed", error: err },
    },
  ];
  return new StartupError(
    `${binName}: startup failed: ${message}`,
    entries,
  );
}
