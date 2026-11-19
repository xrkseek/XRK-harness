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
  "Curated memory: MEMORY.md + USER.md under {XRK_HOME}/memories, frozen into the system "
  + "prompt at session start (not standing ~/.xrk/USER.md / IDENTITY.md / SOUL.md). "
  + "Durable facts only — not a standing plan, todo list, or resume queue (`todo_write` "
  + "is session-scoped). Do not volunteer to resume MEMORY-only WIP unless the user asks. "
  + "Tool: `action` add|replace|remove|list or non-empty `operations`; `target` memory|user. "
  + "Writes hit disk immediately; when the files change this turn, a live "
  + "`<external_curated_memory>` fragment refreshes the window (prefer it over the freeze). "
  + "Present only while Settings → Plugins → Curated memory is on (not Mnemon, not AGENTS.md).";

const ACTIONS = ["add", "replace", "remove", "list"] as const;

/**
 * Both files are writable, but `USER.md` is the heavier hammer: it changes who
 * every later session believes the user is. Calls that target it should carry
 * only facts the user stated about themselves (or asked to be remembered),
 * never inferred persona.
 */
function asTarget(raw: unknown): CuratedMemoryTarget | undefined {
  const target = String(raw ?? "memory");
  if (target === "memory" || target === "user") return target;
  return undefined;
}

function asOps(raw: unknown): CuratedMemoryOperation[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return [];
  // Pass items through untouched: `applyBatch` already rejects an unknown
  // action with the real one-based index (`Operation N (unknown)`) and applies
  // nothing, so rewriting a bad item to `{}` here would only hide its source.
  return raw.map((item) => item as CuratedMemoryOperation);
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
      "Save durable facts for future sessions (preferences, lasting conventions, who the user is). "
      + "Do NOT store session WIP or todo checklists — use `todo_write` for those. "
      + "Required: `action` (`add|replace|remove|list`) or a non-empty `operations` array. "
      + "replace/remove need `old_text` (a unique substring). "
      + "Writes hit disk immediately; the system freeze stays, but a live curated-memory "
      + "fragment refreshes this session when the files change. "
      + "When the char cap blocks a write the error carries `prune_candidates` — the "
      + "longest-untouched entries, i.e. the ones to drop or compress first.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...ACTIONS],
          description: "Single change or list. Omit when using operations.",
        },
        target: {
          type: "string",
          enum: ["memory", "user"],
          description:
            "memory = MEMORY.md durable agent notes (default). "
            + "user = USER.md who-the-user-is profile — only facts the user stated about themselves.",
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
              action: { type: "string", enum: ["add", "replace", "remove"] },
              content: { type: "string" },
              new_text: { type: "string" },
              old_text: { type: "string" },
            },
            required: ["action"],
          },
        },
      },
      // `target` is deliberately not required: it defaults to `memory`, and
      // demanding it made the common call carry a constant.
      required: [],
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
            error:
              `Invalid memory target '${String(args.target)}'. `
              + "Use 'memory' (MEMORY.md) or 'user' (USER.md).",
          }),
        };
      }
      const action = String(args.action ?? "");
      if (action === "list") {
        const entries = await Promise.resolve(store.listEntries(target));
        const aged = store.staleEntries
          ? await Promise.resolve(store.staleEntries(target, 5))
          : [];
        return {
          content: JSON.stringify({
            success: true,
            target,
            entry_count: entries.length,
            current_entries: entries,
            ...(aged.length > 0
              ? {
                  stale_entries: aged.map((item) => ({
                    entry:
                      item.entry.length > 140
                        ? `${item.entry.slice(0, 140)}...`
                        : item.entry,
                    age_days: item.ageDays,
                    tracked: item.tracked,
                  })),
                }
              : {}),
          }),
        };
      }
      const ops = asOps(args.operations);
      if (ops && ops.length > 0) {
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
      const content = String(args.content ?? args.new_text ?? "");
      const oldText = String(args.old_text ?? "");
      if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
        return {
          isError: true,
          content: JSON.stringify({
            success: false,
            error: `Unknown action '${action}'. Pass action add|replace|remove|list, or a non-empty operations array.`,
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
