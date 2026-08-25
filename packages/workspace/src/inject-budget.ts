import type { WorkspaceBudgetEvent } from "./durable-inject.js";

/** Shared inject budget (Codex `project_doc_max_bytes` / DSH `maxBytes`). */
export interface InjectBudget {
  left: number;
  events: WorkspaceBudgetEvent[];
}

/** Per-file read cap before budget clipping (DSH `maxSourceBytes`). */
export const MAX_INSTRUCTION_FILE_BYTES = 256_000;

export function createInjectBudget(maxChars: number): InjectBudget {
  return { left: maxChars, events: [] };
}

/**
 * Clip `text` into the shared inject budget and record truncation metadata.
 * Returns empty string when budget is exhausted.
 */
export function clipToBudget(
  section: string,
  text: string,
  budget: InjectBudget,
  options?: { readonly suffix?: string },
): string {
  const suffix = options?.suffix ?? "\n[truncated]";
  if (budget.left <= 0) {
    if (text.length > 0) {
      budget.events.push({
        type: "workspace/budget-truncation",
        section,
        originalChars: text.length,
        keptChars: 0,
      });
    }
    return "";
  }
  if (text.length <= budget.left) {
    budget.left -= text.length;
    return text;
  }
  const kept = text.slice(0, budget.left);
  budget.events.push({
    type: "workspace/budget-truncation",
    section,
    originalChars: text.length,
    keptChars: kept.length,
  });
  budget.left = 0;
  return kept + suffix;
}

/** Bound a single source file before it enters the shared budget. */
export function boundInstructionFile(raw: string): string {
  if (raw.length <= MAX_INSTRUCTION_FILE_BYTES) return raw;
  return `${raw.slice(0, MAX_INSTRUCTION_FILE_BYTES)}\n[file truncated]`;
}
