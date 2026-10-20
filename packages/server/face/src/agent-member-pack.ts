/**
 * Portable advanced 干员 pack: playbook + optional skills + env prep.
 * Thin cards stay on `xrk-agent-member` JSON in the roster index.
 *
 * Layout (zip or directory under agent-rosters/packs/{scope}/{id}/):
 *   .xrk-agent-pack — required marker (illegal zip without it)
 *   manifest.json   — kind xrk-agent-pack, name, role, optional brief/inject/tools
 *   playbook.md     — required (≤ MEMBER_PLAYBOOK_MAX); stands in for AGENTS.md / rules
 *   skills/<id>/    — optional; child-only catalog (not parent workspace)
 *   env/SETUP.md    — optional parent prep text (never auto-run)
 *
 * Never pack curated memory (`scope=agent`) or appearance — those stay local.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  AGENT_MEMBER_CARD_KIND,
  parseAgentMemberCard,
  type AgentMemberCard,
} from "./agent-member-card.js";
import {
  MEMBER_PLAYBOOK_MAX,
  memberPackDir,
} from "./agent-roster-store.js";
import { buildStoredZip, readZipEntries, zipEntryName } from "./zip-store.js";

export const AGENT_MEMBER_PACK_KIND = "xrk-agent-pack";
export const AGENT_MEMBER_PACK_VERSION = 1;
/** Required root marker — zip/dir without it is rejected. */
export const AGENT_MEMBER_PACK_MARKER = ".xrk-agent-pack";

export interface AgentMemberPack {
  readonly card: AgentMemberCard;
  /** Relative skill directory names under `skills/` that contain SKILL.md. */
  readonly skillDirs: readonly string[];
  /** Parent-facing env prep markdown (from env/SETUP.md), if any. */
  readonly envPrep?: string;
  /** All file bytes keyed by normalized zip/dir-relative path. */
  readonly files: ReadonlyMap<string, Buffer>;
}

export type ParseAgentMemberPackResult =
  | { readonly ok: true; readonly pack: AgentMemberPack }
  | { readonly ok: false; readonly error: string };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function textOf(files: ReadonlyMap<string, Buffer>, rel: string): string | undefined {
  const buf = files.get(zipEntryName(rel));
  if (!buf) return undefined;
  return buf.toString("utf8");
}

function listSkillDirs(files: ReadonlyMap<string, Buffer>): string[] {
  const names = new Set<string>();
  for (const key of files.keys()) {
    const m = /^skills\/([^/]+)\/SKILL\.md$/i.exec(key);
    if (m?.[1]) names.add(m[1]);
  }
  return [...names].sort();
}

function markerPayload(): string {
  return `${JSON.stringify({
    kind: AGENT_MEMBER_PACK_KIND,
    version: AGENT_MEMBER_PACK_VERSION,
  })}\n`;
}

function hasPackMarker(files: ReadonlyMap<string, Buffer>): boolean {
  const raw = textOf(files, AGENT_MEMBER_PACK_MARKER)?.trim();
  if (!raw) return false;
  try {
    const row = asRecord(JSON.parse(raw));
    return row?.kind === AGENT_MEMBER_PACK_KIND;
  } catch {
    // Allow a bare token file for hand-authored packs.
    return raw === AGENT_MEMBER_PACK_KIND || raw.includes(AGENT_MEMBER_PACK_KIND);
  }
}

