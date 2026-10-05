/**
 * Agent Team roster: the child's tools, inject, and playbook as named profiles.
 * Parent sessions already edit those surfaces via preset / `.xrk` / the user
 * message; a 干员 is the same three surfaces for `subagent`.
 * Global members live in `global.json`; workspace members overlay per canvas.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveXrkHome } from "@xrkseek/server-config";
import {
  isAgentTeamSpawnRole,
  roleDeniedTools,
  type AgentTeamSpawnRole,
} from "./agent-team-roles.js";
import { tryWriteJsonSidecar } from "./json-sidecar.js";
import {
  GLASSES_BUILTINS,
  HAT_BUILTINS,
  HELD_BUILTINS,
  parseSlotPick,
  resolveEnginePick,
  resolveStickerOverlay,
  splitLegacyKit,
  stickerIdFromPick,
  type PresenceSticker,
} from "./presence-dressing.js";

export const MEMBER_NAME_MAX = 40;
export const MEMBER_PLAYBOOK_MAX = 8_000;
export const MEMBER_FACE_MAX = 80_000;
export const MEMBER_BRIEF_MAX = 160;
export const GLOBAL_ROSTER_ID = "global";

export const MEMBER_SHAPES = [
  "blob",
  "wedge",
  "gem",
  "squircle",
  "drop",
  "pill",
  "petal",
  "loaf",
  "heart",
  "star",
  "hex",
  "egg",
  "cloud",
  "shield",
] as const;
export const MEMBER_COLORS = [
  "cream",
  "mist",
  "peach",
  "sage",
  "lilac",
  "slate",
  "coral",
  "butter",
  "mint",
  "sky",
  "rose",
  "cocoa",
  "honey",
  "ocean",
  "grape",
  "blush",
  "sand",
  "ink",
  "ice",
  "matcha",
] as const;
export const MEMBER_KITS = [
  "none",
  "bow",
  "cap",
  "beanie",
  "visor",
  "specs",
  "specs-rect",
  "specs-cat",
  "specs-sun",
  "halo",
] as const;

export type MemberShape = (typeof MEMBER_SHAPES)[number];
export type MemberColor = (typeof MEMBER_COLORS)[number];
export type MemberKit = (typeof MEMBER_KITS)[number];
export type RosterScope = "global" | "workspace";
export type MemberInject = "subagent" | "minimal";

export interface MemberAppearance {
  readonly shape: MemberShape;
  readonly color: MemberColor;
  /** Optional overlay kit (`none` omitted). PNG overlays are separate. */
  readonly kit?: Exclude<MemberKit, "none">;
  /** @deprecated Use `overlayHat`. Still read as the hat layer. */
  readonly face?: string;
  readonly overlayHat?: string;
  readonly overlayGlasses?: string;
  readonly overlayHeld?: string;
  /** Slot pick: builtin id or `sticker:<id>`. */
  readonly kitHat?: string;
  readonly kitGlasses?: string;
  readonly kitHeld?: string;
}

export interface MemberToolPolicy {
  readonly mode: "allow" | "deny";
  readonly names: readonly string[];
}

export interface AgentRosterMember {
  readonly id: string;
  readonly name: string;
  readonly playbook: string;
  readonly role: AgentTeamSpawnRole;
  readonly appearance: MemberAppearance;
  readonly brief: string;
  readonly inject: MemberInject;
  readonly tools?: MemberToolPolicy;
  /** True for catalog examples that ship with the file. */
  readonly seed?: true;
  readonly updatedAt: number;
}

export type ListedRosterMember = AgentRosterMember & {
  readonly scope: RosterScope;
  /** Catalog example id (`mem_seed_*`), even after the user edits and `seed` drops. */
  readonly catalog?: true;
};

const CATALOG_SEED_MEMBER_IDS = new Set([
  "mem_seed_researcher",
  "mem_seed_worker",
  "mem_seed_reviewer",
  "mem_seed_lead",
  "mem_seed_scout",
  "mem_seed_docs",
  "mem_seed_fixer",
  "mem_seed_tester",
]);

export function isCatalogSeedMemberId(id: string): boolean {
  return CATALOG_SEED_MEMBER_IDS.has(id);
}

/** Built-in catalog ids cannot be updated or deleted; mint a new id to fork. */
export function catalogMemberWriteProblem(raw: unknown): string | undefined {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return undefined;
  const id = normalizeMemberId(trimmed);
  if (!id || !isCatalogSeedMemberId(id)) return undefined;
  return `catalog member ${id} is built-in; omit id to mint a new role from that template`;
}

