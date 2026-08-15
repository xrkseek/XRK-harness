/**
 * Model-facing tool output bounding (OpenCode ToolOutputStore.bound semantics).
 * Domain tools may return full text; this layer truncates what the model / session log sees.
 */

export const DEFAULT_TOOL_OUTPUT_MAX_LINES = 2_000;
export const DEFAULT_TOOL_OUTPUT_MAX_BYTES = 50 * 1024;

export interface ToolOutputBoundLimits {
  readonly maxLines?: number;
  readonly maxBytes?: number;
}

export interface BoundToolOutputResult {
  readonly content: string;
  readonly truncated: boolean;
  readonly outputPaths: readonly string[];
  readonly originalBytes: number;
  readonly originalLines: number;
}

export interface BoundToolOutputOptions extends ToolOutputBoundLimits {
  /**
   * Persist full content when truncating. Return a path (or opaque id) for the marker.
   * If omitted, truncate in-memory only.
   */
  readonly persist?: (fullContent: string) => string | Promise<string>;
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

function takePrefix(input: string, maximumBytes: number): string {
  let bytes = 0;
  let content = "";
  for (const char of input) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maximumBytes) break;
    content += char;
    bytes += size;
  }
  return content;
}

function takeSuffix(input: string, maximumBytes: number): string {
  let bytes = 0;
  const chars: string[] = [];
  const units = Array.from(input);
  for (let i = units.length - 1; i >= 0; i--) {
    const char = units[i]!;
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maximumBytes) break;
    chars.unshift(char);
    bytes += size;
  }
  return chars.join("");
}

function preview(
  text: string,
  maxLines: number,
  maxBytes: number,
): { head: string; tail: string } {
  const lines = text.split("\n");
  const headLines = Math.ceil(maxLines / 2);
  const tailLines = Math.floor(maxLines / 2);
  const sampled =
    lines.length <= maxLines
      ? text
      : [
          lines.slice(0, headLines).join("\n"),
          ...(tailLines > 0
            ? [lines.slice(lines.length - tailLines).join("\n")]
            : []),
        ].join("\n");

  if (Buffer.byteLength(sampled, "utf8") <= maxBytes) {
    return lines.length <= maxLines
      ? { head: sampled, tail: "" }
      : {
          head: lines.slice(0, headLines).join("\n"),
          tail:
            tailLines > 0
              ? lines.slice(lines.length - tailLines).join("\n")
              : "",
        };
  }

  const headBytes = Math.ceil(maxBytes / 2);
  const tailBytes = Math.floor(maxBytes / 2);
  return {
    head: takePrefix(sampled, headBytes),
    tail: takeSuffix(sampled, tailBytes),
  };
}

function boundedPreview(
  text: string,
  marker: string,
  maxLines: number,
  maxBytes: number,
): string {
  const markerBytes = Buffer.byteLength(marker, "utf8");
  if (maxLines <= 4 || maxBytes <= markerBytes + 4) {
    return takePrefix(marker, maxBytes).split("\n").slice(0, maxLines).join("\n");
  }
  const bounded = preview(text, maxLines - 4, maxBytes - markerBytes - 4);
  return bounded.tail
    ? `${bounded.head}\n\n${marker}\n\n${bounded.tail}`
    : `${bounded.head}\n\n${marker}`;
}

/**
 * Bound model-visible tool text. Pure aside from optional `persist`.
 */
export async function boundToolOutput(
  text: string,
  options: BoundToolOutputOptions = {},
): Promise<BoundToolOutputResult> {
  const maxLines = options.maxLines ?? DEFAULT_TOOL_OUTPUT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_TOOL_OUTPUT_MAX_BYTES;
  const originalBytes = Buffer.byteLength(text, "utf8");
  const originalLines = lineCount(text);

  if (originalLines <= maxLines && originalBytes <= maxBytes) {
    return {
      content: text,
      truncated: false,
      outputPaths: [],
      originalBytes,
      originalLines,
    };
  }

  const outputPaths: string[] = [];
  let marker = "... output truncated ...";
  if (options.persist) {
    const path = await options.persist(text);
    outputPaths.push(path);
    marker = `... output truncated; full content saved to ${path} ...`;
  }

  return {
    content: boundedPreview(text, marker, maxLines, maxBytes),
    truncated: true,
    outputPaths,
    originalBytes,
    originalLines,
  };
}

/** In-memory persist for tests / ephemeral hosts. */
export function createMemoryToolOutputPersist(prefix = "mem://tool-output/") {
  const files = new Map<string, string>();
  let seq = 0;
  return {
    persist(content: string): string {
      const id = `${prefix}tool_${++seq}`;
      files.set(id, content);
      return id;
    },
    read(id: string): string | undefined {
      return files.get(id);
    },
    clear() {
      files.clear();
    },
  };
}
