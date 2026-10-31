/**
 * Pure row-model derivation for tool summary rows: variant classification,
 * one-line summary, expanded-body text, and flattened result output from the
 * frozen call slice. Input material comes from the call ARGUMENTS; output and
 * error material from the settled result node. A call whose render intent is
 * a terminal card gets its expanded body from the views instead, through
 * `terminalCardModel` in terminal-card-model.ts.
 *
 * The arguments are parsed once per row and the expansion body is materialized
 * lazily (`get body` on {@link ToolRowModel}): a collapsed row — the
 * overwhelmingly common case — never pays for the pretty-print of a call it
 * does not show.
 */
// The block union's defining home is runtime (fold-product types); this
// contract only forwards it (type-definition authority stays with the layer
// that produces the values).
import type { ToolCallBlock, ToolResultNode } from '@xrkseek/client-runtime/client'
import {
  formatAttachmentSummary,
  isAttachmentAddress,
} from '@xrkseek/client-runtime/client'
import { abbreviateHomePath } from '@xrkseek/client-ui-primitives'
import { readPartialStringFields } from './partial-args.ts'

export type { ToolCallBlock } from '@xrkseek/client-runtime/client'
export { abbreviateHomePath } from '@xrkseek/client-ui-primitives'

/** Tool-call row variants selected by the generic atomic renderer. */
export type ToolRowVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'others'

/** Row state semantic; colors self-supplied via StateDot (design gives none). */
export type ToolRowState = 'running' | 'ok' | 'error' | 'stopped'

/** Figma row titles per variant (design literals, not translatable copy). */
export const VARIANT_TITLES: Record<ToolRowVariant, string> = {
  search: 'Search', read: 'Read', bash: 'Bash',
  write: 'Write', edit: 'Edit', code: 'Code', others: 'Tool call',
}

/**
 * Known tool name -> variant.
 *
 * `cordis_define` is deliberately absent: ui-cordis registers a keyed
 * `tool.call.toolview` entry for it, and a keyed hit REPLACES the generic row
 * (this table is only reached through GenericToolCard, the dispatch fallback in
 * ToolCallTree). An entry here would be unreachable, and a second title for the
 * same call would be a second answer to a question the card already owns.
 */
const TOOL_VARIANTS: Record<string, ToolRowVariant> = {
  bash: 'bash',
  // The PowerShell twin is a shell tool: the bash row family (icon, colors)
  // with its own title from TOOL_TITLES, not the generic `others` row.
  pwsh: 'bash',
  // Fixture short name + Host wire name (exec-fs).
  read: 'read',
  read_file: 'read',
  read_image: 'read',
  web_fetch: 'read',
  web_search: 'search',
  grep: 'search',
  glob: 'search',
  // Fixture short names (`write`/`edit` in connection fixture) + Host wire names.
  write: 'write',
  write_file: 'write',
  edit: 'edit',
  apply_edit: 'edit',
  // Patch is edit-family chrome; body streams args (no FileMutationRow).
  apply_patch: 'edit',
  // Deliverable declaration: write-family chrome (edit glyph) while the title
  // below names the act; paths come from args.files / callView.locations.
  present: 'write',
  // Skill draft → user confirm → write SKILL.md (workspace propose_skill).
  propose_skill: 'write',
  run_code: 'code',
  cordis_package_inspect: 'read',
  cordis_runtime_inspect: 'read',
  // The three run-control verbs take one package id and produce a receipt, so
  // the generic row is the decided intent, not an unclassified default: there is
  // no program to show (that is `cordis_define`'s card) and no file to open. The
  // id lands in the summary slot, and the titles below name the act.
  cordis_run: 'others',
  cordis_stop: 'others',
  cordis_undefine: 'others',
}

/** Tool-owned titles that refine a generic row variant without replacing it. */
const TOOL_TITLES: Record<string, string> = {
  cordis_package_inspect: 'Inspect',
  cordis_runtime_inspect: 'Inspect',
  cordis_run: 'Run Cordis Plugin',
  cordis_stop: 'Stop Cordis Plugin',
  cordis_undefine: 'Remove Cordis Plugin',
  pwsh: 'Pwsh',
  read_image: 'Read image',
  image_generate: 'Image generation',
  video_generate: 'Video generation',
  present: 'Present',
  propose_skill: 'Write skill',
}

