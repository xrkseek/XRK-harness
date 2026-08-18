import type { ToolDefinition } from "./definition.js";

export interface StdToolsOptions {
  /** Interactive ask; if unset, ask_user returns isError. */
  askUser?: (question: string) => Promise<string>;
}

/** Standard session tools: todo_write + ask_user. */
export function createStdTools(
  options: StdToolsOptions = {},
): ToolDefinition[] {
  const todos: { id: string; content: string; status: string }[] = [];
  return [
    {
      name: "todo_write",
      description: "Update the in-session todo list.",
      parameters: {
        type: "object",
        properties: {
          merge: { type: "boolean" },
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                content: { type: "string" },
                status: { type: "string" },
              },
            },
          },
        },
        required: ["todos"],
      },
      async execute(args) {
        const a = args as {
          merge?: boolean;
          todos?: { id: string; content: string; status: string }[];
        };
        const next = a.todos ?? [];
        if (!a.merge) {
          todos.length = 0;
        }
        for (const t of next) {
          const i = todos.findIndex((x) => x.id === t.id);
          if (i >= 0) todos[i] = t;
          else todos.push(t);
        }
        return { content: JSON.stringify(todos, null, 2) };
      },
      presentCall: (args) => ({
        card: "generic",
        title: "Update todo list",
        kind: "other",
        rawInput: (args as { todos?: unknown }).todos,
      }),
    },
    {
      name: "ask_user",
      description: "Ask the user a clarifying question.",
      parameters: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
      },
      presentCall: (args) => ({
        card: "generic",
        title: String((args as { question?: string }).question ?? "Ask user"),
        kind: "other",
        rawInput: args,
      }),
      async execute(args) {
        const q = String((args as { question?: string }).question ?? "");
        if (!options.askUser) {
          return {
            content: `ask_user unavailable (no UI): ${q}`,
            isError: true,
          };
        }
        const answer = await options.askUser(q);
        return { content: answer };
      },
    },
  ];
}
