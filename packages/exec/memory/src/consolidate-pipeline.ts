/**
 * Session-end curated-memory consolidate pipeline (Codex-style lease + Hermes status).
 * Single-flight per session: archive/stop/dispose share one claim so Phase1 cannot double-write.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CuratedMemoryStore } from "./store.js";
import {
  consolidateCuratedMemoryPhase1,
  consolidateCuratedMemoryPhase2,
  type Phase2CompleteFn,
} from "./write-path.js";

export const CONSOLIDATE_LEASE_FILE = ".consolidate-lease.json";
export const CONSOLIDATE_REPORT_FILE = ".last-consolidate.json";

const DEFAULT_TTL_MS = 120_000;

/** In-process claims keyed by session id (cross-call within one Host). */
const processClaims = new Map<string, { holder: string; at: number; ttlMs: number }>();

export type CuratedMemoryPhase2Status =
  | "skipped"
  | "written"
  | "failed"
  | "no-llm";

export interface CuratedMemoryConsolidateReport {
  readonly sessionId: string;
  readonly at: number;
  readonly skipped?: "busy" | "no-user-text";
  readonly phase1Written: number;
  readonly phase2: CuratedMemoryPhase2Status;
  readonly phase2Written: number;
  readonly providerKind?: string;
}

interface LeaseFileShape {
  readonly sessionId: string;
  readonly holder: string;
  readonly at: number;
  readonly ttlMs: number;
}

function leasePath(dir: string): string {
  return path.join(dir, CONSOLIDATE_LEASE_FILE);
}

function reportPath(dir: string): string {
  return path.join(dir, CONSOLIDATE_REPORT_FILE);
}

