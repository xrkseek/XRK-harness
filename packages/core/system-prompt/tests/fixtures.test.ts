import { describe, expect, it } from "vitest";
import { assembleThreeLayers } from "../src/index.js";
import { fixtures } from "./fixtures/agt-golden.js";

describe("AGT golden fixtures (contract)", () => {
  for (const fix of fixtures) {
    it(fix.id, () => {
      const req = assembleThreeLayers({
        skeletonSystem: { persona: fix.input.persona },
        history: fix.input.history,
        skeletonUser: { text: fix.input.user },
        volatile: {
          nowIso: fix.input.nowIso,
          sessionId: fix.input.sessionId,
        },
        ...("tools" in fix.input && fix.input.tools
          ? { tools: [...fix.input.tools] }
          : {}),
      });
      for (const s of fix.expect.systemIncludes) {
        expect(req.system).toContain(s);
      }
      for (const s of fix.expect.systemExcludes) {
        expect(req.system).not.toContain(s);
      }
      expect(req.messages.map((m) => m.role)).toEqual([
        ...fix.expect.messageRoles,
      ]);
      if ("hasCurrentMarker" in fix.expect && fix.expect.hasCurrentMarker) {
        expect(req.messages.some((m) => m.content === "[current message]")).toBe(
          true,
        );
      }
      if ("toolNames" in fix.expect && fix.expect.toolNames) {
        expect(req.tools.map((t) => t.name)).toEqual([...fix.expect.toolNames]);
      }
    });
  }
});
