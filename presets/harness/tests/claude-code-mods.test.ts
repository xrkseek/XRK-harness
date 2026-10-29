// End-to-end: a real harness composition, a real plugin directory, and one
// turn. Everything below the composition boundary is production code, so this
// is the test that would catch the wiring silently detaching.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createMemorySessionStore } from "@xrkseek/core-session";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHarnessComposition } from "../preset.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

const bash = {
  name: "bash",
  description: "Run a shell command",
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  execute: async (args: { command: string }) => ({
    content: `ran: ${args.command}`,
  }),
};

async function compositionWith(
  pluginsRoot: string,
  llm = createReplayAdapter([{ content: "ok" }]),
  extra: {
    readonly userQuestions?: import("@xrkseek/claude-code-mods").UserQuestionsService;
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "xrk-mods-"));
  const store = createMemorySessionStore();
  const session = store.create();
  const composition = createHarnessComposition({
    workspaceRoot: root,
    sessionStore: store,
    sessionId: session.id,
    llm,
    claudeCodePluginsRoot: pluginsRoot,
    assemble: false,
    workspaceInject: false,
    slashRecipes: false,
    webTools: false,
    lspTools: false,
    ...(extra.userQuestions === undefined
      ? {}
      : { userQuestions: extra.userQuestions }),
  });
  return { composition, store, session };
}

const disposers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (disposers.length > 0) await disposers.pop()?.();
});