/**
 * Classify a tool name into its row variant.
 * @param toolName - wire tool name.
 * @returns matching variant, others when unknown.
 */
export function classifyTool(toolName: string): ToolRowVariant {
  return TOOL_VARIANTS[toolName] ?? 'others'
}

/** Locale-neutral structured fact consumed only by the user-facing Tool row. */
export interface AutoReviewDenial {
  /** Raw persisted reviewer reason; display normalization happens at render time. */
  reason: string | null
}

/** Openable path + display label for a multi-file header link (present). */
export interface ToolFileLink {
  /** Workspace / absolute path passed to `onOpenFile`. */
  path: string
  /** Abbreviated label shown in the row header. */
  label: string
}

/** Everything ToolRow needs, derived once from the frozen slice. */
export interface ToolRowModel {
  variant: ToolRowVariant
  title: string
  summary: string
  /**
   * Filesystem path from args (`path` / `file_path`) when the row is a file
   * tool; absent for URL reads and non-file tools. The chat view resolves
   * relative values against the session cwd before opening.
   */
  filePath: string | undefined
  /**
   * Every deliverable path as its own openable link (present multi-file).
   * When set, ToolRow prefers these over a single `filePath` + summary link.
   */
  fileLinks?: readonly ToolFileLink[] | undefined
  /**
   * Expanded-body input text (pretty args); null = no input section.
   *
   * An accessor on the returned model, not a stored field: the pretty-print
   * (data-URL redaction plus `JSON.stringify` over the whole argument object)
   * is the most expensive derivation in the row, and only an OPEN disclosure
   * ever renders it. Reading it here is what the expand path does; the first
   * read memoizes, so a re-render after opening costs nothing.
   */
  body: string | null
  /** Flattened result text ({@link resultText}); null while running or when the result carries no text. */
  output: string | null
  /** First line of the result text on an error row; null for every other state. */
  errorSummary: string | null
  /** Structured Auto-review denial identity; null for every ordinary result. */
  autoReviewDenial: AutoReviewDenial | null
  state: ToolRowState
}

function deriveAutoReviewDenial(block: ToolCallBlock): AutoReviewDenial | null {
  if (!('kind' in block) || !block.isError) return null
  const error = block.error
  if (error?.name !== 'AutoReviewDeniedError' || error.code !== 'AUTO_REVIEW_DENIED') return null
  return { reason: typeof error.reason === 'string' ? error.reason : null }
}

/**
 * Flatten a settled result's content blocks to display text: text blocks
 * verbatim, other block shapes as pretty JSON. Empty content on a failed call
 * falls back to the structured error's `name: code` line.
 * @param node - the settled result node.
 * @returns the flattened result text (may be empty).
 */
export function resultText(node: ToolResultNode): string {
  const parts: string[] = []
  for (const block of node.content) {
    if (block.type === 'text') parts.push(block.text)
    else parts.push(JSON.stringify(block, null, 2))
  }
  if (parts.length === 0 && node.error !== undefined) {
    parts.push(`${node.error.name}: ${node.error.code}`)
  }
  return parts.join('\n')
}

function parseArgs(argsRaw: string): unknown {
  try {
    return JSON.parse(argsRaw)
  } catch {
    // Non-JSON args (mid-stream truncation): summary/body fall back to the raw string.
    return undefined
  }
}

/**
 * Wrap a derivation in a one-shot memo. `null` is a real row value, so the
 * cache cannot key off the value being absent.
 * @param compute - the derivation to run at most once.
 * @returns a reader returning the cached value after the first call.
 */
function onceValue<T>(compute: () => T): () => T {
  let ready = false
  let value: T | undefined
  return () => {
    if (!ready) {
      value = compute()
      ready = true
    }
    return value as T
  }
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n')
  return nl === -1 ? text : text.slice(0, nl)
}

/** Collapse inlined data:image payloads so tool rows never dump megabyte base64. */
function redactDataUrls(text: string): string {
  return text.replace(
    /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{64,}/g,
    'data:image/…;base64,[redacted]',
  )
}

function redactArgsValue(value: unknown): unknown {
  if (typeof value === 'string') return redactDataUrls(value)
  if (Array.isArray(value)) return value.map(redactArgsValue)
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactArgsValue(v)
    }
    return out
  }
  return value
}

