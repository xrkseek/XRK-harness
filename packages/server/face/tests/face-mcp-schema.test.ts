import { describe, expect, it } from "vitest";
import Schema from "@xrkseek/schemastery";
import { FACE_MCP_SCHEMA } from "../src/face-schema.js";

describe("FACE_MCP_SCHEMA", () => {
  const schema = new Schema(FACE_MCP_SCHEMA as never);

  it("accepts connected overlay with numeric toolCount", () => {
    expect(() =>
      schema({
        servers: [
          {
            serverName: "playwright",
            command: "npx",
            args: ["@playwright/mcp@latest"],
          },
        ],
        allowConnect: true,
        connected: [
          {
            id: "mcp:playwright",
            serverName: "playwright",
            kind: "tools",
            toolCount: 12,
            status: "connected",
          },
        ],
        parked: [],
        note: "Save remounts MCP",
      }),
    ).not.toThrow();
  });

  it("rejects string toolCount (client would hide the MCP card)", () => {
    expect(() =>
      schema({
        servers: [],
        allowConnect: false,
        connected: [
          {
            id: "mcp:x",
            serverName: "x",
            kind: "tools",
            toolCount: "0",
            status: "connected",
          },
        ],
        parked: [],
        note: "",
      }),
    ).toThrow(/toolCount/);
  });
});
