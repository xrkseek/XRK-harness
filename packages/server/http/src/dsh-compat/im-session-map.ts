/**
 * Persist chatKey → Face sessionId under product home (`im-sessions.json`).
 */
import { randomUUID } from "node:crypto";
import { createXrkDocStore } from "./underlying/doc-store.js";

export interface ImSessionMapEntry {
  readonly chatKey: string;
  readonly sessionId: string;
  readonly channel: string;
  readonly updatedAt: string;
}

interface ImSessionMapDoc {
  entries: ImSessionMapEntry[];
}

const STORE = createXrkDocStore<ImSessionMapDoc>(
  ["im-sessions.json"],
  { entries: [] },
);

function readEntries(xrkHome: string | undefined): ImSessionMapEntry[] {
  return STORE.read(xrkHome).data.entries ?? [];
}

function writeEntries(
  xrkHome: string | undefined,
  entries: ImSessionMapEntry[],
): void {
  STORE.write(xrkHome, { entries: entries.slice(0, 2048) });
}

export function lookupImSession(
  xrkHome: string | undefined,
  chatKey: string,
): ImSessionMapEntry | undefined {
  return readEntries(xrkHome).find((row) => row.chatKey === chatKey);
}

export function lookupImSessionBySessionId(
  xrkHome: string | undefined,
  sessionId: string,
): ImSessionMapEntry | undefined {
  return readEntries(xrkHome).find((row) => row.sessionId === sessionId);
}

export function bindImSession(
  xrkHome: string | undefined,
  input: {
    readonly chatKey: string;
    readonly channel: string;
    readonly sessionId?: string;
  },
): ImSessionMapEntry {
  const sessionId = input.sessionId?.trim() || `im-${randomUUID()}`;
  const now = new Date().toISOString();
  const next: ImSessionMapEntry = {
    chatKey: input.chatKey,
    sessionId,
    channel: input.channel,
    updatedAt: now,
  };
  const rest = readEntries(xrkHome).filter((row) => row.chatKey !== input.chatKey);
  writeEntries(xrkHome, [next, ...rest]);
  return next;
}

export function listImSessionBindings(
  xrkHome: string | undefined,
): readonly ImSessionMapEntry[] {
  return readEntries(xrkHome);
}

/** True when any Face session is bound (sidebar can show empty-less ws_im). */
export function hasImSessionBindings(xrkHome: string | undefined): boolean {
  return readEntries(xrkHome).length > 0;
}