function pickString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = args[key]
    if (typeof v === 'string' && v !== '') return v
  }
  return undefined
}

/** Summary key preference per variant (args-derived; result-derived summaries are a ledger item). */
const SUMMARY_KEYS: Record<ToolRowVariant, readonly string[]> = {
  bash: ['description', 'command'],
  read: ['path', 'file_path', 'url'],
  search: ['query', 'pattern', 'url'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  code: ['description'],
  others: [],
}

/**
 * Strip the workspace root from a workspace-rooted absolute path (display only).
 * @param text - the path to shorten.
 * @param cwd - session workspace root; absent or empty leaves the path unchanged.
 * @returns the path relative to the workspace root, or unchanged when it is not rooted there.
 */
export function relativizeToCwd(text: string, cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return text
  const root = cwd.replace(/[/\\]+$/, '')
  if (text.startsWith(`${root}/`) || text.startsWith(`${root}\\`)) return text.slice(root.length + 1)
  return text
}

function deriveSummary(variant: ToolRowVariant, argsRaw: string, parsed: unknown): string {
  if (typeof parsed !== 'object' || parsed === null) {
    // Preparing / mid-stream: closed scalar fields beat dumping the raw prefix.
    const partial = readPartialStringFields(argsRaw, SUMMARY_KEYS[variant])
    if (partial !== undefined) return firstLine(redactDataUrls(partial))
    return firstLine(redactDataUrls(argsRaw))
  }
  const args = parsed as Record<string, unknown>
  const picked = pickString(args, SUMMARY_KEYS[variant])
  if (picked !== undefined) return firstLine(redactDataUrls(picked))
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v !== '' && !v.startsWith('data:image/')) {
      return firstLine(v)
    }
  }
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v !== '') return firstLine(redactDataUrls(v))
  }
  return firstLine(redactDataUrls(argsRaw))
}

/** Path keys only — never `url` (web_fetch lands on the read variant). */
const FILE_PATH_KEYS = ['path', 'file_path'] as const

/** File-tool variants whose summary may be an openable workspace path. */
const FILE_PATH_VARIANTS: ReadonlySet<ToolRowVariant> = new Set(['read', 'write', 'edit'])

function deriveFilePath(variant: ToolRowVariant, argsRaw: string, parsed: unknown): string | undefined {
  if (!FILE_PATH_VARIANTS.has(variant)) return undefined
  if (parsed === undefined) {
    return readPartialStringFields(argsRaw, FILE_PATH_KEYS)
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const picked = pickString(parsed as Record<string, unknown>, FILE_PATH_KEYS)
  if (picked === undefined) return undefined
  // Attachment ids stay openable: chat openFile opens a lightbox, not the sidebar.
  return firstLine(picked)
}

/** Display spelling for path-like summaries (attachment ids abbreviated). */
function displayPathSummary(text: string, cwd?: string, home?: string): string {
  if (isAttachmentAddress(text)) return formatAttachmentSummary(text)
  return abbreviateHomePath(relativizeToCwd(text, cwd), home)
}

/** Paths from `present` args.files (model-declared deliverables). */
function presentArgsPaths(parsed: unknown): string[] {
  if (typeof parsed !== 'object' || parsed === null) return []
  const files = (parsed as { files?: unknown }).files
  if (!Array.isArray(files)) return []
  const paths: string[] = []
  for (const file of files) {
    if (typeof file !== 'object' || file === null) continue
    const path = (file as { path?: unknown }).path
    if (typeof path === 'string' && path.trim() !== '') paths.push(path.trim())
  }
  return paths
}

/**
 * Fallback paths from the Host callView (presentCall locations) when args are
 * still streaming or truncated mid-JSON.
 */
function callViewPaths(block: ToolCallBlock): string[] {
  const view = block.callView
  if (view === null || !('locations' in view) || !Array.isArray(view.locations)) return []
  const paths: string[] = []
  for (const loc of view.locations) {
    if (typeof loc !== 'object' || loc === null) continue
    const path = (loc as { path?: unknown }).path
    if (typeof path === 'string' && path.trim() !== '') paths.push(path.trim())
  }
  return paths
}

/** All deliverable paths joined for plain-summary / a11y fallback. */
function formatPresentSummary(paths: readonly string[]): string | undefined {
  if (paths.length === 0) return undefined
  return paths.join(' · ')
}

/** Codex patch file markers (Add/Delete/Update/Move). Ignore spurious args.path. */
const PATCH_FILE_MARKERS = [
  '*** Add File: ',
  '*** Delete File: ',
  '*** Update File: ',
  '*** Move to: ',
] as const

/** Paths declared in apply_patch `patch` text (works on partial streams). */
function pathsFromPatchText(patch: string): string[] {
  const out: string[] = []
  for (const line of patch.split(/\r?\n/)) {
    const trimmed = line.trim()
    for (const marker of PATCH_FILE_MARKERS) {
      if (!trimmed.startsWith(marker)) continue
      const path = trimmed.slice(marker.length).trim()
      if (path !== '') out.push(path)
      break
    }
  }
  return out
}

/** Paths from apply_patch args.patch, or a closed `patch` field mid-stream. */
function applyPatchArgsPaths(parsed: unknown, argsRaw: string): string[] {
  if (typeof parsed === 'object' && parsed !== null) {
    const patch = (parsed as { patch?: unknown }).patch
    if (typeof patch === 'string' && patch !== '') return pathsFromPatchText(patch)
  }
  const partial = readPartialStringFields(argsRaw, ['patch'])
  if (partial !== undefined && partial !== '') return pathsFromPatchText(partial)
  return []
}

/** Paths from settled apply_patch result lines (`update path` / `add` / `delete`). */
function applyPatchResultPaths(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^(?:add|update|delete)\s+(.+)$/i.exec(line.trim())
    if (m?.[1] === undefined) continue
    const path = m[1].trim()
    if (path !== '') out.push(path)
  }
  return out
}

