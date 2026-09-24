/** Sidebar agent-push prefs codec (settings.get / settings.update envelopes). */
import { describe, expect, it } from "vitest";
import { parseSidebarAgentPushPrefs } from "../src/client/sidebar-prefs-api.ts";

describe("parseSidebarAgentPushPrefs", () => {
  it("reads agentOpenTools / agentTerminalTools from settings.get shape", () => {
    expect(
      parseSidebarAgentPushPrefs({
        ok: true,
        value: {
          value: { agentOpenTools: true, agentTerminalTools: false },
          revision: 1,
        },
      }),
    ).toEqual({ agentOpenTools: true, agentTerminalTools: false });
  });

  it("returns null on bad envelopes", () => {
    expect(parseSidebarAgentPushPrefs(null)).toBeNull();
    expect(parseSidebarAgentPushPrefs({ ok: false })).toBeNull();
    expect(parseSidebarAgentPushPrefs({ ok: true, value: {} })).toBeNull();
  });
});
