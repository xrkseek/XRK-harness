/**
 * Portable advanced 干员 pack (公文包): playbook + optional skills + env prep +
 * workspace materials. Thin cards stay on `xrk-agent-member` JSON in the roster.
 *
 * Layout: see {@link AGENT_MEMBER_PACK_LAYOUT}. Import rejects unknown root
 * names, path traversal, and skills/<id>/ without SKILL.md.
 *
 * Session cwd stays the parent workspace; pack_home is injected as 公文包.
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
  memberPackWorkspaceDir,
} from "./agent-roster-store.js";
import { buildStoredZip, readZipEntries, zipEntryName } from "./zip-store.js";

export const AGENT_MEMBER_PACK_KIND = "xrk-agent-pack";
export const AGENT_MEMBER_PACK_VERSION = 1;
/** Required root marker — zip/dir without it is rejected. */
export const AGENT_MEMBER_PACK_MARKER = ".xrk-agent-pack";

/** Model-facing bilingual name for the advanced pack home (not session cwd). */
export const MEMBER_PACK_BRIEFCASE = "公文包 (briefcase)";

/** One-line layout contract (tools, errors, skills). */
export const AGENT_MEMBER_PACK_LAYOUT =
  `Required: .xrk-agent-pack · manifest.json (kind xrk-agent-pack) · playbook.md. ` +
  `Optional: skills/<id>/ (+SKILL.md, references/…) · workspace/ (${MEMBER_PACK_BRIEFCASE} materials) · env/SETUP.md. ` +
  `Session cwd = parent workspace; ${MEMBER_PACK_BRIEFCASE} paths are absolute at runtime — share zip with relative paths only.`;

/** Allowed single-segment root file names (besides dirs below). */
const PACK_ROOT_FILES = new Set([
  AGENT_MEMBER_PACK_MARKER,
  "manifest.json",
  "member.json",
  "card.json",
  "playbook.md",
  "PLAYBOOK.md",
  "SETUP.md",
]);

/** Allowed top-level directories. Anything else at root → illegal pack. */
const PACK_ROOT_DIRS = new Set(["skills", "workspace", "env"]);

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

