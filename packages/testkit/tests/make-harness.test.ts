import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { makeHarness } from "../src/index.js";

describe("makeHarness", () => {
  it("runs minimal preset with replay", async () => {
    const h = makeHarness({
      preset: "minimal",
      llm: createReplayAdapter([{ content: "pong" }]),
    });
    const out = await h.run("ping");
    expect(out.text).toBe("pong");
  });

  it("harness preset registers std tools", async () => {
    const h = makeHarness({ preset: "harness" });
    const names = h.composition.tools.list().map((t) => t.name);
    expect(names).toContain("todo_write");
    expect(names).toContain("ask_user");
    expect(names).toContain("web_search");
    expect(names).toContain("web_fetch");
    expect(names).toContain("skill");
    expect(names).toContain("lsp");
    expect(names).toContain("terminal_open");
    expect(names).toContain("job_output");
    expect(names).toContain("job_kill");
    expect(names).toContain("job_list");
    expect(names).not.toContain("run_code");
  });

  it("presentation code adds run_code", async () => {
    const h = makeHarness({ preset: "harness", presentation: "code" });
    expect(h.composition.tools.list().map((t) => t.name)).toContain("run_code");
  });

  it("minimal injects .xrk as durable user messages (not system)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-inj-"));
    await mkdir(path.join(root, ".xrk"), { recursive: true });
    await writeFile(
      path.join(root, ".xrk", "assistant.md"),
      "INJECT-MARKER",
      "utf8",
    );

    let systemText = "";
    let userTexts: string[] = [];
    const llm = {
      id: "cap",
      async chat(req: { messages: readonly { role: string; content: string }[] }) {
        const sys = req.messages.find((m) => m.role === "system");
        systemText = sys?.content ?? "";
        userTexts = req.messages
          .filter((m) => m.role === "user")
          .map((m) => String(m.content));
        return { content: "ok" };
      },
    };

    const composition = createMinimalComposition({
      workspaceRoot: root,
      llm,
      assemble: true,
    });
    expect(composition.workspace).toBeTruthy();
    const agent = await composition.createAgent();
    await agent.continueTurn({ text: "hi" });
    expect(systemText).not.toContain("INJECT-MARKER");
    expect(userTexts.some((t) => t.includes("## Assistant"))).toBe(true);
    expect(userTexts.some((t) => t.includes("INJECT-MARKER"))).toBe(true);

    const events = composition.store.get(composition.sessionId).events;
    expect(
      events.some(
        (e) =>
          e.type === "user/message" &&
          e.source?.kind === "agent-instructions",
      ),
    ).toBe(true);
  });

  it("workspaceInject false skips blocks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-inj-"));
    await mkdir(path.join(root, ".xrk"), { recursive: true });
    await writeFile(
      path.join(root, ".xrk", "assistant.md"),
      "SHOULD-NOT",
      "utf8",
    );

    let systemText = "";
    const llm = {
      id: "cap2",
      async chat(req: { messages: readonly { role: string; content: string }[] }) {
        systemText =
          req.messages.find((m) => m.role === "system")?.content ?? "";
        return { content: "ok" };
      },
    };

    const composition = createMinimalComposition({
      workspaceRoot: root,
      llm,
      workspaceInject: false,
    });
    const agent = await composition.createAgent();
    await agent.continueTurn({ text: "hi" });
    expect(systemText).not.toContain("SHOULD-NOT");
  });

  it("slash recipe expands user + recipe system block", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-slash-"));
    const recipesDir = path.join(root, ".xrk", "recipes");
    await mkdir(recipesDir, { recursive: true });
    await writeFile(
      path.join(recipesDir, "daily-standup.yaml"),
      `id: daily-standup
title: 日报整理
prompt: |
  EXPANDED-USER {{notes}}
instructions: |
  RECIPE-SYS
parameters:
  - name: notes
    required: true
`,
      "utf8",
    );

    let systemText = "";
    let userText = "";
    const llm = {
      id: "slash-cap",
      async chat(req: {
        messages: readonly { role: string; content: string }[];
      }) {
        systemText =
          req.messages.find((m) => m.role === "system")?.content ?? "";
        userText =
          req.messages.find((m) => m.role === "user")?.content ?? "";
        return { content: "ok" };
      },
    };

    const composition = createMinimalComposition({
      workspaceRoot: root,
      llm,
      workspaceInject: false,
    });
    const agent = await composition.createAgent();
    await agent.continueTurn({ text: "/daily-standup shipped M2" });
    expect(userText).toContain("EXPANDED-USER");
    expect(userText).toContain("shipped M2");
    expect(systemText).toContain("## Recipe");
    expect(systemText).toContain("RECIPE-SYS");

    const events = composition.store.get(composition.sessionId).events;
    const userMsg = events.find((e) => e.type === "user/message");
    expect(userMsg && "content" in userMsg ? userMsg.content : "").toContain(
      "EXPANDED-USER",
    );
  });

  it("slash skill expands into logged user message", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-skill-slash-"));
    const dir = path.join(root, ".xrk", "skills", "office-ping");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SKILL.md"),
      `---
name: office-ping
description: Ping
---
Do the ping.
`,
      "utf8",
    );

    let userText = "";
    let systemText = "";
    const llm = {
      id: "skill-slash-cap",
      async chat(req: {
        messages: readonly { role: string; content: string }[];
      }) {
        systemText =
          req.messages.find((m) => m.role === "system")?.content ?? "";
        userText =
          req.messages.find((m) => m.role === "user")?.content ?? "";
        return { content: "ok" };
      },
    };

    const composition = createMinimalComposition({
      workspaceRoot: root,
      llm,
      workspaceInject: false,
      slashRecipes: false,
    });
    const agent = await composition.createAgent();
    await agent.continueTurn({ text: "/office-ping do this" });
    expect(userText).toContain("<skill_content name=\"office-ping\">");
    expect(userText).toContain("Do the ping.");
    expect(userText).toContain("do this");
    expect(systemText).not.toContain("## Recipe");

    const events = composition.store.get(composition.sessionId).events;
    const userMsg = events.find((e) => e.type === "user/message");
    expect(userMsg && "content" in userMsg ? userMsg.content : "").toContain(
      "<skill_content name=\"office-ping\">",
    );
  });
});
