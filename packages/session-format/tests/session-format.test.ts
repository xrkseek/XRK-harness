/**
 * `@xrkseek/session-format` — adjacent chain · detect · sqlite schema · catalog.
 */

import { describe, expect, it } from "vitest";
import {
  createAdjacentChain,
  createSqliteSchemaChain,
  detectSessionArtifact,
  migrateSqliteSchema,
  SESSION_FORMAT_SEAMS,
  SESSION_FORMAT_V3_ADOPTED,
  SESSION_INTERCHANGE_VERSION,
  SessionFormatError,
  SessionFormatUnsupportedMigrationError,
  sessionFormatCatalogSummary,
  SQLITE_SCHEMA_CURRENT,
} from "../src/index.js";

describe("createAdjacentChain", () => {
  it("requires exact adjacent edges to current", () => {
    expect(() =>
      createAdjacentChain({
        currentVersion: 2,
        migrations: [
          {
            name: "skip",
            fromVersion: 0,
            toVersion: 2,
            apply: () => undefined,
          },
        ],
      }),
    ).toThrow(SessionFormatError);
  });

  it("plans and applies 0→1→2", () => {
    const log: string[] = [];
    const chain = createAdjacentChain({
      currentVersion: 2,
      migrations: [
        {
          name: "a",
          fromVersion: 0,
          toVersion: 1,
          apply: () => {
            log.push("0-1");
          },
        },
        {
          name: "b",
          fromVersion: 1,
          toVersion: 2,
          apply: () => {
            log.push("1-2");
          },
        },
      ],
    });
    expect(chain.plan(1).map((m) => m.name)).toEqual(["b"]);
    expect(chain.migrate(0, undefined)).toBe(2);
    expect(log).toEqual(["0-1", "1-2"]);
  });

  it("refuses newer stored versions", () => {
    const chain = createAdjacentChain({
      currentVersion: 1,
      migrations: [
        {
          name: "a",
          fromVersion: 0,
          toVersion: 1,
          apply: () => undefined,
        },
      ],
    });
    expect(() => chain.plan(2)).toThrow(SessionFormatUnsupportedMigrationError);
  });
});

describe("detectSessionArtifact", () => {
  it("detects xrk interchange header", () => {
    expect(
      detectSessionArtifact('{"xrkInterchange":1,"kind":"transcript"}\n'),
    ).toEqual({ kind: "xrk-interchange", version: 1 });
  });

  it("refuses foreign Session Format headers (ADR-0009)", () => {
    const header = JSON.stringify({
      version: 3,
      id: "sess_1",
      createdAt: 1,
      isSeeded: false,
      delegationDepth: 0,
    });
    const kind = detectSessionArtifact(`${header}\n`);
    expect(kind.kind).toBe("foreign-session-format");
    if (kind.kind === "foreign-session-format") {
      expect(kind.refused).toBe(true);
      expect(kind.version).toBe(3);
      expect(kind.reason).toMatch(/ADR-0009/);
    }
  });

  it("detects packed chunk rows and XRK events", () => {
    expect(
      detectSessionArtifact(
        '{"type":"text-chunks","turnId":"t","stepId":"s","kind":"text","index":0,"ts0":1,"dts":[],"texts":[]}\n',
      ),
    ).toEqual({ kind: "xrk-packed-hint", packedRow: true });
    expect(
      detectSessionArtifact('{"type":"user/message","ts":1,"turnId":"t","messageId":"m","content":"hi"}\n'),
    ).toEqual({ kind: "xrk-events-jsonl" });
  });
});

describe("sqlite schema chain", () => {
  it("runs adjacent 0→1→2→3 hooks", () => {
    const calls: string[] = [];
    const next = migrateSqliteSchema(0, {
      ensureTables: () => {
        calls.push("tables");
      },
      ensureFts: () => {
        calls.push("fts");
      },
      rebuildFts: () => {
        calls.push("rebuild");
      },
    });
    expect(next).toBe(SQLITE_SCHEMA_CURRENT);
    expect(calls).toEqual(["tables", "tables", "fts", "tables", "fts", "rebuild"]);
    expect(createSqliteSchemaChain().currentVersion).toBe(3);
  });

  it("no-ops when already current", () => {
    const calls: string[] = [];
    migrateSqliteSchema(3, {
      ensureTables: () => {
        calls.push("tables");
      },
      ensureFts: () => {
        calls.push("fts");
      },
      rebuildFts: () => {
        calls.push("rebuild");
      },
    });
    expect(calls).toEqual([]);
  });
});

describe("catalog", () => {
  it("states interop ≠ Format V3", () => {
    expect(SESSION_FORMAT_V3_ADOPTED).toBe(false);
    expect(SESSION_FORMAT_SEAMS.interchange.currentVersion).toBe(
      SESSION_INTERCHANGE_VERSION,
    );
    expect(SESSION_FORMAT_SEAMS.sqliteSchema.currentVersion).toBe(3);
    expect(sessionFormatCatalogSummary()).toContain("session-format-v3:adopted=false");
  });
});
