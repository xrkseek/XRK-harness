/**
 * Example `kind: prompt` — appends a system section via wireCompositionPrompts.
 * @see docs/plugin-development.md
 */
export function createPlugin() {
  return {
    id: "example-prompt",
    kind: "prompt",
    promptSections: [
      {
        id: "example-prompt-sample",
        order: 900,
        content:
          "Example prompt plugin is loaded. Prefer real product guidance over this sample.",
      },
    ],
  };
}
