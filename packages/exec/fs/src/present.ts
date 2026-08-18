import type {
  DiffCallView,
  DiffResultView,
  GenericCallView,
  PresentableToolResult,
  ReadFileLine,
  ReadResultView,
  SearchFileMatches,
  SearchLineMatch,
  SearchMatchesResultView,
  SearchPathsResultView,
} from "@xrkseek/core-tools";

function asArgs(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function strArg(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Copied from `@deepseek-ai/dsh-tool-fs` `LANG_BY_EXTENSION`. */
const LANG_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: "ts",
  tsx: "tsx",
  mts: "ts",
  cts: "ts",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  json: "json",
  jsonc: "json",
  py: "py",
  rb: "rb",
  go: "go",
  rs: "rs",
  java: "java",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cxx: "cpp",
  cs: "cs",
  kt: "kotlin",
  swift: "swift",
  php: "php",
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  md: "md",
  markdown: "md",
  mdx: "mdx",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  sql: "sql",
  xml: "xml",
  lua: "lua",
};

/** Copied from `@deepseek-ai/dsh-tool-fs` `langFromPath`. */
export function langFromPath(filePath: string): string | undefined {
  const base = filePath.slice(
    Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")) + 1,
  );
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const ext = base.slice(dot + 1).toLowerCase();
  return Object.hasOwn(LANG_BY_EXTENSION, ext)
    ? LANG_BY_EXTENSION[ext]
    : undefined;
}

/**
 * Copied from `@deepseek-ai/dsh-tool-fs` `read.presentCall` (`path` is this
 * repo's `file_path`; no offset/limit on read_file).
 */
export function presentReadCall(args: unknown): GenericCallView | undefined {
  const path = strArg(asArgs(args), "path");
  if (!path) return undefined;
  return {
    card: "generic",
    title: `Read ${path}`,
    kind: "read",
    locations: [{ path, line: 1 }],
  };
}

/**
 * No DSH `presentationMeta` on this repo's ToolResult — project the tool's own
 * model-facing text. Malformed / error → undefined (client generic).
 */
export function presentReadResult(
  args: unknown,
  result: PresentableToolResult,
): ReadResultView | undefined {
  if (result.isError) return undefined;
  const path = strArg(asArgs(args), "path");
  if (!path) return undefined;
  const stripped = result.content.endsWith("\n[truncated]")
    ? result.content.slice(0, -"\n[truncated]".length)
    : result.content;
  const rawLines = stripped.split(/\r?\n/);
  const lines: ReadFileLine[] = rawLines.map((text, i) => ({
    number: i + 1,
    text,
  }));
  const lang = langFromPath(path);
  return {
    card: "read",
    path,
    offset: 1,
    lines,
    totalLines: rawLines.length,
    ...(lang ? { lang } : {}),
    content: [{ type: "text", text: stripped }],
  };
}

/** Copied from `@deepseek-ai/dsh-tool-fs` `write.presentCall` (`path` / `content`). */
export function presentWriteCall(args: unknown): DiffCallView | undefined {
  const a = asArgs(args);
  const path = strArg(a, "path");
  if (!path) return undefined;
  const body = typeof a.content === "string" ? a.content : "";
  return {
    card: "diff",
    title: `Write ${path}`,
    diffs: [{ path, oldText: null, newText: body }],
    locations: [{ path }],
  };
}

/**
 * Copied from DSH write `presentResult`: errors decline; missing meta falls
 * back to the call-time whole-file diff (never leak result text).
 */
export function presentWriteResult(
  args: unknown,
  result: PresentableToolResult,
): DiffResultView | undefined {
  if (result.isError) return undefined;
  const call = presentWriteCall(args);
  if (!call) return undefined;
  return { card: "diff", title: call.title, diffs: call.diffs };
}

/** Copied from `@deepseek-ai/dsh-tool-fs` `edit.presentCall` (`old_content` / `content`). */
export function presentEditCall(args: unknown): DiffCallView | undefined {
  const a = asArgs(args);
  const path = strArg(a, "path");
  if (!path) return undefined;
  const oldText = strArg(a, "old_content") || null;
  const newText = typeof a.content === "string" ? a.content : "";
  return {
    card: "diff",
    title: `Edit ${path}`,
    diffs: [{ path, oldText, newText }],
    locations: [{ path }],
  };
}

/**
 * DSH edit result needs applied `meta`; this repo has none, so replay the
 * call-time snippet (same fallback DSH write uses). Error → undefined.
 */
export function presentEditResult(
  args: unknown,
  result: PresentableToolResult,
): DiffResultView | undefined {
  if (result.isError) return undefined;
  const call = presentEditCall(args);
  if (!call) return undefined;
  return { card: "diff", title: call.title, diffs: call.diffs };
}

/** Copied from `@deepseek-ai/dsh-tool-fs-search` `presentGrepCall` (`glob` ≈ `include`). */
export function presentGrepCall(args: unknown): GenericCallView | undefined {
  const a = asArgs(args);
  const pattern = strArg(a, "pattern");
  if (!pattern) return undefined;
  const path = strArg(a, "path");
  const include = strArg(a, "include") ?? strArg(a, "glob");
  const where = path !== undefined ? ` in ${path}` : "";
  const filter = include !== undefined ? ` (${include})` : "";
  return {
    card: "generic",
    title: `Grep ${pattern}${where}${filter}`,
    kind: "search",
    rawInput: pattern,
  };
}

/**
 * DSH grep result reads `presentationMeta`. This tool's execute renders
 * `path:line:text` lines — inverse that grouping here. Error / unparseable → undefined.
 */
export function presentGrepResult(
  _args: unknown,
  result: PresentableToolResult,
): SearchMatchesResultView | undefined {
  if (result.isError) return undefined;
  const content = result.content;
  if (!content.trim() || content.trim() === "(no matches)") {
    return {
      card: "search",
      shape: "matches",
      files: [],
      truncated: false,
      total: 0,
    };
  }
  const grouped = new Map<string, SearchLineMatch[]>();
  let total = 0;
  for (const raw of content.split(/\r?\n/)) {
    if (!raw) continue;
    const m = /^(.*):(\d+):(.*)$/.exec(raw);
    if (!m) continue;
    total += 1;
    const filePath = m[1]!;
    const bucket = grouped.get(filePath) ?? [];
    bucket.push({ lineNumber: Number(m[2]), line: m[3]! });
    grouped.set(filePath, bucket);
  }
  if (total === 0) return undefined;
  const files: SearchFileMatches[] = [...grouped].map(([path, matches]) => ({
    path,
    matches,
  }));
  return {
    card: "search",
    shape: "matches",
    files,
    truncated: false,
    total,
  };
}

/** Copied from `@deepseek-ai/dsh-tool-fs-search` `presentGlobCall`. */
export function presentGlobCall(args: unknown): GenericCallView | undefined {
  const a = asArgs(args);
  const pattern = strArg(a, "pattern");
  if (!pattern) return undefined;
  const path = strArg(a, "path");
  const where = path !== undefined ? ` in ${path}` : "";
  return {
    card: "generic",
    title: `Glob ${pattern}${where}`,
    kind: "search",
    rawInput: pattern,
  };
}

export function presentGlobResult(
  _args: unknown,
  result: PresentableToolResult,
): SearchPathsResultView | undefined {
  if (result.isError) return undefined;
  const content = result.content;
  if (!content.trim() || content.trim() === "(no matches)") {
    return {
      card: "search",
      shape: "paths",
      paths: [],
      truncated: false,
      total: 0,
    };
  }
  const paths = content.split(/\r?\n/).filter((p) => p.length > 0);
  if (paths.length === 0) return undefined;
  return {
    card: "search",
    shape: "paths",
    paths,
    truncated: false,
    total: paths.length,
  };
}
