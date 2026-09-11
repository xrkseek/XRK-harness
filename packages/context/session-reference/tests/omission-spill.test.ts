/**
 * Truncated @session previews spill the full projection for on-demand read_file.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { prepareFaceSessionReferences } from "../src/prepare-face.js";
import { SessionId } from "../src/types.js";
import { formatSessionReferenceMention } from "../src/uri.js";
import type { SessionEvent } from "@xrkseek/protocol";

const spillDirs: string[] = [];

afterEach(() => {
  for (const dir of spillDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("prepareFaceSessionReferences omission spill", () => {
  it("spills full projection and announces ## Reference omissions when truncated", () => {
    const sourceId = "ref-src-omit";
    const targetId = "ref-tgt-omit";
    const early = `EARLY_FACT\n${"detail 界.\n".repeat(40)}${"x".repeat(2000)}MIDDLE${"y".repeat(2000)}`;
    const late = "LATEST_FACT\nanswer forty-two";
    const events: SessionEvent[] = [
      { type: "turn/start", ts: 1, turnId: "t0" },
      {
        type: "user/message",
        ts: 2,
        turnId: "t0",
        content: early,
        source: { kind: "user" },
      },
      {
        type: "assistant/message",
        ts: 3,
        turnId: "t0",
        stepId: "s0",
        content: late,
      },
    ];
    const mention = formatSessionReferenceMention({
      sessionId: SessionId(sourceId),
      label: "Research",
    });
    const prepared = prepareFaceSessionReferences({
      targetSessionId: targetId,
      content: `use ${mention}`,
      text: `use ${mention}`,
      readEvents: (id) => (id === sourceId ? events : []),
      maxReferenceBytes: 360,
    });
    expect(prepared.contexts).toHaveLength(1);
    const text = String(prepared.contexts[0]?.content);
    expect(text).toContain("## Referenced sessions");
    expect(text).toContain("## Reference omissions");
    expect(text).toContain("LATEST_FACT");
    expect(text).not.toContain("EARLY_FACT");
    const jsonStart = text.lastIndexOf("\n[");
    expect(jsonStart).toBeGreaterThan(0);
    const notices = JSON.parse(text.slice(jsonStart + 1)) as Array<{
      sessionId: string;
      omittedMessages: number;
      omittedBytes: number;
      fullSnapshot: { status: string; locator: string; bytes: number };
    }>;
    expect(notices).toHaveLength(1);
    const notice = notices[0]!;
    expect(notice.sessionId).toBe(sourceId);
    expect(notice.omittedMessages).toBeGreaterThan(0);
    expect(notice.fullSnapshot.status).toBe("saved");
    spillDirs.push(
      notice.fullSnapshot.locator.replace(/[\\/][^\\/]+$/, ""),
    );
    const transcript = readFileSync(notice.fullSnapshot.locator, "utf8");
    expect(transcript).toContain("EARLY_FACT");
    expect(transcript).toContain("LATEST_FACT");
    expect(transcript).toContain("untrusted, read-only snapshot");
    expect(Buffer.byteLength(transcript, "utf8")).toBe(notice.fullSnapshot.bytes);
  });
});
