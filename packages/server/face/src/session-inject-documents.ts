/**
 * Session-scoped inject documents for skill.list / skill.read — the same
 * turn-start fragments Host actually injects (authority · capability · posture ·
 * boss · seat · collab), so the Inject catalog stays honest.
 */

import {
  createInstructionAuthorityRegistry,
} from "@xrkseek/workspace";
import type { FaceRuntime } from "./context.js";
import {
  formatBossStatusInjectBody,
  isBossStatusAudienceSession,
  readBossStatusFields,
} from "./boss-status-broadcast.js";
import { formatCollabBoard } from "./collab-board.js";
import { formatSeatIdentity } from "./seat-identity.js";
import { formatSessionCapability } from "./session-capability.js";
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
  return out;
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
  return undefined;
}
