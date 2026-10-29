// Fixture for the harness composition: a plugin-supplied tool, end to end.
//
// 1. `$.tool.register` puts a definition in the product registry. Its `execute`
//    is a placeholder that always rejects — the bridge's contract is that a
//    `tool.call` hook answers instead.
// 2. `$.tool.call` invokes it by full name (the registry stores
//    `<plugin>:<tool>`), which runs the pipeline, which raises `tool.call`,
//    which the hook below answers.
//
// Both halves are observed through `prompt.submit`, so one turn proves the loop.

export function register(on) {
  on("session.start", {}, async ($, e, next) => {
    await $.tool.register({
      name: "mod_greet",
      description: "Greet someone from a plugin",
      inputSchema: { type: "object", properties: { who: { type: "string" } } },
    });
    // A slash command: registered here, answered by the `command.run` hook
    // below, and reachable through `$.command.run` / `$.command.list`.
    await $.command.register({
      name: "native-hello",
      description: "Say hello from a plugin",
      argumentHint: "who",
    });
    const catalog = await $.tool.list();
    const commands = await $.command.list();
    $.ui.log(
      "registered mod_greet; catalog size " +
        catalog.length +
        "; commands " +
        commands.map((command) => command.name).join("/"),
    );
    return next(e);
  });

  // The answering half: a registered command's output comes from here.
  on("command.run", { command: "native-hello" }, async ($, e) => {
    return { text: "hello from " + String(e.args || "nobody") };
  });

  // The answering half: a mod-supplied tool's result comes from here.
  on("tool.call", { tool: "mcp__native-tool__mod_greet" }, async ($, e) => {
    return { result: "greeted " + String(e.who ?? "nobody") };
  });

  // The calling half: run the tool and let the answer reach the model.
  on("prompt.submit", {}, async ($, e, next) => {
    const out = await next(e);
    const answer = await $.tool.call({
      tool: "mcp__native-tool__mod_greet",
      who: "ada",
    });
    // The session surface: what the model has seen so far, as the host folds it.
    const history = await $.session.messages();
    const command = await $.command.run({ command: "native-hello", args: "ada" });
    // Usage is the session's own meter: tokens once a turn has been sampled,
    // and the window the last request actually ran against.
    const usage = await $.session.usage();
    $.ui.log(
      "history=" +
        history
          .map((message) => message.role + ":" + String(message.text).slice(0, 32))
          .join(",") +
        "; usage=" +
        JSON.stringify(usage.context),
    );
    return {
      ...out,
      text: out.text + " | " + String(answer.result) + " | " + String(command.text),
    };
  });
}
