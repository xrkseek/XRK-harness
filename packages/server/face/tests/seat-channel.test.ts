import { describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import { sessionCreate } from "../src/handlers/session.js";
import {
  maybePrefixDelegatedChildContent,
  maybePrefixDelegatedChildText,
  withSeatChannelPrefix,
} from "../src/seat-channel.js";

describe("seat-channel", () => {
  it("withSeatChannelPrefix still formats tags for callers that need them", () => {
    expect(withSeatChannelPrefix("老板", "hi")).toBe("[老板] hi");
    expect(withSeatChannelPrefix("老板", "[老板] hi")).toBe("[老板] hi");
    expect(withSeatChannelPrefix("老板", "[经理] hi")).toBe("[经理] hi");
  });

  it("maybePrefixDelegatedChildText is a no-op (owner is source, not body prefix)", async () => {
    const runtime = createBareFaceRuntime();
    const root = path.join(runtime.productDir!, "chan-proj");
    mkdirSync(root, { recursive: true });
    const { workspace } = runtime.workspaces.create(root);
    const parentCreated = await sessionCreate(runtime, "p1", {
      workspaceId: workspace.workspaceId,
    });
    expect(parentCreated.ok).toBe(true);
    if (!parentCreated.ok) return;
    const parentId = String(
      (parentCreated.value as { sessionId: string }).sessionId,
    );
    const childCreated = await sessionCreate(runtime, "c1", {
      workspaceId: workspace.workspaceId,
    });
    expect(childCreated.ok).toBe(true);
    if (!childCreated.ok) return;
    const childId = String(
      (childCreated.value as { sessionId: string }).sessionId,
    );
    runtime.subagents.attach({
      parentSessionId: parentId,
      childSessionId: childId,
      mode: "continuable",
      label: "先锋甲",
    });

    expect(
      maybePrefixDelegatedChildText(runtime, childId, "继续", "human_face"),
    ).toBe("继续");
    expect(
      maybePrefixDelegatedChildText(runtime, childId, "查一下", "parent"),
    ).toBe("查一下");
    expect(
      maybePrefixDelegatedChildText(runtime, parentId, "hello", "human_face"),
    ).toBe("hello");
  });

  it("maybePrefixDelegatedChildContent leaves text blocks unchanged", async () => {
    const runtime = createBareFaceRuntime();
    const root = path.join(runtime.productDir!, "chan-blocks");
    mkdirSync(root, { recursive: true });
    const { workspace } = runtime.workspaces.create(root);
    const parentCreated = await sessionCreate(runtime, "p2", {
      workspaceId: workspace.workspaceId,
    });
    if (!parentCreated.ok) return;
    const parentId = String(
      (parentCreated.value as { sessionId: string }).sessionId,
    );
    const childCreated = await sessionCreate(runtime, "c2", {
      workspaceId: workspace.workspaceId,
    });
    if (!childCreated.ok) return;
    const childId = String(
      (childCreated.value as { sessionId: string }).sessionId,
    );
    runtime.subagents.attach({
      parentSessionId: parentId,
      childSessionId: childId,
      mode: "continuable",
      label: "先锋乙",
    });
    const out = maybePrefixDelegatedChildContent(
      runtime,
      childId,
      [{ type: "text", text: "看图" }],
      "human_face",
    );
    expect(out).toEqual([{ type: "text", text: "看图" }]);
  });
});