function deriveBody(variant: ToolRowVariant, argsRaw: string, parsed: unknown): string | null {
  if (argsRaw === '') return null
  if (parsed === undefined) return redactDataUrls(argsRaw)
  // The code row's expanded body IS the program (monospace via the row's
  // variant styling), not the args JSON envelope around it.
  if (variant === 'code' && typeof parsed === 'object' && parsed !== null) {
    const code = (parsed as Record<string, unknown>).code
    if (typeof code === 'string' && code !== '') return code
  }
  return JSON.stringify(redactArgsValue(parsed), null, 2)
}

/**
 * Derive the full row model from a frozen call slice.
 * @param toolName - wire tool name (dispatch-supplied; survives windowless results).
 * @param block - RunningToolCall or ToolResultNode off the snapshot caches.
 * @param cwd - session workspace root; workspace-rooted path summaries display relative to it.
 * @param home - host account home; leftover POSIX home paths display as `~`.
 * @returns the row model.
 */
export function toolRowModel(toolName: string, block: ToolCallBlock, cwd?: string, home?: string): ToolRowModel {
  const variant = classifyTool(toolName)
  const done = 'kind' in block
  const argsRaw = (done ? block.call?.argsRaw : block.argsRaw) ?? ''
  // Parse once: the summary, the file path and the body all read the same
  // argument object. The raw string still rides along for the partial readers
  // below, which only run while the JSON is still open (`parsed === undefined`).
  const args = parseArgs(argsRaw)
  const state: ToolRowState = !done ? 'running'
    : block.error?.code === 'interrupted' ? 'stopped'
      : block.isError ? 'error' : 'ok'
  const toolTitle = TOOL_TITLES[toolName]
  // Others keeps the static "Tool call" title (figma literal); the real tool
  // name rides the mutable summary slot unless the tool owns a specific title.
  // Tool-owned titles (incl. read_image) replace the variant literal.
  const title = toolTitle ?? VARIANT_TITLES[variant]

  // present: show deliverable paths while running (args.files, else callView).
  if (toolName === 'present') {
    const paths = presentArgsPaths(args)
    const resolved = paths.length > 0 ? paths : callViewPaths(block)
    const displayPaths = resolved.map(path => displayPathSummary(path, cwd, home))
    const presentSummary = formatPresentSummary(displayPaths)
    // Empty args: title + running sweep only (no callId flash on stream shells).
    const base = presentSummary
      ?? (argsRaw === '' ? '' : displayPathSummary(firstLine(argsRaw), cwd, home))
    const output = done ? (resultText(block) || null) : null
    const errorSummary = state === 'error' && output !== null ? firstLine(output) : null
    const fileLinks = resolved.length > 0
      ? resolved.map((path, i) => ({ path, label: displayPaths[i]! }))
      : undefined
    return {
      variant,
      title,
      summary: base,
      filePath: resolved[0],
      fileLinks,
      // Multi-file: path list as the expand body; single-file uses the path link.
      body: displayPaths.length > 1 ? displayPaths.join('\n') : null,
      output,
      errorSummary,
      autoReviewDenial: deriveAutoReviewDenial(block),
      state,
    }
  }

  // apply_patch: schema is `{ patch }` only. Models sometimes also send a junk
  // `path` (e.g. "x"); never use SUMMARY_KEYS / deriveFilePath for that — take
  // paths from patch markers, then callView.locations, then result lines.
  if (toolName === 'apply_patch') {
    const output = done ? (resultText(block) || null) : null
    const fromPatch = applyPatchArgsPaths(args, argsRaw)
    const fromView = callViewPaths(block)
    const fromResult = output !== null ? applyPatchResultPaths(output) : []
    const resolved = fromPatch.length > 0
      ? fromPatch
      : fromView.length > 0
        ? fromView
        : fromResult
    const displayPaths = resolved.map(path => displayPathSummary(path, cwd, home))
    const pathSummary = formatPresentSummary(displayPaths)
    const preparingTitle = (() => {
      const view = block.callView
      if (view === null || typeof view !== 'object') return ''
      const viewTitle = (view as { title?: unknown }).title
      return typeof viewTitle === 'string' && viewTitle.trim() !== '' ? viewTitle.trim() : ''
    })()
    const base = pathSummary
      ?? (argsRaw === '' ? preparingTitle : '')
    const errorSummary = state === 'error' && output !== null ? firstLine(output) : null
    const fileLinks = resolved.length > 0
      ? resolved.map((path, i) => ({ path, label: displayPaths[i]! }))
      : undefined
    const readBody = onceValue(() => (
      displayPaths.length > 1
        ? displayPaths.join('\n')
        : deriveBody(variant, argsRaw, args)
    ))
    return {
      variant,
      title,
      summary: base,
      filePath: resolved[0],
      fileLinks,
      get body(): string | null {
        return readBody()
      },
      output,
      errorSummary,
      autoReviewDenial: deriveAutoReviewDenial(block),
      state,
    }
  }

  // Preparing / mid-stream: prefer Host presentCall title when args have not
  // arrived yet; once args stream in, show command/path from them (no phase FSM).
  const preparingTitle = (() => {
    const view = block.callView
    if (view === null || typeof view !== 'object') return ''
    const title = (view as { title?: unknown }).title
    return typeof title === 'string' && title.trim() !== '' ? title.trim() : ''
  })()
  const base = argsRaw === ''
    ? preparingTitle
    : displayPathSummary(deriveSummary(variant, argsRaw, args), cwd, home)
  const summary = variant === 'others' && toolName !== '' && toolTitle === undefined
    ? (base === '' ? toolName : `${toolName} · ${base}`)
    : base
  // The empty string is "no text" for both derived result fields: a settled
  // call with blank content has nothing to expand, and a blank first line
  // would erase the collapsed error row's summary slot.
  const output = done ? (resultText(block) || null) : null
  const errorSummary = state === 'error' && output !== null ? firstLine(output) : null
  // The expansion body is the row's most expensive derivation (a redaction walk
  // over the argument tree plus a full `JSON.stringify`), and a collapsed row
  // never renders it and never asks whether it is non-null — so it stays behind
  // an accessor: the pretty-print runs when a disclosure opens, not on every
  // pass over the title/summary/output the row needs first. One-shot memoized,
  // because every read after the first (open → re-render) is another render.
  const readBody = onceValue(() => deriveBody(variant, argsRaw, args))
  return {
    variant,
    title,
    summary,
    filePath: deriveFilePath(variant, argsRaw, args),
    get body(): string | null {
      return readBody()
    },
    output,
    errorSummary,
    autoReviewDenial: deriveAutoReviewDenial(block),
    state,
  }
}