function newHolder(): string {
  return `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function leaseAlive(
  claim: { at: number; ttlMs: number },
  now: number,
): boolean {
  return now - claim.at < claim.ttlMs;
}

/**
 * Claim a consolidate slot for `sessionId`. Returns a release fn on success.
 * Failures (busy / I/O) return `{ ok: false }`.
 */
export function tryClaimConsolidateLease(
  sessionId: string,
  options?: {
    readonly dir?: string;
    readonly ttlMs?: number;
    readonly now?: number;
  },
): { readonly ok: true; readonly release: () => void } | { readonly ok: false } {
  const id = sessionId.trim();
  if (!id) return { ok: false };
  const now = options?.now ?? Date.now();
  const ttlMs = Math.max(5_000, options?.ttlMs ?? DEFAULT_TTL_MS);
  const existing = processClaims.get(id);
  if (existing && leaseAlive(existing, now)) return { ok: false };

  const holder = newHolder();
  processClaims.set(id, { holder, at: now, ttlMs });

  const dir = options?.dir?.trim();
  if (dir) {
    try {
      mkdirSync(dir, { recursive: true });
      const file = leasePath(dir);
      try {
        const raw = JSON.parse(readFileSync(file, "utf8")) as LeaseFileShape;
        if (
          raw &&
          typeof raw.sessionId === "string" &&
          raw.sessionId === id &&
          typeof raw.at === "number" &&
          typeof raw.ttlMs === "number" &&
          leaseAlive(raw, now) &&
          raw.holder !== holder
        ) {
          processClaims.delete(id);
          return { ok: false };
        }
      } catch {
        /* missing / corrupt → take */
      }
      const payload: LeaseFileShape = { sessionId: id, holder, at: now, ttlMs };
      const tmp = `${file}.${holder}.tmp`;
      writeFileSync(tmp, JSON.stringify(payload), "utf8");
      try {
        renameSync(tmp, file);
      } catch {
        try {
          unlinkSync(tmp);
        } catch {
          /* ignore */
        }
        try {
          writeFileSync(file, JSON.stringify(payload), "utf8");
        } catch {
          processClaims.delete(id);
          return { ok: false };
        }
      }
    } catch {
      processClaims.delete(id);
      return { ok: false };
    }
  }

  const release = (): void => {
    const cur = processClaims.get(id);
    if (cur?.holder === holder) processClaims.delete(id);
    if (!dir) return;
    try {
      const raw = JSON.parse(readFileSync(leasePath(dir), "utf8")) as LeaseFileShape;
      if (raw?.holder === holder) unlinkSync(leasePath(dir));
    } catch {
      /* ignore */
    }
  };
  return { ok: true, release };
}

/** Read the last consolidate report sidecar (if any). */
export function readConsolidateReport(
  dir: string,
): CuratedMemoryConsolidateReport | undefined {
  try {
    const raw = JSON.parse(
      readFileSync(reportPath(dir), "utf8"),
    ) as CuratedMemoryConsolidateReport;
    if (!raw || typeof raw.sessionId !== "string" || typeof raw.at !== "number") {
      return undefined;
    }
    return raw;
  } catch {
    return undefined;
  }
}

export function writeConsolidateReport(
  dir: string,
  report: CuratedMemoryConsolidateReport,
): void {
  try {
    mkdirSync(dir, { recursive: true });
    const file = reportPath(dir);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(report), "utf8");
    try {
      renameSync(tmp, file);
    } catch {
      writeFileSync(file, JSON.stringify(report), "utf8");
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* best-effort observability */
  }
}

export interface RunCuratedMemoryConsolidateInput {
  readonly store: CuratedMemoryStore;
  readonly sessionId: string;
  readonly userTexts: readonly string[];
  readonly assistantTexts?: readonly string[];
  /** When set, run Phase2 after Phase1. */
  readonly phase2Complete?: Phase2CompleteFn;
  /**
   * When true and `phase2Complete` is missing, report `phase2: "no-llm"`
   * (Settings asked for Phase2 but no live route).
   */
  readonly phase2Requested?: boolean;
  readonly providerKind?: string;
  readonly ttlMs?: number;
  readonly now?: number;
}

/**
 * Lease → Phase1 → optional Phase2. Writes `.last-consolidate.json` beside the store.
 */
export async function runCuratedMemoryConsolidate(
  input: RunCuratedMemoryConsolidateInput,
): Promise<CuratedMemoryConsolidateReport> {
  const now = input.now ?? Date.now();
  const sessionId = input.sessionId.trim() || "unknown";
  const base = {
    sessionId,
    at: now,
    phase1Written: 0,
    phase2: "skipped" as CuratedMemoryPhase2Status,
    phase2Written: 0,
    ...(input.providerKind ? { providerKind: input.providerKind } : {}),
  };

  if (input.userTexts.length === 0) {
    const report: CuratedMemoryConsolidateReport = {
      ...base,
      skipped: "no-user-text",
    };
    writeConsolidateReport(input.store.dir, report);
    return report;
  }

  const claim = tryClaimConsolidateLease(sessionId, {
    dir: input.store.dir,
    ...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
    now,
  });
  if (!claim.ok) {
    const report: CuratedMemoryConsolidateReport = {
      ...base,
      skipped: "busy",
    };
    writeConsolidateReport(input.store.dir, report);
    return report;
  }

  try {
    const phase1 = await consolidateCuratedMemoryPhase1(input.store, {
      userTexts: input.userTexts,
    });
    let phase2: CuratedMemoryPhase2Status = "skipped";
    let phase2Written = 0;
    if (input.phase2Complete) {
      try {
        const phase2Result = await consolidateCuratedMemoryPhase2(input.store, {
          userTexts: input.userTexts,
          ...(input.assistantTexts
            ? { assistantTexts: input.assistantTexts }
            : {}),
          complete: input.phase2Complete,
        });
        phase2Written = phase2Result.written.length;
        phase2 = phase2Written > 0 ? "written" : "skipped";
      } catch {
        phase2 = "failed";
      }
    } else if (input.phase2Requested) {
      phase2 = "no-llm";
    }

    const report: CuratedMemoryConsolidateReport = {
      sessionId,
      at: Date.now(),
      phase1Written: phase1.written.length,
      phase2,
      phase2Written,
      ...(input.providerKind ? { providerKind: input.providerKind } : {}),
    };
    writeConsolidateReport(input.store.dir, report);
    return report;
  } finally {
    claim.release();
  }
}
