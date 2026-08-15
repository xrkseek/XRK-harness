/**
 * Golden fixtures inspired by AGT chat-pipeline shapes (desensitized).
 * Assertions are contract-level — not byte-identical to AGT.
 */
export const fixtures = [
  {
    id: "agt-plain-turn",
    input: {
      persona: "You are a coding assistant.",
      history: [] as { role: "user" | "assistant"; content: string }[],
      user: "List files in src/",
      sessionId: "sess_plain",
      nowIso: "2026-08-15T04:00:00.000Z",
    },
    expect: {
      systemIncludes: ["coding assistant"],
      systemExcludes: ["sess_plain", "volatile"],
      messageRoles: ["user", "user"],
    },
  },
  {
    id: "agt-with-history",
    input: {
      persona: "You are a coding assistant.",
      history: [
        { role: "user" as const, content: "hi" },
        { role: "assistant" as const, content: "hello" },
      ],
      user: "continue",
      sessionId: "sess_hist",
      nowIso: "2026-08-15T04:00:00.000Z",
    },
    expect: {
      systemIncludes: ["coding assistant"],
      systemExcludes: ["sess_hist"],
      messageRoles: ["user", "assistant", "user", "user", "user"],
      hasCurrentMarker: true,
    },
  },
  {
    id: "agt-with-tools",
    input: {
      persona: "You are a coding assistant.",
      history: [],
      user: "read package.json",
      sessionId: "sess_tools",
      nowIso: "2026-08-15T04:00:00.000Z",
      tools: [
        {
          name: "read_file",
          description: "Read file",
          parameters: { type: "object" },
        },
      ],
    },
    expect: {
      systemIncludes: ["coding assistant"],
      systemExcludes: ["sess_tools"],
      toolNames: ["read_file"],
      messageRoles: ["user", "user"],
    },
  },
] as const;
