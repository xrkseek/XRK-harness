/**
 * Example `kind: commands` — Face `commands/list` + `commands/execute`.
 * @see docs/plugin-development.md
 */
export function createPlugin() {
  return {
    id: "example-commands",
    kind: "commands",
    commands: [
      {
        name: "example-ping",
        description: "Sample slash command that returns pong",
        async handler() {
          return { kind: "success", text: "pong (example-commands)" };
        },
      },
    ],
  };
}
