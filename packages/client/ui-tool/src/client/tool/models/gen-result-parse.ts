/**
 * Parse text envelopes from `image_generate` / `video_generate` tool results.
 * Protocol stays text-only (`attachmentId=` / `file=` / `jobId=` lines).
 */

/** One generated image stanza (optional metadata beside attachmentId). */
export interface ParsedImageGenImage {
  readonly attachmentId: string
  readonly mime?: string
  readonly bytes?: number
  readonly url?: string
  readonly revisedPrompt?: string
}

/** Parsed `image_generate` result text. */
export interface ParsedImageGenResult {
  readonly images: readonly ParsedImageGenImage[]
  /** Result text with `image_base64=` lines stripped (for display under gallery). */
  readonly displayText: string
  readonly providerLine: string | undefined
}

/** Parsed `video_generate` result text. */
export interface ParsedVideoGenResult {
  readonly jobId: string | undefined
  readonly status: string | undefined
  readonly progress: string | undefined
  readonly attachmentId: string | undefined
  readonly file: string | undefined
  readonly mime: string | undefined
  readonly bytes: number | undefined
  /** Compact one-line status for the collapsed summary. */
  readonly statusSummary: string | undefined
  /** Result text without empty noise lines (still no binary). */
  readonly displayText: string
}

function flattenResultText(content: readonly { type: string; text?: string }[]): string {
  const parts: string[] = []
  for (const part of content) {
    if (part.type === 'text' && typeof part.text === 'string') parts.push(part.text)
  }
  return parts.join('\n')
}

function parseKvLine(line: string): { key: string; value: string } | null {
  const eq = line.indexOf('=')
  if (eq <= 0) return null
  return { key: line.slice(0, eq), value: line.slice(eq + 1) }
}

/**
 * Split one line into its `key=value` pairs. Host emitters pack metadata on a
 * single line (`mime=image/jpeg bytes=800`, or a whole `jobId=… provider=…
 * mime=… bytes=…` row), while value-bearing single-KV lines keep their spaces
 * (`revised_prompt=a cat with hat`). A line only splits when a later
 * whitespace-separated token also carries an `=`.
 * @param line - one result-text line.
 * @returns the line's key/value pairs.
 */
function parseLineKvs(line: string): { key: string; value: string }[] {
  const first = parseKvLine(line)
  if (!first) return []
  const tokens = first.value.split(/\s+/)
  if (tokens.length <= 1 || !tokens.some((tok) => tok.includes('='))) {
    return [first]
  }
  const out: { key: string; value: string }[] = []
  for (const tok of line.split(/\s+/)) {
    const kv = parseKvLine(tok)
    if (kv) out.push(kv)
  }
  return out
}



/**
 * Parse `image_generate` tool result text into gallery refs + display copy.
 */
export function parseImageGenResultText(text: string): ParsedImageGenResult {
  const lines = text.split(/\r?\n/)
  const images: ParsedImageGenImage[] = []
  let current: {
    attachmentId?: string
    mime?: string
    bytes?: number
    url?: string
    revisedPrompt?: string
  } = {}
  const display: string[] = []
  let providerLine: string | undefined

  const flush = (): void => {
    if (current.attachmentId) {
      images.push({
        attachmentId: current.attachmentId,
        ...(current.mime ? { mime: current.mime } : {}),
        ...(current.bytes !== undefined ? { bytes: current.bytes } : {}),
        ...(current.url ? { url: current.url } : {}),
        ...(current.revisedPrompt ? { revisedPrompt: current.revisedPrompt } : {}),
      })
    }
    current = {}
  }

  for (const line of lines) {
    if (line.startsWith('--- image ')) {
      flush()
      continue
    }
    if (line.startsWith('provider=') && providerLine === undefined) {
      providerLine = line
    }
    if (line.startsWith('image_base64=')) continue
    // The host packs several keys per line, so fold each pair into the image
    // being collected while the display keeps the original line.
    const pairs = parseLineKvs(line)
    for (const kv of pairs) {
      if (kv.key === 'attachmentId' && kv.value) {
        current.attachmentId = kv.value
        continue
      }
      if (kv.key === 'mime' && kv.value) {
        current.mime = kv.value
        continue
      }
      if (kv.key === 'bytes' && /^\d+$/.test(kv.value)) {
        current.bytes = Number(kv.value)
        continue
      }
      if (kv.key === 'url' && kv.value) {
        current.url = kv.value
        continue
      }
      if (kv.key === 'revised_prompt' && kv.value) {
        current.revisedPrompt = kv.value
        continue
      }
    }
    if (pairs.length > 0) {
      display.push(line)
      continue
    }
    if (line.trim() !== '') display.push(line)
  }
  flush()

  return {
    images,
    displayText: display.join('\n'),
    providerLine,
  }
}

/**
 * Parse `video_generate` tool result text into status + optional attachment meta.
 */
export function parseVideoGenResultText(text: string): ParsedVideoGenResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  let jobId: string | undefined
  let status: string | undefined
  let progress: string | undefined
  let attachmentId: string | undefined
  let file: string | undefined
  let mime: string | undefined
  let bytes: number | undefined

  for (const line of lines) {
    // `formatJob` / content rows pack several keys per line
    // (`jobId=… status=… progress=…` or `jobId=… provider=… mime=… bytes=…`).
    for (const kv of parseLineKvs(line)) {
      switch (kv.key) {
        case 'jobId':
          jobId = kv.value
          break
        case 'status':
          status = kv.value
          break
        case 'progress':
          progress = kv.value
          break
        case 'attachmentId':
          attachmentId = kv.value
          break
        case 'file':
          file = kv.value
          break
        case 'mime':
          mime = kv.value
          break
        case 'bytes':
          if (/^\d+$/.test(kv.value)) bytes = Number(kv.value)
          break
        default:
          break
      }
    }
  }

  const statusParts: string[] = []
  if (status) statusParts.push(status)
  if (progress !== undefined && progress !== '') statusParts.push(`${progress}%`)
  if (jobId) statusParts.push(jobId)
  if (file) statusParts.push(file)
  else if (attachmentId) statusParts.push(attachmentId)

  return {
    jobId,
    status,
    progress,
    attachmentId,
    file,
    mime,
    bytes,
    statusSummary: statusParts.length > 0 ? statusParts.join(' · ') : undefined,
    displayText: lines.join('\n'),
  }
}

/** Flatten settled tool content then parse as image_generate. */
export function parseImageGenResultContent(
  content: readonly { type: string; text?: string }[],
): ParsedImageGenResult {
  return parseImageGenResultText(flattenResultText(content))
}

/** Flatten settled tool content then parse as video_generate. */
export function parseVideoGenResultContent(
  content: readonly { type: string; text?: string }[],
): ParsedVideoGenResult {
  return parseVideoGenResultText(flattenResultText(content))
}
