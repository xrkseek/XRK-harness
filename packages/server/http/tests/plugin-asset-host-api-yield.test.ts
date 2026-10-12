import { describe, expect, it } from "vitest";
import { looksCordisHostApiTail } from "../src/dsh-compat/generic-plugin-http.js";

describe("looksCordisHostApiTail", () => {
  it("yields WorkBuddy host API tails so apply routes can match", () => {
    expect(looksCordisHostApiTail("status")).toBe(true);
    expect(looksCordisHostApiTail("probe")).toBe(true);
    expect(looksCordisHostApiTail("update")).toBe(true);
    expect(looksCordisHostApiTail("ai/status")).toBe(true);
    expect(looksCordisHostApiTail("ai/probe")).toBe(true);
  });

  it("does not yield ordinary asset or agent-teams tails", () => {
    expect(looksCordisHostApiTail("client.js")).toBe(false);
    expect(looksCordisHostApiTail("chunks/panel.js")).toBe(false);
    expect(looksCordisHostApiTail("state")).toBe(false);
    expect(looksCordisHostApiTail("")).toBe(false);
  });
});