function listedMember(
  row: AgentRosterMember,
  scope: RosterScope,
): ListedRosterMember {
  return {
    ...row,
    scope,
    ...(isCatalogSeedMemberId(row.id) ? { catalog: true as const } : {}),
  };
}

interface PersistShape {
  readonly version: 1;
  readonly members: AgentRosterMember[];
}

const ID_RE = /^mem_[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;

/**
 * `mem_`-prefixed id, or `undefined` when none was given (caller mints one).
 * A natural id (`xrk-releaseer`) gets the prefix rather than being dropped;
 * what still cannot match is the caller's bug — ask {@link memberIdProblem}
 * instead of silently handing back a different id.
 */
export function normalizeMemberId(raw: unknown): string | undefined {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return undefined;
  if (ID_RE.test(trimmed)) return trimmed;
  const prefixed = `mem_${trimmed}`;
  return ID_RE.test(prefixed) ? prefixed : undefined;
}

/** Non-empty when a supplied id can never be valid — surface it, don't blame name/playbook. */
export function memberIdProblem(raw: unknown): string | undefined {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed || normalizeMemberId(trimmed)) return undefined;
  return `invalid id "${trimmed}": expected mem_ then [A-Za-z0-9][A-Za-z0-9._-]* (max 64 chars); omit id to mint one`;
}

/** Default allow-list for a file-only 干员 (release / inspect). */
export const MEMBER_FILE_TOOLS = ["bash", "read", "grep", "glob"] as const;

export function parseRosterScope(raw: unknown): RosterScope {
  return raw === "global" ? "global" : "workspace";
}

export function rosterRoot(productHome?: string): string {
  return path.join(path.resolve(productHome ?? resolveXrkHome()), "agent-rosters");
}

function sanitizeWorkspaceId(workspaceId: string): string {
  const trimmed = workspaceId.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`invalid workspaceId: ${workspaceId}`);
  }
  return trimmed;
}

function filePath(workspaceId: string, productHome?: string): string {
  return path.join(rosterRoot(productHome), `${sanitizeWorkspaceId(workspaceId)}.json`);
}