/** Parse a pack from an in-memory path→bytes map (zip or walked directory). */
export function parseAgentMemberPackFiles(
  files: ReadonlyMap<string, Buffer>,
): ParseAgentMemberPackResult {
  const normalized = new Map<string, Buffer>();
  for (const [k, v] of files) {
    const name = zipEntryName(k);
    if (name && !name.endsWith("/")) normalized.set(name, v);
  }

  if (!hasPackMarker(normalized)) {
    return {
      ok: false,
      error: `illegal pack: missing ${AGENT_MEMBER_PACK_MARKER} marker`,
    };
  }

  const playbookRaw =
    textOf(normalized, "playbook.md") ?? textOf(normalized, "PLAYBOOK.md");
  const playbook = playbookRaw?.trim() ?? "";
  if (!playbook) {
    return { ok: false, error: "pack needs playbook.md" };
  }
  if (playbook.length > MEMBER_PLAYBOOK_MAX) {
    return {
      ok: false,
      error: `playbook exceeds ${MEMBER_PLAYBOOK_MAX} characters`,
    };
  }

  const manifestRaw =
    textOf(normalized, "manifest.json") ??
    textOf(normalized, "member.json") ??
    textOf(normalized, "card.json");
  if (!manifestRaw) {
    return { ok: false, error: "pack needs manifest.json (or member.json)" };
  }

  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestRaw) as unknown;
  } catch {
    return { ok: false, error: "manifest.json is not JSON" };
  }
  const row = asRecord(manifestValue);
  if (!row) return { ok: false, error: "manifest must be an object" };

  const kind = typeof row.kind === "string" ? row.kind.trim() : "";
  if (kind !== AGENT_MEMBER_PACK_KIND && kind !== AGENT_MEMBER_CARD_KIND) {
    return {
      ok: false,
      error: `manifest kind must be ${AGENT_MEMBER_PACK_KIND} or ${AGENT_MEMBER_CARD_KIND}`,
    };
  }

  const cardPayload = {
    ...row,
    kind: AGENT_MEMBER_CARD_KIND,
    playbook,
  };
  const parsed = parseAgentMemberCard(cardPayload);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const envPrep =
    textOf(normalized, "env/SETUP.md")?.trim() ||
    textOf(normalized, "env/setup.md")?.trim() ||
    textOf(normalized, "SETUP.md")?.trim() ||
    undefined;

  return {
    ok: true,
    pack: {
      card: parsed.card,
      skillDirs: listSkillDirs(normalized),
      ...(envPrep ? { envPrep } : {}),
      files: normalized,
    },
  };
}

function walkDirFiles(root: string, prefix = ""): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "." || name === ".." || name === ".DS_Store") continue;
    const abs = path.join(root, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    const rel = prefix ? `${prefix}/${name}` : name;
    if (st.isDirectory()) {
      for (const [k, v] of walkDirFiles(abs, rel)) out.set(k, v);
    } else if (st.isFile()) {
      out.set(zipEntryName(rel), readFileSync(abs));
    }
  }
  return out;
}

function stripSingleTopFolder(
  entries: Map<string, Buffer>,
): Map<string, Buffer> {
  const keys = [...entries.keys()];
  const tops = new Set(
    keys.map((k) => k.split("/")[0]!).filter((t) => t.length > 0),
  );
  if (tops.size !== 1) return entries;
  const top = [...tops][0]!;
  const hasManifest =
    entries.has(`${top}/manifest.json`) ||
    entries.has(`${top}/member.json`) ||
    entries.has("manifest.json");
  const hasMarker =
    entries.has(`${top}/${AGENT_MEMBER_PACK_MARKER}`) ||
    entries.has(AGENT_MEMBER_PACK_MARKER);
  if (
    hasManifest &&
    hasMarker &&
    !entries.has("manifest.json") &&
    !entries.has(AGENT_MEMBER_PACK_MARKER)
  ) {
    const stripped = new Map<string, Buffer>();
    const prefix = `${top}/`;
    for (const [k, v] of entries) {
      if (k.startsWith(prefix)) stripped.set(k.slice(prefix.length), v);
      else stripped.set(k, v);
    }
    return stripped;
  }
  return entries;
}

/** Load a pack from a `.zip` file or an unpacked directory. */
export function loadAgentMemberPack(sourcePath: string): ParseAgentMemberPackResult {
  const abs = path.resolve(sourcePath);
  if (!existsSync(abs)) {
    return { ok: false, error: `pack path not found: ${abs}` };
  }
  let st;
  try {
    st = statSync(abs);
  } catch {
    return { ok: false, error: `cannot stat pack path: ${abs}` };
  }
  if (st.isDirectory()) {
    return parseAgentMemberPackFiles(walkDirFiles(abs));
  }
  if (!st.isFile()) {
    return { ok: false, error: "pack path must be a .zip or directory" };
  }
  const buf = readFileSync(abs);
  const entries = readZipEntries(buf);
  if (!entries) {
    return { ok: false, error: "not a readable zip (store or deflate)" };
  }
  return parseAgentMemberPackFiles(stripSingleTopFolder(entries));
}

/** Load pack bytes (e.g. UI upload). */
export function loadAgentMemberPackBytes(buf: Buffer): ParseAgentMemberPackResult {
  const entries = readZipEntries(buf);
  if (!entries) {
    return { ok: false, error: "not a readable zip (store or deflate)" };
  }
  return parseAgentMemberPackFiles(stripSingleTopFolder(entries));
}

