/**
 * Session-scoped inject documents for skill.list / skill.read — the same
 * turn-start fragments Host actually injects (authority · capability · posture ·
 * boss · seat · collab · memory card), so the Inject catalog stays honest.
 */

import {
  createInstructionAuthorityRegistry,
} from "@xrkseek/workspace";
import { createLayeredCuratedMemoryStore } from "@xrkseek/exec-memory";
import type { FaceRuntime } from "./context.js";
import { sessionSeatMemberId } from "./agent-home-boundary.js";
import {
  formatBossStatusInjectBody,
  isBossStatusAudienceSession,
  readBossStatusFields,
} from "./boss-status-broadcast.js";
import { formatCollabBoard } from "./collab-board.js";
import { formatSeatIdentity } from "./seat-identity.js";
import { formatSessionCapability } from "./session-capability.js";
import { formatSessionLanes } from "./session-lanes.js";
import { formatSessionPosture } from "./session-posture.js";
import { readSeatTitles, readUiLocalePreference } from "./seat-titles.js";
import type {
  InjectDocumentEntry,
  InjectDocumentKind,
} from "./skill-documents.js";

/** Logical path for the turn-start `<instruction_authority>` fragment. */
export const SESSION_AUTHORITY_PATH = "session://instruction-authority";

/** Logical path for the turn-start `<session_capability>` fragment. */
export const SESSION_CAPABILITY_PATH = "session://capability";

/** Logical path for the turn-start `<session_posture>` fragment. */
export const SESSION_POSTURE_PATH = "session://posture";

/** Logical path for the turn-start `<boss_status>` fragment. */
export const SESSION_BOSS_STATUS_PATH = "session://boss-status";

/** Logical path for the turn-start `<seat_identity>` fragment. */
export const SESSION_SEAT_IDENTITY_PATH = "session://seat-identity";

/** Logical path for the turn-start collab board fragment. */
export const SESSION_COLLAB_PATH = "session://collab-board";

/** Logical path for the turn-start `<session_lanes>` fragment. */
export const SESSION_LANES_PATH = "session://lanes";

/**
 * Logical path for curated-memory discovery (zone census + pointer — full rows
 * via the `memory` tool / system freeze / live fragment; never dump bodies here).
 */
export const SESSION_MEMORY_PATH = "session://memory";

const instructionAuthorityRegistry = createInstructionAuthorityRegistry();

function wrapAuthority(body: string): string {
  return `<instruction_authority>\n${body}\n</instruction_authority>`;
}

function wrapCapability(body: string): string {
  return `<session_capability>\n${body}\n</session_capability>`;
}

function wrapPosture(body: string): string {
  return `<session_posture>\n${body}\n</session_posture>`;
}

function wrapBoss(body: string): string {
  return `<boss_status>\n${body}\n</boss_status>`;
}

function wrapSeat(body: string): string {
  return `<seat_identity>\n${body}\n</seat_identity>`;
}

function wrapLanes(body: string): string {
  return `<session_lanes>\n${body}\n</session_lanes>`;
}

function entry(
  path: string,
  kind: InjectDocumentKind,
  content: string,
): InjectDocumentEntry {
  return {
    path,
    layer: "session",
    kind,
    bytes: content.length,
  };
}

function formatBossStatusDocument(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  if (!isBossStatusAudienceSession(runtime, sessionId)) return "";
  const presenceUser = runtime.settingsNamespaces.view("ui-presence")
    .value as Record<string, unknown>;
  const localeUser = runtime.settingsNamespaces.view("locale")
    .value as Record<string, unknown>;
  const fields = readBossStatusFields(presenceUser);
  const titles = readSeatTitles(
    presenceUser,
    readUiLocalePreference(localeUser),
  );
  return formatBossStatusInjectBody(fields, titles);
}

/**
 * List live session inject fragments for this session.
 * Order matches Host turn-start priority (high → low).
 */
