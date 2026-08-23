/**
 * File-backed mnemon documents under ~/.xrk/mnemon/documents.
 */
import { randomUUID } from "node:crypto";
import { createXrkDocStore } from "./underlying/doc-store.js";

export interface MnemonDocument {
  id: string;
  title: string;
  body: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface MnemonDocStore {
  documents: MnemonDocument[];
}

const MNEMON_DOCS = createXrkDocStore<MnemonDocStore>(
  ["mnemon", "documents", "index.json"],
  { documents: [] },
);

export function listMnemonDocuments(xrkHome?: string): MnemonDocument[] {
  return MNEMON_DOCS.read(xrkHome).data.documents.filter((d) => !d.archived);
}

export function countMnemonDocuments(xrkHome?: string): {
  active: number;
  archived: number;
  bytes: number;
} {
  const docs = MNEMON_DOCS.read(xrkHome).data.documents;
  let bytes = 0;
  let active = 0;
  let archived = 0;
  for (const d of docs) {
    bytes += Buffer.byteLength(d.body, "utf8") + Buffer.byteLength(d.title, "utf8");
    if (d.archived) archived += 1;
    else active += 1;
  }
  return { active, archived, bytes };
}

export function upsertMnemonDocument(
  xrkHome: string | undefined,
  payload: Record<string, unknown>,
): MnemonDocument {
  const now = new Date().toISOString();
  const id =
    typeof payload.id === "string" && payload.id.trim()
      ? payload.id.trim()
      : randomUUID();
  let row!: MnemonDocument;
  MNEMON_DOCS.patch(xrkHome, (store) => {
    const idx = store.documents.findIndex((d) => d.id === id);
    row = {
      id,
      title: typeof payload.title === "string" ? payload.title : "",
      body: typeof payload.body === "string" ? payload.body : "",
      archived: payload.archived === true,
      createdAt: idx >= 0 ? store.documents[idx]!.createdAt : now,
      updatedAt: now,
    };
    const documents = [...store.documents];
    if (idx >= 0) documents[idx] = row;
    else documents.push(row);
    return { documents };
  });
  return row;
}

export function getMnemonDocument(
  xrkHome: string | undefined,
  id: string,
): MnemonDocument | null {
  return (
    MNEMON_DOCS.read(xrkHome).data.documents.find((d) => d.id === id) ?? null
  );
}
