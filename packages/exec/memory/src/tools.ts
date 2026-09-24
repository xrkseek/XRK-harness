import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import type {
  CuratedMemoryOperation,
  CuratedMemoryStore,
  CuratedMemoryTarget,
} from "./store.js";

/**
 * Always frozen into the system prompt when curated memory is on (Codex-style):
 * durable facts only — never a cross-session task queue. Standing work stays in
 * session-scoped `todo_write` / `todo/write`.
 */
export const CURATED_MEMORY_PROMPT_TEXT =
  "Curated memory is two files under {XRK_HOME}/memories, frozen into this system "
  + "prompt at session start: MEMORY.md (durable agent notes) and USER.md (who the "
  + "user is — this is `{XRK_HOME}/memories/USER.md`, not standing `~/.xrk/USER.md` / "
  + "`IDENTITY.md` / `SOUL.md`). Use them only for facts that should still be true in "
  + "every future session (stable preferences, lasting project conventions, who the "
  + "user is). They are NOT a standing plan, todo list, progress log, or 'continue the "
  + "previous session' queue — unfinished work belongs in `todo_write` (session-scoped) "
  + "and does not follow the user into a new session. Do not write session-local WIP, "
  + "numbered task checklists, or 'we were doing X' handoff notes into memory. Do "
  + "not volunteer to resume work that appears only in MEMORY unless the user asks. "
  + "The `memory` tool only add / replace / remove (or one atomic `operations` batch). "
  + "Writes hit disk immediately and do not change this session's system prompt. "
  + "This is not the Mnemon document library.";

const ACTIONS = ["add", "replace", "remove"] as const;

function asTarget(raw: unknown): CuratedMemoryTarget | undefined {
  const target = String(raw ?? "memory");
  if (target === "memory" || target === "user") return target;
  return undefined;
}

function asOps(raw: unknown): CuratedMemoryOperation[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const op = item && typeof item === "object" ? (item as CuratedMemoryOperation) : {};
    return op;
  });
}

/**
 * Model-facing `memory` tool. Disk writes do not refresh {@link CuratedMemoryStore.frozenSystemBlock}.
 */
export function createCuratedMemoryTools(store: CuratedMemoryStore): ToolDefinition[] {
  const tool: ToolDefinition<{
    action?: string;
    target?: string;
    content?: string;
    old_text?: string;
    new_text?: string;
    operations?: CuratedMemoryOperation[];
  }> = {
    name: "memory",
    description:
      "Save durable facts that should appear in every future session "
      + "(preferences, lasting conventions, who the user is). "
      + "Do NOT store session WIP, standing plans, todo checklists, or handoff notes "
      + "for unfinished work — use `todo_write` for those (they stay in this session only). "
      + "Actions: add, replace, remove. Prefer one `operations` batch when several entries change. "
      + "target `memory` is agent notes (MEMORY.md under {XRK_HOME}/memories); "
      + "target `user` is the curated user profile (memories/USER.md — not standing "
      + "~/.xrk/USER.md or IDENTITY.md). "
      + "replace and remove need `old_text` (a unique substring). "
      + "Writes are saved to disk but do not change the system prompt of the current session. "
      + "Not Mnemon documents, and not a search tool.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...ACTIONS],
          description: "Single change. Omit when using operations.",
        },
        target: {
          type: "string",
          enum: ["memory", "user"],
          description: "memory = MEMORY.md notes; user = USER.md profile.",
        },
        content: {
          type: "string",
          description: "Entry text for add and replace. `new_text` is an alias.",
        },
        old_text: {
          type: "string",
          description: "Unique substring of the entry to replace or remove.",
        },
        new_text: {
          type: "string",
          description: "Alias for content.",
        },
        operations: {
          type: "array",
          description:
            "Atomic batch of {action, content?, old_text?}. The character budget is checked on the final result only.",
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: [...ACTIONS] },
              content: { type: "string" },
              new_text: { type: "string" },
              old_text: { type: "string" },
            },
            required: ["action"],
          },
        },
      },
      required: ["target"],
    },
    isConcurrencySafe() {
      return false;
    },
    async execute(args): Promise<ToolResultContent> {
      const target = asTarget(args.target);
      if (!target) {
        return {
          isError: true,
          content: JSON.stringify({
            success: false,
            error: `Invalid memory target '${String(args.target)}'. Use 'memory' or 'user'.`,
          }),
        };
      }
      const ops = asOps(args.operations);
      if (Array.isArray(args.operations) && args.operations.length > 0 && ops && ops.length > 0) {
        const result = await Promise.resolve(store.applyBatch(target, ops));
        return { isError: !result.success, content: JSON.stringify(result) };
      }
      if (args.operations !== undefined && !Array.isArray(args.operations)) {
        return {
          isError: true,
          content: JSON.stringify({
            success: false,
            error: "operations must be a list of {action, content?, old_text?} objects.",
          }),
        };
      }
      const action = String(args.action ?? "");
      const content = String(args.content ?? args.new_text ?? "");
      const oldText = String(args.old_text ?? "");
      if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
        return {
          isError: true,
          content: JSON.stringify({
            success: false,
            error: `Unknown action '${action}'. Use: add, replace, remove`,
          }),
        };
      }
      if ((action === "replace" || action === "remove") && !oldText.trim()) {
        return {
          isError: true,
          content: JSON.stringify({
            success: false,
            error: `'${action}' needs old_text — a short unique substring of the entry.`,
          }),
        };
      }
      if ((action === "add" || action === "replace") && !content.trim()) {
        return {
          isError: true,
          content: JSON.stringify({
            success: false,
            error: `content is required for '${action}'.`,
          }),
        };
      }
      const result = await Promise.resolve(
        action === "add"
          ? store.add(target, content)
          : action === "replace"
            ? store.replace(target, oldText, content)
            : store.remove(target, oldText),
      );
      return { isError: !result.success, content: JSON.stringify(result) };
    },
  };
  return [tool];
}