export function listSessionInjectDocuments(
  runtime: FaceRuntime,
  sessionId: string,
): readonly InjectDocumentEntry[] {
  const out: InjectDocumentEntry[] = [];
  const authority = instructionAuthorityRegistry.formatCard();
  if (authority.trim()) {
    out.push(
      entry(
        SESSION_AUTHORITY_PATH,
        "instruction-authority",
        wrapAuthority(authority),
      ),
    );
  }
  const capability = formatSessionCapability(runtime, sessionId);
  if (capability) {
    out.push(
      entry(
        SESSION_CAPABILITY_PATH,
        "session-capability",
        wrapCapability(capability),
      ),
    );
  }
  const posture = formatSessionPosture(runtime, sessionId);
  if (posture) {
    out.push(
      entry(SESSION_POSTURE_PATH, "session-posture", wrapPosture(posture)),
    );
  }
  // Priority order: posture (8.5) → lanes (8.25) → boss (8.2) → seat → collab (8).
  const lanes = formatSessionLanes(runtime, sessionId);
  if (lanes) {
    out.push(entry(SESSION_LANES_PATH, "session-lanes", wrapLanes(lanes)));
  }
  const boss = formatBossStatusDocument(runtime, sessionId);
  if (boss) {
    out.push(
      entry(SESSION_BOSS_STATUS_PATH, "boss-status", wrapBoss(boss)),
    );
  }
  const seat = formatSeatIdentity(runtime, sessionId);
  if (seat) {
    out.push(
      entry(SESSION_SEAT_IDENTITY_PATH, "seat-identity", wrapSeat(seat)),
    );
  }
  const board = formatCollabBoard(runtime, sessionId);
  if (board) {
    out.push(
      entry(
        SESSION_COLLAB_PATH,
        "collab-board",
        `<external_collab_board>${board}</external_collab_board>`,
      ),
    );
  }
  const memory = formatSessionMemoryDocument(runtime, sessionId);
  if (memory) {
    out.push(entry(SESSION_MEMORY_PATH, "session-memory", memory));
  }
  return out;
}

/** How many entry titles to peek per zone/target on the inject census card. */
const MEMORY_TITLE_PEEK = 12;

function formatEntryTitles(ids: readonly string[]): string {
  if (ids.length === 0) return "(empty)";
  const shown = ids.slice(0, MEMORY_TITLE_PEEK);
  const more = ids.length - shown.length;
  return shown.join(", ") + (more > 0 ? ` (+${more})` : "");
}

/**
 * Inject-catalog card: which zones this seat opens, entry counts + titles,
 * default write scope. Bodies stay on the system freeze + live
 * `<external_curated_memory>` fragment — never dump MEMORY.md here.
 */
