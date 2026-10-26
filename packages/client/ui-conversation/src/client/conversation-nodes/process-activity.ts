/**
 * Cursor-style folded activity line for one process run.
 *
 * Collapsed chrome should read like "Explored 6 files, 1 search" — a verb +
 * counts over what ran — not a generic "Process · N steps" label. Categories
 * are derived from tool names the projection already collected.
 */

/** Buckets a folded process header can name. */
export interface ProcessActivityCounts {
  readonly files: number
  readonly searches: number
  readonly commands: number
  readonly edits: number
  readonly web: number
  readonly other: number
  readonly reasoning: number
}

/** Classify one tool display name into an activity bucket. */
export function classifyProcessTool(name: string): keyof Omit<ProcessActivityCounts, 'reasoning'> {
  // Normalize `StrReplace` / `read-file` / `read_file` onto one snake key.
  const key = name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (
    key === 'read'
    || key === 'read_file'
    || key === 'read_image'
    || key.startsWith('read_')
  ) return 'files'
  // Web before searches: `web_search` also contains "search".
  if (
    key === 'web'
    || key === 'web_search'
    || key === 'fetch'
    || key.includes('web')
  ) return 'web'
  if (
    key === 'grep'
    || key === 'glob'
    || key === 'search'
    || key === 'codebase_search'
    || key.includes('search')
    || key.includes('grep')
    || key.includes('glob')
  ) return 'searches'
  if (
    key === 'bash'
    || key === 'shell'
    || key === 'exec'
    || key === 'run_terminal_cmd'
    || key.includes('terminal')
    || key.includes('bash')
    || key.includes('shell')
  ) return 'commands'
  if (
    key === 'write'
    || key === 'write_file'
    || key === 'edit'
    || key === 'str_replace'
    || key === 'apply_patch'
    || key.includes('edit')
    || key.includes('write')
    || key.includes('replace')
    || key.includes('patch')
  ) return 'edits'
  return 'other'
}

/**
 * Count activity buckets from every tool call name (duplicates kept) plus
 * reasoning steps.
 */
export function countProcessActivity(
  toolCallNames: readonly string[],
  reasoning: number,
): ProcessActivityCounts {
  let files = 0
  let searches = 0
  let commands = 0
  let edits = 0
  let web = 0
  let other = 0
  for (const name of toolCallNames) {
    switch (classifyProcessTool(name)) {
      case 'files': files += 1; break
      case 'searches': searches += 1; break
      case 'commands': commands += 1; break
      case 'edits': edits += 1; break
      case 'web': web += 1; break
      default: other += 1; break
    }
  }
  return { files, searches, commands, edits, web, other, reasoning }
}

/** Locale keys one activity segment may need. */
export type ProcessActivityTranslate = (
  key:
    | 'chat.process.summary.explored'
    | 'chat.process.summary.searches'
    | 'chat.process.summary.commands'
    | 'chat.process.summary.edits'
    | 'chat.process.summary.web'
    | 'chat.process.summary.tools'
    | 'chat.process.summary.thoughts'
    | 'chat.process.summary.join'
    | 'chat.process.steps',
  params?: Record<string, unknown>,
) => string

/**
 * Build the folded header line (Cursor-style verb + counts).
 * @param counts - activity buckets from tool names + reasoning.
 * @param t - locale seat.
 * @param fallbackSteps - when buckets are empty but the group still has
 *   members (nameless roots), prefer this over claiming「0 步」.
 * @returns a single line; falls back to step count when nothing classified.
 */
export function formatProcessActivity(
  counts: ProcessActivityCounts,
  t: ProcessActivityTranslate,
  fallbackSteps?: number,
): string {
  const parts: string[] = []
  if (counts.files > 0) parts.push(t('chat.process.summary.explored', { count: counts.files }))
  if (counts.searches > 0) parts.push(t('chat.process.summary.searches', { count: counts.searches }))
  if (counts.commands > 0) parts.push(t('chat.process.summary.commands', { count: counts.commands }))
  if (counts.edits > 0) parts.push(t('chat.process.summary.edits', { count: counts.edits }))
  if (counts.web > 0) parts.push(t('chat.process.summary.web', { count: counts.web }))
  if (counts.other > 0) parts.push(t('chat.process.summary.tools', { count: counts.other }))
  if (counts.reasoning > 0) parts.push(t('chat.process.summary.thoughts', { count: counts.reasoning }))
  if (parts.length === 0) {
    const fromBuckets = counts.files + counts.searches + counts.commands + counts.edits
      + counts.web + counts.other + counts.reasoning
    return t('chat.process.steps', {
      count: fromBuckets > 0 ? fromBuckets : Math.max(0, fallbackSteps ?? 0),
    })
  }
  return parts.join(t('chat.process.summary.join'))
}
