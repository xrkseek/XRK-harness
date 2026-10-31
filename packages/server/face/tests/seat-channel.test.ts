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
import { MANAGER_MEMBER_ID } from "../src/agent-roster-store.js";

describe("seat-channel", () => {
  it("withSeatChannelPrefix skips existing [tag]", () => {
    expect(withSeatChannelPrefix("老板", "hi")).toBe("[老板] hi");
    expect(withSeatChannelPrefix("老板", "[老板] hi")).toBe("[老板] hi");
    expect(withSeatChannelPrefix("老板", "[经理] hi")).toBe("[经理] hi");
  });

  it("custom titles: UI→boss formal, parent tool→manager formal", async () => {
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
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
    Object.assign(runtime.settingsNamespaces.ensure("ui-presence").user, {
      titleScheme: "office",
      titleBoss: "主公",
      titleManager: "军师",
      titleAgent: "先锋",
      bossNickname: "阿凯",
    });
    runtime.agentRoster.patchCatalogMeta(MANAGER_MEMBER_ID, {
      nickname: "孔明",
    });
    runtime.subagents.attach({
      parentSessionId: parentId,
      childSessionId: childId,
      mode: "continuable",
      label: "先锋甲",
    });

    expect(
      maybePrefixDelegatedChildText(runtime, childId, "继续", "human_face"),
    ).toBe("[主公（阿凯）] 继续");
    expect(
      maybePrefixDelegatedChildText(runtime, childId, "查一下", "parent"),
    ).toBe("[军师（孔明）] 查一下");
    // Non-child: unchanged
    expect(
      maybePrefixDelegatedChildText(runtime, parentId, "hello", "human_face"),
    ).toBe("hello");
  });

  it("prefixes first text block in MessageContent", async () => {
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
    Object.assign(runtime.settingsNamespaces.ensure("ui-presence").user, {
      titleScheme: "office",
      titleBoss: "主公",
      titleManager: "军师",
      titleAgent: "先锋",
    });
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
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
    expect(out).toEqual([{ type: "text", text: "[主公] 看图" }]);
  });
});