function formatSessionMemoryDocument(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  const workspaceId = runtime.workspaces.workspaceIdOf(sessionId);
  const treeRoot =
    runtime.subagents.humanFacingSessionId(sessionId) ?? sessionId;
  const agentId = sessionSeatMemberId(runtime, sessionId);
  const presenceUser = runtime.settingsNamespaces.view("ui-presence")
    .value as Record<string, unknown>;
  const localeUser = runtime.settingsNamespaces.view("locale")
    .value as Record<string, unknown>;
  const titles = readSeatTitles(
    presenceUser,
    readUiLocalePreference(localeUser),
  );
  const layered = createLayeredCuratedMemoryStore({
    sessionId: treeRoot,
    ...(workspaceId ? { workspaceId } : {}),
    ...(agentId ? { agentId } : {}),
    defaultScope: agentId ? "agent" : "session",
    agentLabel: titles.agent,
  });
  const lines = [
    "<session_memory>",
    "Channels:",
    "  · system freeze at session start (standing MEMORY.md / USER.md snapshot)",
    "  · live `<external_curated_memory>` when disk moves past that freeze",
    "  · `memory` tool for list / mutate (default write zone below)",
    `This seat: treeRoot=${treeRoot}` +
      (workspaceId ? ` · workspace=${workspaceId}` : "") +
      (agentId ? ` · agent=${agentId}` : " · agent=(none)") +
      ` · defaultWrite=${layered.defaultScope}.`,
    "Zone census (titles below; bodies stay on freeze / live fragment / memory tool):",
  ];
  for (const layer of layered.layers) {
    const memoryEntries = layer.store.listEntries("memory");
    const userEntries = layer.store.listEntries("user");
    const memIds = Array.isArray(memoryEntries) ? memoryEntries : [];
    const userIds = Array.isArray(userEntries) ? userEntries : [];
    lines.push(
      `  zone ${layer.scope}: MEMORY ${memIds.length} · USER ${userIds.length}` +
        (layer.scope === layered.defaultScope ? " ← default write" : ""),
    );
    lines.push(`    MEMORY titles: ${formatEntryTitles(memIds)}`);
    lines.push(`    USER titles: ${formatEntryTitles(userIds)}`);
  }
  const snap = runtime.curatedMemoryConsolidate;
  if (snap && snap.sessionId === sessionId) {
    lines.push(
      `Last consolidate: phase1 +${snap.phase1Written}, phase2=${snap.phase2}` +
        (snap.phase2Written ? ` +${snap.phase2Written}` : "") +
        (snap.skipped ? ` (skipped: ${snap.skipped})` : "") +
        (snap.providerKind ? ` · provider=${snap.providerKind}` : "") +
        ".",
    );
  } else {
    lines.push("Last consolidate: (none for this session yet).");
  }
  lines.push(
    "Full bodies: call `memory` with action=list (or read the freeze / live fragment). This card lists titles, not a dump.",
  );
  lines.push("</session_memory>");
  return lines.join("\n");
}

/**
 * Read one session inject document by logical path.
 * @returns undefined when path is unknown or the fragment is empty for this session.
 */
export function readSessionInjectDocument(
  runtime: FaceRuntime,
  sessionId: string,
  logicalPath: string,
): { readonly path: string; readonly content: string } | undefined {
  if (logicalPath === SESSION_AUTHORITY_PATH) {
    const body = instructionAuthorityRegistry.formatCard();
    if (!body.trim()) return undefined;
    return { path: SESSION_AUTHORITY_PATH, content: wrapAuthority(body) };
  }
  if (logicalPath === SESSION_CAPABILITY_PATH) {
    const body = formatSessionCapability(runtime, sessionId);
    if (!body) return undefined;
    return { path: SESSION_CAPABILITY_PATH, content: wrapCapability(body) };
  }
  if (logicalPath === SESSION_POSTURE_PATH) {
    const body = formatSessionPosture(runtime, sessionId);
    if (!body) return undefined;
    return { path: SESSION_POSTURE_PATH, content: wrapPosture(body) };
  }
  if (logicalPath === SESSION_BOSS_STATUS_PATH) {
    const body = formatBossStatusDocument(runtime, sessionId);
    if (!body) return undefined;
    return { path: SESSION_BOSS_STATUS_PATH, content: wrapBoss(body) };
  }
  if (logicalPath === SESSION_SEAT_IDENTITY_PATH) {
    const body = formatSeatIdentity(runtime, sessionId);
    if (!body) return undefined;
    return { path: SESSION_SEAT_IDENTITY_PATH, content: wrapSeat(body) };
  }
  if (logicalPath === SESSION_COLLAB_PATH) {
    const body = formatCollabBoard(runtime, sessionId);
    if (!body) return undefined;
    return {
      path: SESSION_COLLAB_PATH,
      content: `<external_collab_board>${body}</external_collab_board>`,
    };
  }
  if (logicalPath === SESSION_LANES_PATH) {
    const body = formatSessionLanes(runtime, sessionId);
    if (!body) return undefined;
    return { path: SESSION_LANES_PATH, content: wrapLanes(body) };
  }
  if (logicalPath === SESSION_MEMORY_PATH) {
    const body = formatSessionMemoryDocument(runtime, sessionId);
    if (!body) return undefined;
    return { path: SESSION_MEMORY_PATH, content: body };
  }
  return undefined;
}
