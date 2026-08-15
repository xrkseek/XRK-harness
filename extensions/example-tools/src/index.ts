/** TypeScript mirror of plugin.mjs — see xrk.plugin.json / docs/plugin-loader.md. */
export function createPlugin() {
  return {
    id: "example-tools",
    kind: "tools",
    tools: [
      {
        name: "example_ping",
        description: "Returns pong (sample plugin tool)",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        async execute() {
          return { content: "pong" };
        },
      },
    ],
  };
}