describe("harness ⇄ Claude Code plugins", () => {
  it("does nothing when no plugins are installed", async () => {
    const { composition } = await compositionWith(
      path.join(FIXTURES, "does-not-exist"),
    );
    disposers.push(() => composition.dispose());
    const handle = await composition.createAgent();
    // The wrapper is transparent: the turn still runs and answers.
    const result = await handle.continueTurn({ text: "hi" });
    expect(result.text).toBe("ok");
  });

  it("lets a plugin rewrite the prompt and sees turn boundaries", async () => {
    const lines: string[] = [];
    const info = vi.spyOn(console, "info").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const warnings: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
      warnings.push(String(line));
    });
    try {
      const { composition, store, session } = await compositionWith(
        path.join(FIXTURES, "guard-plugin"),
      );
      disposers.push(() => composition.dispose());
      const handle = await composition.createAgent();
      await handle.continueTurn({ text: "hi" });

      // The in-memory echo of `prompt.submit`: what the model was actually asked.
      const asked = store
        .get(session.id)
        .events.filter((event) => event.type === "user/message")
        .map((event) => JSON.stringify(event.content))
        .join("\n");
      expect(asked).toContain("[mod]");
      expect(lines.some((line) => line.includes("turn-complete:answer"))).toBe(true);
      // An observing hook (`await next(e)`, then a side effect, no return) must
      // not be reported as a skipped hook.
      expect(warnings.filter((line) => line.includes("skipped"))).toEqual([]);
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });

  it("refuses a risky tool call before the tool body runs", async () => {
    const { composition } = await compositionWith(path.join(FIXTURES, "guard-plugin"));
    disposers.push(() => composition.dispose());
    await composition.createAgent();

    const refused = await composition.pipeline.run(
      bash as never,
      { id: "call-1", name: "bash", arguments: { command: "rm -rf /tmp/x" } },
      undefined,
      {},
    );
    expect(JSON.stringify(refused)).toContain("harness guard refused");
    expect(JSON.stringify(refused)).not.toContain("ran: rm -rf");

    const allowed = await composition.pipeline.run(
      bash as never,
      { id: "call-2", name: "bash", arguments: { command: "ls" } },
      undefined,
      {},
    );
    expect(JSON.stringify(allowed)).toContain("ran: ls");
  });

  it("raises session.end before unloading", async () => {
    const lines: string[] = [];
    const info = vi.spyOn(console, "info").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      const { composition } = await compositionWith(
        path.join(FIXTURES, "guard-plugin"),
      );
      await composition.createAgent();
      await composition.dispose();
      expect(lines.some((line) => line.includes("session-end"))).toBe(true);
    } finally {
      info.mockRestore();
    }
  });

  // The full loop for a plugin-supplied tool: `$.tool.register` puts it in the
  // product registry, a `tool.call` hook answers for it (its registered body
  // rejects by contract), and `$.tool.call` invokes it through the pipeline.
  it("registers a plugin tool, answers for it, and calls it back", async () => {
    const { composition, store, session } = await compositionWith(
      path.join(FIXTURES, "native-tool-plugin"),
    );
    disposers.push(() => composition.dispose());
    const handle = await composition.createAgent();

    // `session.start` registered it under `<plugin>:<tool>`.
    expect(composition.tools.get("mcp__native-tool__mod_greet")).toBeDefined();
    // Face reads this off the handle to fill the `/` panel, so it has to be the
    // same table `$.command.register` wrote to.
    expect(handle.pluginCommands?.list()).toEqual([
      {
        name: "native-hello",
        description: "Say hello from a plugin",
        // `argumentHint` survives registration: the panel can show what goes
        // after the name without asking the plugin again.
        input: { hint: "who" },
      },
    ]);
    await expect(
      handle.pluginCommands?.execute("/native-hello ada"),
      // The bridge prefixes a command's output with the plugin's name (same as
      // the DSH port), so a reader can tell plugin output from Face's own.
    ).resolves.toMatchObject({
      result: { kind: "success", text: "native-tool: hello from ada" },
    });

    await handle.continueTurn({ text: "hi" });
    const asked = store
      .get(session.id)
      .events.filter((event) => event.type === "user/message")
      .map((event) => JSON.stringify(event.content))
      .join("\\n");
    // The answer came from the hook, not from the placeholder body — a body run
    // would have surfaced its rejection instead of "greeted ada".
    expect(asked).toContain("greeted ada");
    // Same loop for a registered slash command: `$.command.run` resolved it and
    // the `command.run` hook answered.
    expect(asked).toContain("hello from ada");

    // Every `$.command.run` leaves exactly one lifecycle pair in the session
    // log — the same trail a typed `/name` leaves through Face, never two.
    const events = store.get(session.id).events;
    const runs = events.filter((event) => event.type === "command/run");
    const dones = events.filter((event) => event.type === "command/done");
    expect(runs.length).toBe(2);
    expect(dones.length).toBe(runs.length);
  });

  // Product runtime raises ui.render into the AbovePrompt band; Face watches
  // pluginBand and presses forward to onPress. Without a client, the handle
  // source is enough to prove the seam.
  it("draws the AbovePrompt band and presses a button through pluginBand", async () => {
    const { composition } = await compositionWith(
      path.join(FIXTURES, "band-plugin"),
    );
    disposers.push(() => composition.dispose());
    const handle = await composition.createAgent();
    expect(handle.pluginBand).toBeDefined();
    const first = await handle.pluginBand!.current();
    expect(first.generation).toBeGreaterThan(0);
    expect(JSON.stringify(first.tree)).toContain("count 0");
    // Buttons sit under Box children — walk the serialized tree.
    const walk = (
      nodes: readonly import("@xrkseek/core-agent").PluginBandNode[] | null | undefined,
    ): string | undefined => {
      if (nodes === null || nodes === undefined) return undefined;
      for (const node of nodes) {
        if (typeof node === "string") continue;
        if (node.type === "Button" && node.actionId !== undefined)
          return node.actionId;
        const nested = walk(node.children);
        if (nested !== undefined) return nested;
      }
      return undefined;
    };
    const actionId = walk(first.tree);
    expect(actionId).toBeTruthy();
    const next = await handle.pluginBand!.press(first.generation, actionId!);
    expect(JSON.stringify(next.tree)).toContain("count 1");
  });

  // Face already has a question broker + shell UI; the missing piece was
  // wiring it into mods as `userQuestions`. With a mock answerer, `$.ui.ask`
  // resolves and `session.start` reports interactive.
  it("resolves $.ui.ask through the composed userQuestions service", async () => {
    const lines: string[] = [];
    const info = vi.spyOn(console, "info").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { composition } = await compositionWith(
        path.join(FIXTURES, "ask-plugin"),
        createReplayAdapter([{ content: "ok" }]),
        {
          userQuestions: {
            ask: async ({ questions }) => ({
              answers: [
                {
                  id: questions[0]!.id,
                  selected: ["yes"],
                },
              ],
            }),
          },
        },
      );
      disposers.push(() => composition.dispose());
      await composition.createAgent();
      expect(lines.some((line) => line.includes("ask-answer=yes"))).toBe(true);
      expect(lines.some((line) => line.includes("interactive=true"))).toBe(true);
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });

  // `$.session.messages()` must be the model's own transcript, not a second
  // reading of the log: a plugin deciding on the second turn needs to see what
  // the first turn actually said.
  it("gives a plugin the derived transcript on the next turn", async () => {
    const lines: string[] = [];
    const info = vi.spyOn(console, "info").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      const { composition, store, session } = await compositionWith(
        path.join(FIXTURES, "native-tool-plugin"),
        createReplayAdapter([
          { content: "first answer" },
          { content: "second answer" },
        ]),
      );
      disposers.push(() => composition.dispose());
      const handle = await composition.createAgent();

      await handle.continueTurn({ text: "one" });
      // The window comes off `request/header`. The replay adapter writes no
      // header (it never calls a model), so inject one the way the agent loop
      // does — that makes this assertion about our wiring, not about the fixture.
      store.append(session.id, {
        type: "request/header",
        ts: Date.now(),
        turnId: "turn-1",
        reason: "initial",
        header: {
          config: {
            provider: "deepseek",
            model: "deepseek-chat",
            contextWindow: 131072,
          },
        },
      });
      await handle.continueTurn({ text: "two" });

      const history = lines.filter((line) => line.includes("history="));
      // Turn one sees nothing; turn two sees the user row and the answer.
      expect(history[0]).toContain("history=");
      expect(history[1]).toContain("assistant:first answer");
      // Usage follows the same rule: nothing sampled on the first turn's
      // `prompt.submit` (it runs before the turn), both halves on the second.
      expect(history[0]).toContain('"window":0');
      // …and on the second turn it is the number the model actually ran
      // against, not a hardcoded zero.
      expect(history[1]).toContain('"window":131072');
    } finally {
      info.mockRestore();
    }
  });
});
