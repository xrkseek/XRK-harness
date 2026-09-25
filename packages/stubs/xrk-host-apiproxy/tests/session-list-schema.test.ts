import { describe, expect, it, vi } from "vitest";
import {
  sessionListValueSchema,
  sessionOriginSchema,
} from "../src/api/sessions.schema.ts";

function row(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "sess_a",
    updatedAt: 1,
    running: false,
    blank: false,
    ...overrides,
  };
}

describe("session.list wire schema", () => {
  it("accepts origin fork and subagent", () => {
    const parsed = sessionListValueSchema.parse({
      items: [
        row({ sessionId: "sess_fork", origin: "fork" }),
        row({ sessionId: "sess_sub", origin: "subagent" }),
        row({ sessionId: "sess_root" }),
      ],
    });
    expect(parsed.items.map((i) => [i.sessionId, i.origin])).toEqual([
      ["sess_fork", "fork"],
      ["sess_sub", "subagent"],
      ["sess_root", undefined],
    ]);
  });

  it("coerces unknown origin to undefined instead of failing the row", () => {
    expect(sessionOriginSchema.parse("future-kind")).toBeUndefined();
    const parsed = sessionListValueSchema.parse({
      items: [row({ sessionId: "sess_x", origin: "future-kind" })],
    });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.origin).toBeUndefined();
  });

  it("keeps valid rows when one summary fails hard fields", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const parsed = sessionListValueSchema.parse({
        items: [
          row({ sessionId: "sess_ok" }),
          { sessionId: "sess_bad", updatedAt: "nope", running: false, blank: false },
          row({ sessionId: "sess_ok2", origin: "fork" }),
        ],
      });
      expect(parsed.items.map((i) => i.sessionId)).toEqual([
        "sess_ok",
        "sess_ok2",
      ]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
