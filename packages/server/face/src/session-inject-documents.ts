/**
 * Session-scoped inject documents for skill.list / skill.read — the same
 * turn-start fragments Host actually injects (capability · posture · collab
 * board), so the Inject catalog stays honest about badge / permission / board.
 */

import type { FaceRuntime } from "./context.js";
import { formatCollabBoard } from "./collab-board.js";
import { formatSessionCapability } from "./session-capability.js";
import { formatSessionPosture } from "./session-posture.js";
import type {
  InjectDocumentEntry,
  InjectDocumentKind,
} from "./skill-documents.js";

/** Logical path for the turn-start `<session_capability>` fragment. */
export const SESSION_CAPABILITY_PATH = "session://capability";

/** Logical path for the turn-start `<session_posture>` fragment. */
export const SESSION_POSTURE_PATH = "session://posture";

/** Logical path for the turn-start collab board fragment. */
export const SESSION_COLLAB_PATH = "session://collab-board";

function wrapCapability(body: string): string {
  return `<session_capability>\n${body}\n</session_capability>`;
}

function wrapPosture(body: string): string {
  return `<session_posture>\n${body}\n</session_posture>`;
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

/**
 * List live session inject fragments for this session (empty for children /
 * missing sessions). Order: capability → posture → collab board.
 */
export function listSessionInjectDocuments(
  runtime: FaceRuntime,
  sessionId: string,
): readonly InjectDocumentEntry[] {
  const out: InjectDocumentEntry[] = [];
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
