/**
 * File-backed turn-rewind checkpoint index.
 */
import { createXrkDocStore } from "./underlying/doc-store.js";

export interface RewindChange {
  path: string;
  kind: string;
}

export interface RewindMarker {
  sessionId: string;
  messageSeq: number;
  turn: number;
  turnStartSeq: number;
  checkpointId: string;
  checkpointBranch: string;
  currentBranch: string;
  checkpointHead?: string;
  currentHead?: string;
  changes: RewindChange[];
  planId?: string;
  confirmation?: string;
}

interface RewindIndex {
  markers: RewindMarker[];
}

const INDEX_STORE = createXrkDocStore<RewindIndex>(
  ["turn-rewind", "index.json"],
  { markers: [] },
);

export function loadRewindIndex(xrkHome?: string): RewindIndex {
  return INDEX_STORE.read(xrkHome).data;
}

function saveIndex(xrkHome: string | undefined, index: RewindIndex): number {
  return INDEX_STORE.write(xrkHome, index).revision;
}

export function findRewindMarker(
  xrkHome: string | undefined,
  sessionId: string,
  messageSeq: number,
): RewindMarker | undefined {
  return loadRewindIndex(xrkHome).markers.find(
    (m) => m.sessionId === sessionId && m.messageSeq === messageSeq,
  );
}

export function upsertRewindMarker(
  xrkHome: string | undefined,
  marker: RewindMarker,
): RewindMarker {
  const index = loadRewindIndex(xrkHome);
  const rest = index.markers.filter(
    (m) =>
      !(
        m.sessionId === marker.sessionId && m.messageSeq === marker.messageSeq
      ),
  );
  rest.push(marker);
  saveIndex(xrkHome, { markers: rest });
  return marker;
}