function mintId(): string {
  return `mem_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function isMemberShape(value: unknown): value is MemberShape {
  return MEMBER_SHAPES.includes(value as MemberShape);
}

function isMemberColor(value: unknown): value is MemberColor {
  return MEMBER_COLORS.includes(value as MemberColor);
}

function isMemberKit(value: unknown): value is MemberKit {
  return MEMBER_KITS.includes(value as MemberKit);
}

/** Transparent PNG/JPEG/WebP/GIF data URL used as a kit overlay (hat / glasses / held). */
export function parseOverlayImage(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const face = raw.trim();
  if (!face || face.length > MEMBER_FACE_MAX) return undefined;
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(face)) {
    return undefined;
  }
  return face.replace(/\s+/g, "");
}

function pickOverlay(
  base: Record<string, unknown>,
  key: string,
  fallback: string | undefined,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(base, key)) {
    return parseOverlayImage(base[key]);
  }
  return fallback;
}

export function parseMemberAppearance(
  raw: unknown,
  fallback: MemberAppearance,
): MemberAppearance {
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const shape = isMemberShape(base.shape) ? base.shape : fallback.shape;
  const color = isMemberColor(base.color) ? base.color : fallback.color;
  const kitRaw = Object.prototype.hasOwnProperty.call(base, "kit")
    ? base.kit
    : fallback.kit;
  const kit = isMemberKit(kitRaw) && kitRaw !== "none" ? kitRaw : undefined;
  const overlayHat =
    pickOverlay(base, "overlayHat", fallback.overlayHat)
    ?? (Object.prototype.hasOwnProperty.call(base, "face")
      ? parseOverlayImage(base.face)
      : fallback.face);
  const overlayGlasses = pickOverlay(base, "overlayGlasses", fallback.overlayGlasses);
  const overlayHeld = pickOverlay(base, "overlayHeld", fallback.overlayHeld);
  const split = splitLegacyKit(kit);
  const kitHat = parseSlotPick(base.kitHat ?? fallback.kitHat, HAT_BUILTINS)
    ?? (split.hat !== "none" ? split.hat : undefined);
  const kitGlasses = parseSlotPick(base.kitGlasses ?? fallback.kitGlasses, GLASSES_BUILTINS)
    ?? (split.glasses !== "none" ? split.glasses : undefined);
  const kitHeld = parseSlotPick(base.kitHeld ?? fallback.kitHeld, HELD_BUILTINS);
  return {
    shape,
    color,
    ...(kit ? { kit } : {}),
    ...(kitHat && kitHat !== "none" ? { kitHat } : {}),
    ...(kitGlasses && kitGlasses !== "none" ? { kitGlasses } : {}),
    ...(kitHeld && kitHeld !== "none" ? { kitHeld } : {}),
    ...(overlayHat ? { overlayHat, face: overlayHat } : {}),
    ...(overlayGlasses ? { overlayGlasses } : {}),
    ...(overlayHeld ? { overlayHeld } : {}),
  };
}

export function appearanceLookWire(
  look: MemberAppearance,
  stickers: readonly PresenceSticker[] = [],
): {
  readonly shape: string;
  readonly color: string;
  readonly kit?: string;
  readonly kitHat?: string;
  readonly kitGlasses?: string;
  readonly kitHeld?: string;
  readonly overlayHat?: string;
  readonly overlayGlasses?: string;
  readonly overlayHeld?: string;
} {
  const split = splitLegacyKit(look.kit);
  const kitHat = look.kitHat ?? split.hat;
  const kitGlasses = look.kitGlasses ?? split.glasses;
  const kitHeld = look.kitHeld ?? "none";
  const hatOverlay = resolveStickerOverlay(kitHat, stickers)
    ?? (stickerIdFromPick(kitHat) ? undefined : look.overlayHat ?? look.face);
  const glassesOverlay = resolveStickerOverlay(kitGlasses, stickers)
    ?? (stickerIdFromPick(kitGlasses) ? undefined : look.overlayGlasses);
  const heldOverlay = resolveStickerOverlay(kitHeld, stickers)
    ?? (stickerIdFromPick(kitHeld) ? undefined : look.overlayHeld);
  const engineHat = resolveEnginePick(kitHat, HAT_BUILTINS);
  const engineGlasses = resolveEnginePick(kitGlasses, GLASSES_BUILTINS);
  const engineHeld = resolveEnginePick(kitHeld, HELD_BUILTINS);
  const kit = engineHat !== "none"
    ? engineHat
    : engineGlasses !== "none"
      ? engineGlasses
      : look.kit;
  return {
    shape: look.shape,
    color: look.color,
    ...(kit ? { kit } : {}),
    ...(engineHat !== "none" ? { kitHat: engineHat } : {}),
    ...(engineGlasses !== "none" ? { kitGlasses: engineGlasses } : {}),
    ...(engineHeld !== "none" ? { kitHeld: engineHeld } : {}),
    ...(hatOverlay ? { overlayHat: hatOverlay } : {}),
    ...(glassesOverlay ? { overlayGlasses: glassesOverlay } : {}),
    ...(heldOverlay ? { overlayHeld: heldOverlay } : {}),
  };
}

export function parseMemberToolPolicy(raw: unknown): MemberToolPolicy | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const mode = o.mode === "allow" || o.mode === "deny" ? o.mode : undefined;
  if (!mode) return undefined;
  const names = Array.isArray(o.names)
    ? o.names.flatMap((n) => {
        const name = typeof n === "string" ? n.trim().toLowerCase() : "";
        return name && TOOL_NAME_RE.test(name) ? [name] : [];
      }).slice(0, 48)
    : [];
  if (names.length === 0) return undefined;
  return { mode, names };
}

export function parseMemberInject(raw: unknown, fallback: MemberInject): MemberInject {
  return raw === "subagent" || raw === "minimal" ? raw : fallback;
}

function briefOf(name: string, playbook: string, explicit?: string): string {
  const from = explicit?.trim() || playbook.split(/\n/)[0] || name;
  return clip(from, MEMBER_BRIEF_MAX);
}

/** Deny-only: a 干员 may weaken the parent preset, never add tools. */
export function applyRosterToolPolicy(
  tools: {
    list(): readonly { readonly name: string }[];
    unregister(name: string): boolean;
  },
  role: AgentTeamSpawnRole | undefined,
  policy?: MemberToolPolicy,
): void {
  const denied = new Set(
    roleDeniedTools(role).map((name) => name.toLowerCase()),
  );
  if (policy?.mode === "deny") {
    for (const name of policy.names) denied.add(name.toLowerCase());
  }
  if (policy?.mode === "allow") {
    const keep = new Set(policy.names.map((name) => name.toLowerCase()));
    for (const row of tools.list()) {
      const key = row.name.toLowerCase();
      if (!keep.has(key) || denied.has(key)) {
        tools.unregister(row.name);
      }
    }
    return;
  }
  for (const row of tools.list()) {
    if (denied.has(row.name.toLowerCase())) tools.unregister(row.name);
  }
}

export function rosterPublicFields(row: ListedRosterMember) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    scope: row.scope,
    brief: row.brief,
    inject: row.inject,
    seed: row.seed === true,
    catalog: row.catalog === true,
    appearance: row.appearance,
    ...(row.tools ? { tools: row.tools } : {}),
  };
}

export function formatRosterCatalog(
  members: readonly ListedRosterMember[],
): string {
  if (members.length === 0) return "(no Agent Team members yet)";
  return members
    .map((row) => {
      const pub = rosterPublicFields(row);
      const tools =
        pub.tools?.mode === "allow"
          ? ` tools=${pub.tools.names.join(",")}`
          : pub.tools?.mode === "deny"
            ? ` deny=${pub.tools.names.join(",")}`
            : "";
      return `- ${pub.id} [${pub.scope}] ${pub.name} · ${pub.role} · inject=${pub.inject} · ${pub.brief}${tools}${pub.catalog ? " · catalog" : ""}`;
    })
    .join("\n")
    .slice(0, 2_400);
}

export function mergeGlobalSeedMembers(
  existing: readonly AgentRosterMember[],
  now = Date.now(),
): { readonly members: AgentRosterMember[]; readonly changed: boolean } {
  const catalog = seedGlobalRosterMembers(now);
  const leftover = new Map(existing.map((row) => [row.id, row]));
  const members: AgentRosterMember[] = [];
  for (const seed of catalog) {
    leftover.delete(seed.id);
    members.push(seed);
  }
  for (const rest of leftover.values()) {
    if (rest.seed === true) continue;
    members.push(rest);
  }
  return {
    members,
    changed: JSON.stringify(members) !== JSON.stringify(existing),
  };
}

export function seedGlobalRosterMembers(now = Date.now()): readonly AgentRosterMember[] {
  return [
    {
      id: "mem_seed_researcher",
      name: "调研员",
      role: "researcher",
      appearance: { shape: "blob", color: "mist" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      brief: "只读调研，引用路径与原文。",
      playbook:
        "You are the workspace researcher. Gather facts with read/search tools. " +
        "Cite paths and quotes. Do not make durable edits unless the task explicitly requires them.",
    },
    {
      id: "mem_seed_worker",
      name: "施工员",
      role: "worker",
      appearance: { shape: "wedge", color: "sage" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      brief: "按任务改代码，不扩范围。",
      playbook:
        "You are the workspace implementer. Execute the assigned task precisely. " +
        "Prefer concrete edits and evidence. Stay inside the given scope.",
    },
    {
      id: "mem_seed_reviewer",
      name: "审稿员",
      role: "reviewer",
      appearance: { shape: "gem", color: "lilac" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      brief: "只读审稿，先报缺陷。",
      playbook:
        "You are the workspace reviewer. Read-only review unless asked to patch. " +
        "Report defects first. Do not expand scope.",
    },
    {
      id: "mem_seed_lead",
      name: "调度员",
      role: "lead",
      appearance: { shape: "blob", color: "slate" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      brief: "拆任务、协调干员。",
      playbook:
        "You are the workspace lead. Break work into clear sub-tasks, coordinate teammates, " +
        "and keep a short status of blockers and next steps. " +
        "When a specialist fits, spawn with subagent member_id from the live catalog rather than restating tools or playbook.",
    },
    {
      id: "mem_seed_scout",
      name: "探网员",
      role: "researcher",
      appearance: { shape: "wedge", color: "peach" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      brief: "查网上公开事实，给出链接与日期。",
      playbook:
        "You are the web scout. Use web_search and web_fetch for public facts. " +
        "Cite URLs and dates. Do not edit the repo. Prefer primary sources over commentary.",
    },
    {
      id: "mem_seed_docs",
      name: "文书员",
      role: "worker",
      appearance: { shape: "squircle", color: "butter" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      brief: "写诚实说明书与发行说明，不编未做能力。",
      playbook:
        "You are the docs writer. Revise textbook docs in this repo. Follow docs/audiences.md. " +
        "Do not invent APIs. Match existing tone. Use standing skills when they apply; do not paste them.",
    },
    {
      id: "mem_seed_fixer",
      name: "排障员",
      role: "worker",
      appearance: { shape: "gem", color: "coral" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      brief: "复现故障、定位、修，并给出证据。",
      playbook:
        "You are the debugger. Reproduce, isolate, then fix. Show failing evidence before the change. Stay in the given scope.",
    },
    {
      id: "mem_seed_tester",
      name: "测员",
      role: "worker",
      appearance: { shape: "pill", color: "sage" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      brief: "跑相关测试，报告失败与最小复现。",
      playbook:
        "You are the tester. Run the relevant tests. Report failures with the command and output. Do not skip failing tests.",
    },
  ];
}

function parseMember(raw: unknown): AgentRosterMember | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !ID_RE.test(o.id)) return undefined;
  if (typeof o.name !== "string") return undefined;
  const name = clip(o.name, MEMBER_NAME_MAX);
  if (!name) return undefined;
  const playbook = typeof o.playbook === "string" ? clip(o.playbook, MEMBER_PLAYBOOK_MAX) : "";
  if (!playbook) return undefined;
  const role = isAgentTeamSpawnRole(o.role) ? o.role : "default";
  const updatedAt =
    typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
      ? o.updatedAt
      : 0;
  const appearance = parseMemberAppearance(o.appearance, {
    shape: "blob",
    color: "cream",
  });
  const tools = parseMemberToolPolicy(o.tools);
  const inject = parseMemberInject(o.inject, "minimal");
  const brief = briefOf(name, playbook, typeof o.brief === "string" ? o.brief : undefined);
  return {
    id: o.id,
    name,
    playbook,
    role,
    appearance,
    brief,
    inject,
    updatedAt,
    ...(tools ? { tools } : {}),
    ...(o.seed === true ? { seed: true as const } : {}),
  };
}

export class FaceAgentRosterStore {
  private readonly productHome: string | undefined;
  private readonly cache = new Map<string, PersistShape>();

  constructor(productHome?: string) {
    this.productHome = productHome;
  }

  private emptyOrSeed(workspaceId: string): PersistShape {
    if (workspaceId === GLOBAL_ROSTER_ID) {
      return { version: 1, members: [...seedGlobalRosterMembers()] };
    }
    return { version: 1, members: [] };
  }

  private load(workspaceId: string): PersistShape {
    const cached = this.cache.get(workspaceId);
    if (cached) return cached;
    const file = filePath(workspaceId, this.productHome);
    if (!existsSync(file)) {
      const doc = this.emptyOrSeed(workspaceId);
      this.cache.set(workspaceId, doc);
      this.save(workspaceId, doc);
      return doc;
    }
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
      const o = parsed && typeof parsed === "object" ? (parsed as PersistShape) : undefined;
      const members = Array.isArray(o?.members)
        ? o.members.flatMap((row) => {
            const member = parseMember(row);
            return member ? [member] : [];
          })
        : [];
      if (workspaceId === GLOBAL_ROSTER_ID) {
        const merged = mergeGlobalSeedMembers(members);
        const doc: PersistShape = { version: 1, members: merged.members };
        this.cache.set(workspaceId, doc);
        if (merged.changed) this.save(workspaceId, doc);
        return doc;
      }
      const kept = members.filter((row) => !isCatalogSeedMemberId(row.id));
      const doc: PersistShape = { version: 1, members: kept };
      this.cache.set(workspaceId, doc);
      if (kept.length !== members.length) this.save(workspaceId, doc);
      return doc;
    } catch {
      const doc = this.emptyOrSeed(workspaceId);
      this.cache.set(workspaceId, doc);
      return doc;
    }
  }

  private save(workspaceId: string, doc: PersistShape): void {
    this.cache.set(workspaceId, doc);
    const dir = rosterRoot(this.productHome);
    mkdirSync(dir, { recursive: true });
    tryWriteJsonSidecar(filePath(workspaceId, this.productHome), doc);
  }

  list(workspaceId: string): readonly AgentRosterMember[] {
    return this.load(workspaceId).members;
  }

  /** Global members first, then workspace; same id → workspace wins. */
  listVisible(workspaceId: string): readonly ListedRosterMember[] {
    const byId = new Map<string, ListedRosterMember>();
    for (const row of this.list(GLOBAL_ROSTER_ID)) {
      byId.set(row.id, listedMember(row, "global"));
    }
    if (workspaceId !== GLOBAL_ROSTER_ID) {
      for (const row of this.list(workspaceId)) {
        byId.set(row.id, listedMember(row, "workspace"));
      }
    }
    return [...byId.values()];
  }

  get(workspaceId: string, memberId: string): ListedRosterMember | undefined {
    const local = this.list(workspaceId).find((row) => row.id === memberId);
    if (local) {
      return listedMember(
        local,
        workspaceId === GLOBAL_ROSTER_ID ? "global" : "workspace",
      );
    }
    const global = this.list(GLOBAL_ROSTER_ID).find((row) => row.id === memberId);
    return global ? listedMember(global, "global") : undefined;
  }

  upsert(
    workspaceId: string,
    input: {
      readonly id?: string;
      readonly name: string;
      readonly playbook: string;
      readonly role?: AgentTeamSpawnRole;
      readonly appearance?: Partial<MemberAppearance> | null;
      readonly brief?: string;
      readonly inject?: MemberInject;
      readonly tools?: MemberToolPolicy | null;
    },
  ): AgentRosterMember | undefined {
    const name = clip(input.name, MEMBER_NAME_MAX);
    const playbook = clip(input.playbook, MEMBER_PLAYBOOK_MAX);
    if (!name || !playbook) return undefined;
    const role = input.role ?? "default";
    const doc = this.load(workspaceId);
    const now = Date.now();
    const rawId = input.id?.trim() ?? "";
    const id = normalizeMemberId(rawId);
    const fallback: MemberAppearance = { shape: "blob", color: "cream" };
    const inject = parseMemberInject(input.inject, "minimal");
    const tools =
      input.tools === null ? undefined : parseMemberToolPolicy(input.tools);
    if (rawId && !id) return undefined; // illegal id — callers ask memberIdProblem() first
    if (id && isCatalogSeedMemberId(id)) return undefined;
    if (id) {
      const index = doc.members.findIndex((row) => row.id === id);
      const prev = index === -1 ? undefined : doc.members[index];
      const appearance = parseMemberAppearance(
        {
          ...(prev?.appearance ?? fallback),
          ...(input.appearance ?? {}),
        },
        prev?.appearance ?? fallback,
      );
      const nextTools =
        input.tools === undefined
          ? prev?.tools
          : tools;
      const next: AgentRosterMember = {
        id,
        name,
        playbook,
        role,
        appearance,
        brief: briefOf(name, playbook, input.brief ?? prev?.brief),
        inject: input.inject !== undefined ? inject : (prev?.inject ?? "minimal"),
        updatedAt: now,
        ...(nextTools ? { tools: nextTools } : {}),
      };
      const members =
        index === -1
          ? [...doc.members, next]
          : doc.members.map((row, i) => (i === index ? next : row));
      this.save(workspaceId, { version: 1, members });
      return next;
    }
    const minted: AgentRosterMember = {
      id: mintId(),
      name,
      playbook,
      role,
      appearance: parseMemberAppearance(input.appearance ?? fallback, fallback),
      brief: briefOf(name, playbook, input.brief),
      inject,
      updatedAt: now,
      ...(tools ? { tools } : {}),
    };
    this.save(workspaceId, { version: 1, members: [...doc.members, minted] });
    return minted;
  }

  /**
   * Write into global.json or the canvas file. Promoting to global drops a
   * same-id workspace overlay so the global record is visible again.
   */
  upsertAtScope(
    canvasWorkspaceId: string,
    scope: RosterScope,
    input: Parameters<FaceAgentRosterStore["upsert"]>[1],
  ): AgentRosterMember | undefined {
    const target = scope === "global" ? GLOBAL_ROSTER_ID : canvasWorkspaceId;
    const member = this.upsert(target, input);
    if (
      member &&
      scope === "global" &&
      canvasWorkspaceId !== GLOBAL_ROSTER_ID
    ) {
      this.remove(canvasWorkspaceId, member.id);
    }
    return member;
  }

  remove(workspaceId: string, memberId: string): boolean {
    if (isCatalogSeedMemberId(memberId)) return false;
    const doc = this.load(workspaceId);
    const members = doc.members.filter((row) => row.id !== memberId);
    if (members.length === doc.members.length) return false;
    this.save(workspaceId, { version: 1, members });
    return true;
  }
}
