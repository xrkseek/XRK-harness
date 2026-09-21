import { CronError, MIN_EVERY_SECONDS, type CronSchedule } from "./types.js";

function parseCronField(
  field: string,
  min: number,
  max: number,
): ReadonlySet<number> | "any" {
  const trimmed = field.trim();
  if (trimmed === "*") return "any";
  const out = new Set<number>();
  for (const part of trimmed.split(",")) {
    const stepMatch = /^(\*|\d+)-?(\d+)?\/(\d+)$/.exec(part);
    if (stepMatch) {
      const start = stepMatch[1] === "*" ? min : Number(stepMatch[1]);
      const end = stepMatch[2] !== undefined ? Number(stepMatch[2]) : max;
      const step = Number(stepMatch[3]);
      if (!Number.isFinite(step) || step < 1) {
        throw new CronError(`invalid cron step: ${part}`, "CRON_SCHEDULE");
      }
      for (let i = start; i <= end; i += step) {
        if (i >= min && i <= max) out.add(i);
      }
      continue;
    }
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      for (let i = a; i <= b; i++) {
        if (i >= min && i <= max) out.add(i);
      }
      continue;
    }
    const n = Number(part);
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new CronError(`invalid cron field value: ${part}`, "CRON_SCHEDULE");
    }
    out.add(n);
  }
  return out;
}

function matchesCronExpr(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronError(
      "cron expr must have 5 fields (min hour dom mon dow)",
      "CRON_SCHEDULE",
    );
  }
  const minute = parseCronField(parts[0]!, 0, 59);
  const hour = parseCronField(parts[1]!, 0, 23);
  const dom = parseCronField(parts[2]!, 1, 31);
  const month = parseCronField(parts[3]!, 1, 12);
  const dow = parseCronField(parts[4]!, 0, 6);
  const ok = (
    set: ReadonlySet<number> | "any",
    value: number,
  ): boolean => (set === "any" ? true : set.has(value));
  return (
    ok(minute, date.getUTCMinutes()) &&
    ok(hour, date.getUTCHours()) &&
    ok(dom, date.getUTCDate()) &&
    ok(month, date.getUTCMonth() + 1) &&
    ok(dow, date.getUTCDay())
  );
}

/** Validate schedule shape; throw CronError on bad input. */
export function assertSchedule(schedule: CronSchedule): void {
  if (schedule.kind === "every") {
    if (
      !Number.isFinite(schedule.everySeconds) ||
      schedule.everySeconds < MIN_EVERY_SECONDS
    ) {
      throw new CronError(
        `everySeconds must be >= ${MIN_EVERY_SECONDS}`,
        "CRON_SCHEDULE",
      );
    }
    return;
  }
  if (schedule.kind === "at") {
    const t = Date.parse(schedule.at);
    if (!Number.isFinite(t)) {
      throw new CronError(`invalid at timestamp: ${schedule.at}`, "CRON_SCHEDULE");
    }
    return;
  }
  // cron
  matchesCronExpr(schedule.expr, new Date());
}

/**
 * Compute next UTC fire time after `from` (exclusive for every/cron; at is absolute).
 */
export function nextRunAt(
  schedule: CronSchedule,
  from: Date = new Date(),
): string | null {
  assertSchedule(schedule);
  if (schedule.kind === "at") {
    const t = Date.parse(schedule.at);
    return t > from.getTime() ? new Date(t).toISOString() : null;
  }
  if (schedule.kind === "every") {
    const next = new Date(from.getTime() + schedule.everySeconds * 1000);
    return next.toISOString();
  }
  // Scan forward up to 366 days of minutes for the next cron match.
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  const limit = from.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (cursor.getTime() <= limit) {
    if (matchesCronExpr(schedule.expr, cursor)) {
      return cursor.toISOString();
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}

export function isDue(
  nextRunAtIso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!nextRunAtIso) return false;
  const t = Date.parse(nextRunAtIso);
  return Number.isFinite(t) && t <= now.getTime();
}