/** Reject path traversal, absolute entries, and non-standard root names. */
export function validatePackLayout(
  files: ReadonlyMap<string, Buffer>,
): string | undefined {
  const skillIds = new Set<string>();
  const skillHasMd = new Set<string>();
  for (const key of files.keys()) {
    const name = zipEntryName(key);
    if (!name) continue;
    if (
      name.includes("..") ||
      name.startsWith("/") ||
      name.startsWith("\\") ||
      /^[a-zA-Z]:/.test(name)
    ) {
      return `illegal pack path: ${name}`;
    }
    const parts = name.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    const top = parts[0]!;
    if (parts.length === 1) {
      if (!PACK_ROOT_FILES.has(top)) {
        return `illegal pack root file "${top}" — ${AGENT_MEMBER_PACK_LAYOUT}`;
      }
      continue;
    }
    if (!PACK_ROOT_DIRS.has(top)) {
      return `illegal pack root "${top}/" — allowed: skills/ workspace/ env/`;
    }
    if (top === "skills") {
      const id = parts[1];
      if (!id || id === "." || id === "..") {
        return `illegal skills path: ${name}`;
      }
      skillIds.add(id);
      if (parts.length === 3 && parts[2]!.toLowerCase() === "skill.md") {
        skillHasMd.add(id);
      }
    } else if (top === "env") {
      const leaf = parts.slice(1).join("/");
      if (leaf.toLowerCase() !== "setup.md") {
        return `illegal env file "${name}" — only env/SETUP.md`;
      }
    }
  }
  for (const id of skillIds) {
    if (!skillHasMd.has(id)) {
      return `skills/${id}/ missing SKILL.md`;
    }
  }
  return undefined;
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

  const layoutProblem = validatePackLayout(normalized);
  if (layoutProblem) {
    return { ok: false, error: layoutProblem };
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

/** Keep on-disk pack `playbook.md` aligned after a roster playbook revise. */
export function syncMemberPackPlaybook(input: {
  readonly rosterWorkspaceId: string;
  readonly memberId: string;
  readonly playbook: string;
  readonly productHome?: string | undefined;
}): boolean {
  const packDir = memberPackDir(
    input.rosterWorkspaceId,
    input.memberId,
    input.productHome,
  );
  if (!existsSync(packDir) || !statSync(packDir).isDirectory()) return false;
  const text = input.playbook.endsWith("\n") ? input.playbook : `${input.playbook}\n`;
  try {
    writeFileSync(path.join(packDir, "playbook.md"), text, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Bundle local skill directories into pack `skills/<id>/…` files.
 * Each path must be a directory containing SKILL.md (or a SKILL.md file's parent).
 * Walks the full tree — includes `references/`, scripts, and other assets.
 */
export function collectPackSkillFiles(
  skillPaths: readonly string[],
):
  | { readonly ok: true; readonly files: ReadonlyMap<string, Buffer> }
  | { readonly ok: false; readonly error: string } {
  const files = new Map<string, Buffer>();
  for (const raw of skillPaths) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let abs = path.resolve(trimmed);
    if (!existsSync(abs)) {
      return { ok: false, error: `skill path not found: ${trimmed}` };
    }
    let st;
    try {
      st = statSync(abs);
    } catch {
      return { ok: false, error: `cannot stat skill path: ${trimmed}` };
    }
    if (st.isFile()) {
      if (path.basename(abs).toLowerCase() !== "skill.md") {
        return { ok: false, error: `skill path must be a dir or SKILL.md: ${trimmed}` };
      }
      abs = path.dirname(abs);
    } else if (!st.isDirectory()) {
      return { ok: false, error: `skill path must be a directory: ${trimmed}` };
    }
    const skillMd = path.join(abs, "SKILL.md");
    if (!existsSync(skillMd)) {
      return { ok: false, error: `skill dir missing SKILL.md: ${trimmed}` };
    }
    const id = path.basename(abs).trim();
    if (!id || id === "." || id === "..") {
      return { ok: false, error: `invalid skill id from path: ${trimmed}` };
    }
    for (const [rel, data] of walkDirFiles(abs)) {
      files.set(zipEntryName(`skills/${id}/${rel}`), data);
    }
  }
  return { ok: true, files };
}

/**
 * Bundle dirs/files into pack `workspace/…` (公文包/briefcase materials, not session cwd).
 * A directory keeps its basename; a file lands as `workspace/<basename>`.
 */
export function collectPackWorkspaceFiles(
  filePaths: readonly string[],
):
  | { readonly ok: true; readonly files: ReadonlyMap<string, Buffer> }
  | { readonly ok: false; readonly error: string } {
  const files = new Map<string, Buffer>();
  for (const raw of filePaths) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const abs = path.resolve(trimmed);
    if (!existsSync(abs)) {
      return { ok: false, error: `workspace path not found: ${trimmed}` };
    }
    let st;
    try {
      st = statSync(abs);
    } catch {
      return { ok: false, error: `cannot stat workspace path: ${trimmed}` };
    }
    if (st.isFile()) {
      const base = path.basename(abs);
      if (!base || base === "." || base === "..") {
        return { ok: false, error: `invalid workspace file: ${trimmed}` };
      }
      files.set(zipEntryName(`workspace/${base}`), readFileSync(abs));
      continue;
    }
    if (!st.isDirectory()) {
      return { ok: false, error: `workspace path must be a file or directory: ${trimmed}` };
    }
    const id = path.basename(abs).trim();
    if (!id || id === "." || id === "..") {
      return { ok: false, error: `invalid workspace dir from path: ${trimmed}` };
    }
    for (const [rel, data] of walkDirFiles(abs)) {
      files.set(zipEntryName(`workspace/${id}/${rel}`), data);
    }
  }
  return { ok: true, files };
}

/**
 * Advanced member 公文包 (briefcase) root — not the session workspace cwd.
 * Spawn keeps parent cwd; this path is injected into child/parent context.
 */
export function resolveMemberPackHome(input: {
  readonly rosterWorkspaceId: string;
  readonly memberId: string;
  readonly productHome?: string | undefined;
}): string | undefined {
  const packDir = memberPackDir(
    input.rosterWorkspaceId,
    input.memberId,
    input.productHome,
  );
  if (!existsSync(packDir)) return undefined;
  try {
    if (!statSync(packDir).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  return packDir;
}

/**
 * Optional bundled materials under the pack (`workspace/`). Still under
 * 公文包 (briefcase), not the coding session cwd.
 */
export function resolveMemberPackMaterialsDir(input: {
  readonly rosterWorkspaceId: string;
  readonly memberId: string;
  readonly productHome?: string | undefined;
}): string | undefined {
  if (!resolveMemberPackHome(input)) return undefined;
  const materials = memberPackWorkspaceDir(
    input.rosterWorkspaceId,
    input.memberId,
    input.productHome,
  );
  try {
    if (existsSync(materials) && statSync(materials).isDirectory()) {
      return materials;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export type MemberPackSkillInfo = {
  readonly id: string;
  readonly path: string;
  readonly hasReferences: boolean;
  readonly referencesPath?: string;
};

/** Live 公文包 (briefcase) inventory for team_list / capability / revise responses. */
export type MemberPackInventory = {
  readonly packHome: string;
  readonly playbookPath: string;
  readonly envPrepPath?: string;
  readonly materialsPath?: string;
  readonly materialsTop: readonly string[];
  readonly skills: readonly MemberPackSkillInfo[];
};

/** Scan an on-disk advanced pack for playbook / env / materials / skills(+references). */
export function listMemberPackInventory(input: {
  readonly rosterWorkspaceId: string;
  readonly memberId: string;
  readonly productHome?: string | undefined;
}): MemberPackInventory | undefined {
  const packHome = resolveMemberPackHome(input);
  if (!packHome) return undefined;
  const playbookPath = path.join(packHome, "playbook.md");
  const envPrepPath = path.join(packHome, "env", "SETUP.md");
  const materialsPath = resolveMemberPackMaterialsDir(input);
  const materialsTop: string[] = [];
  if (materialsPath) {
    try {
      for (const name of readdirSync(materialsPath)) {
        if (name === "." || name === "..") continue;
        materialsTop.push(name);
      }
    } catch {
      // ignore
    }
  }
  const skills: MemberPackSkillInfo[] = [];
  const skillsRoot = path.join(packHome, "skills");
  try {
    if (existsSync(skillsRoot) && statSync(skillsRoot).isDirectory()) {
      for (const id of readdirSync(skillsRoot)) {
        if (id === "." || id === "..") continue;
        const skillPath = path.join(skillsRoot, id);
        let st;
        try {
          st = statSync(skillPath);
        } catch {
          continue;
        }
        if (!st.isDirectory()) continue;
        if (!existsSync(path.join(skillPath, "SKILL.md"))) continue;
        const referencesPath = path.join(skillPath, "references");
        let hasReferences = false;
        try {
          hasReferences =
            existsSync(referencesPath) && statSync(referencesPath).isDirectory();
        } catch {
          hasReferences = false;
        }
        skills.push({
          id,
          path: skillPath,
          hasReferences,
          ...(hasReferences ? { referencesPath } : {}),
        });
      }
    }
  } catch {
    // ignore
  }
  skills.sort((a, b) => a.id.localeCompare(b.id));
  return {
    packHome,
    playbookPath,
    ...(existsSync(envPrepPath) ? { envPrepPath } : {}),
    ...(materialsPath ? { materialsPath } : {}),
    materialsTop,
    skills,
  };
}

/**
 * Lean capability / preamble lines for a 公文包 (briefcase).
 * Do not dump every skill absolute path — those trees are in the skill catalog;
 * the child loads them with the skill tool. Full inventory stays on team_* JSON.
 */
export function formatMemberPackInventoryLines(
  inv: MemberPackInventory,
): string[] {
  const skillsDir = path.join(inv.packHome, "skills");
  const lines = [
    `${MEMBER_PACK_BRIEFCASE}: not workspace cwd — read/edit here or copy into workspace`,
    `pack_home: ${inv.packHome}`,
    `skills_dir: ${skillsDir}`,
  ];
  if (inv.skills.length === 0) {
    lines.push(
      "skills: (none yet) — when present, load/search with the skill tool by name (paths not dumped here)",
    );
  } else {
    lines.push(
      `skills: ${inv.skills.length} in skill catalog — load/search with the skill tool by name (not listed here); references/ under each skills/<id>/`,
    );
  }
  if (inv.materialsPath) {
    const tops =
      inv.materialsTop.length > 0
        ? ` · top=${inv.materialsTop.slice(0, 12).join(",")}`
        : "";
    lines.push(`materials: ${inv.materialsPath}${tops}`);
  }
  return lines;
}

/**
 * Merge skills / materials / env into an existing 公文包 (briefcase)
 * without wiping other roots. Creates missing dirs; overwrites colliding paths.
 */
export function mergeIntoMemberPack(input: {
  readonly rosterWorkspaceId: string;
  readonly memberId: string;
  readonly productHome?: string | undefined;
  readonly skillsFiles?: ReadonlyMap<string, Buffer>;
  readonly workspaceFiles?: ReadonlyMap<string, Buffer>;
  readonly envPrep?: string;
}):
  | { readonly ok: true; readonly inventory: MemberPackInventory }
  | { readonly ok: false; readonly error: string } {
  const packHome = resolveMemberPackHome(input);
  if (!packHome) {
    return {
      ok: false,
      error: `${MEMBER_PACK_BRIEFCASE} missing on disk — re-import pack= or team_save kind=advanced`,
    };
  }
  const writeRel = (rel: string, data: Buffer): void => {
    const name = zipEntryName(rel);
    if (!name || name.includes("..")) return;
    const dest = path.join(packHome, name);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, data);
  };
  if (input.envPrep?.trim()) {
    const text = input.envPrep.endsWith("\n")
      ? input.envPrep
      : `${input.envPrep}\n`;
    writeRel("env/SETUP.md", Buffer.from(text, "utf8"));
  }
  if (input.skillsFiles) {
    for (const [rel, data] of input.skillsFiles) {
      writeRel(rel.startsWith("skills/") ? rel : `skills/${rel}`, data);
    }
  }
  if (input.workspaceFiles) {
    for (const [rel, data] of input.workspaceFiles) {
      writeRel(
        rel.startsWith("workspace/") ? rel : `workspace/${rel}`,
        data,
      );
    }
  }
  const inventory = listMemberPackInventory(input);
  if (!inventory) {
    return {
      ok: false,
      error: `${MEMBER_PACK_BRIEFCASE} inventory failed after merge`,
    };
  }
  return { ok: true, inventory };
}

/** Build a store-method zip for export (includes marker; no appearance). */
export function buildAgentMemberPackZip(card: AgentMemberCard, options?: {
  readonly skillsFiles?: ReadonlyMap<string, Buffer>;
  readonly workspaceFiles?: ReadonlyMap<string, Buffer>;
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
  if (options?.workspaceFiles) {
    for (const [rel, data] of options.workspaceFiles) {
      const name = zipEntryName(
        rel.startsWith("workspace/") ? rel : `workspace/${rel}`,
      );
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