/** Read env/SETUP.md from an already-materialized pack dir (parent prep text). */
export function readMemberPackEnvPrep(packDir: string): string | undefined {
  for (const rel of ["env/SETUP.md", "env/setup.md", "SETUP.md"] as const) {
    const abs = path.join(packDir, rel);
    if (!existsSync(abs)) continue;
    try {
      const text = readFileSync(abs, "utf8").trim();
      if (text) return text;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Hints for advanced members that are not ready yet (team_list / Face list / UI). */
export function notReadyPackHints(input: {
  readonly rosterWorkspaceId: string;
  readonly memberId: string;
  readonly productHome?: string | undefined;
}): {
  readonly packDir: string;
  readonly envPrep?: string;
  readonly envHint: string;
  readonly next: string;
} {
  const packDir = memberPackDir(
    input.rosterWorkspaceId,
    input.memberId,
    input.productHome,
  );
  const envPrep = readMemberPackEnvPrep(packDir);
  return {
    packDir,
    ...(envPrep ? { envPrep } : {}),
    envHint: envPrep
      ? "Follow envPrep in this parent session, then team_ready. Do not auto-run untrusted scripts."
      : "No env/SETUP.md — call team_ready when the member is configured.",
    next: "team_ready → subagent member_id",
  };
}

export interface MaterializeAgentMemberPackOptions {
  readonly rosterWorkspaceId: string;
  readonly memberId: string;
  readonly productHome?: string | undefined;
}

export interface MaterializeAgentMemberPackResult {
  readonly card: AgentMemberCard;
  readonly packDir: string;
  readonly skillNames: readonly string[];
  readonly envPrep?: string;
}

/**
 * Write pack files under `agent-rosters/packs/{scope}/{id}/`.
 * Skills stay in the pack — never installed into workspace `.agents/skills`.
 */
export function materializeAgentMemberPack(
  pack: AgentMemberPack,
  options: MaterializeAgentMemberPackOptions,
): MaterializeAgentMemberPackResult {
  const packDir = memberPackDir(
    options.rosterWorkspaceId,
    options.memberId,
    options.productHome,
  );
  if (existsSync(packDir)) {
    rmSync(packDir, { recursive: true, force: true });
  }
  mkdirSync(packDir, { recursive: true });

  const files = new Map(pack.files);
  if (!files.has(AGENT_MEMBER_PACK_MARKER)) {
    files.set(AGENT_MEMBER_PACK_MARKER, Buffer.from(markerPayload()));
  }

  for (const [rel, data] of files) {
    const name = zipEntryName(rel);
    if (!name || name.includes("..")) continue;
    const dest = path.join(packDir, name);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, data);
  }

  return {
    card: pack.card,
    packDir,
    skillNames: pack.skillDirs,
    ...(pack.envPrep ? { envPrep: pack.envPrep } : {}),
  };
}

/** Build a store-method zip for export (includes marker; no appearance). */
export function buildAgentMemberPackZip(card: AgentMemberCard, options?: {
  readonly skillsFiles?: ReadonlyMap<string, Buffer>;
  readonly envPrep?: string;
}): Buffer {
  const enc = new TextEncoder();
  const manifest = {
    kind: AGENT_MEMBER_PACK_KIND,
    version: AGENT_MEMBER_PACK_VERSION,
    name: card.name,
    role: card.role,
    ...(card.brief ? { brief: card.brief } : {}),
    ...(card.inject ? { inject: card.inject } : {}),
    ...(card.tools ? { tools: card.tools } : {}),
  };
  const entries: { name: string; data: Uint8Array }[] = [
    { name: AGENT_MEMBER_PACK_MARKER, data: enc.encode(markerPayload()) },
    { name: "manifest.json", data: enc.encode(`${JSON.stringify(manifest, null, 2)}\n`) },
    {
      name: "playbook.md",
      data: enc.encode(card.playbook.endsWith("\n") ? card.playbook : `${card.playbook}\n`),
    },
  ];
  if (options?.envPrep?.trim()) {
    entries.push({
      name: "env/SETUP.md",
      data: enc.encode(
        options.envPrep.endsWith("\n") ? options.envPrep : `${options.envPrep}\n`,
      ),
    });
  }
  if (options?.skillsFiles) {
    for (const [rel, data] of options.skillsFiles) {
      const name = zipEntryName(rel.startsWith("skills/") ? rel : `skills/${rel}`);
      entries.push({ name, data });
    }
  }
  return buildStoredZip(entries);
}

/** Zip an on-disk advanced pack directory (must already contain the marker). */
export function zipMemberPackDir(packDir: string): Buffer | undefined {
  if (!existsSync(packDir) || !statSync(packDir).isDirectory()) return undefined;
  const files = walkDirFiles(packDir);
  if (!hasPackMarker(files)) {
    files.set(AGENT_MEMBER_PACK_MARKER, Buffer.from(markerPayload()));
  }
  const entries = [...files.entries()].map(([name, data]) => ({ name, data }));
  return buildStoredZip(entries);
}
