import { describe, expect, it } from "vitest";
import {
  classifyApproval,
  extractNetworkContext,
} from "../src/approval-category.js";

describe("classifyApproval", () => {
  it("tags web_fetch / browser as network with host", () => {
    const c = classifyApproval({
      toolName: "web_fetch",
      args: { url: "https://example.com/a" },
    });
    expect(c.category).toBe("network");
    expect(c.network).toEqual({ host: "example.com", protocol: "https" });
  });

  it("tags sandbox_permissions as escalation", () => {
    const c = classifyApproval({
      toolName: "bash",
      args: {
        command: "ls",
        sandbox_permissions: "danger-full-access",
        justification: "need docker",
      },
    });
    expect(c.category).toBe("escalation");
  });

  it("defaults ordinary tools to tool", () => {
    expect(
      classifyApproval({ toolName: "read_file", args: { path: "a.ts" } })
        .category,
    ).toBe("tool");
  });

  it("extractNetworkContext parses bare hosts", () => {
    expect(extractNetworkContext({ host: "api.github.com" })).toEqual({
      host: "api.github.com",
      protocol: "https",
    });
  });
});
