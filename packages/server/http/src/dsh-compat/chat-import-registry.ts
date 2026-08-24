/**
 * dsh-chat-import import registry — tracks discovered → imported fingerprints.
 */
import { createXrkDocStore } from "./underlying/doc-store.js";
import { importFingerprint } from "./chat-import-discovery.js";

export interface ImportRegistryRow {
  format: string;
  sourcePath: string;
  sessionId: string;
  status: "imported" | "already-imported" | "failed" | "skipped";
  importedAt: string;
  xrkSessionId?: string;
  note?: string;
}

interface ImportRegistryDoc {
  imports: Record<string, ImportRegistryRow>;
}

const REGISTRY_STORE = createXrkDocStore<ImportRegistryDoc>(
  ["chat-import", "imports.json"],
  { imports: {} },
);

export function loadImportRegistry(xrkHome?: string): ImportRegistryDoc {
  return REGISTRY_STORE.read(xrkHome).data;
}

export function upsertImportRow(
  xrkHome: string | undefined,
  row: Omit<ImportRegistryRow, "importedAt"> & { importedAt?: string },
): ImportRegistryRow {
  const key = importFingerprint({
    format: row.format,
    sessionId: row.sessionId,
    sourcePath: row.sourcePath,
  });
  const saved = REGISTRY_STORE.patch(xrkHome, (current) => ({
    imports: {
      ...current.imports,
      [key]: {
        ...row,
        importedAt: row.importedAt ?? new Date().toISOString(),
      },
    },
  }));
  return saved.data.imports[key]!;
}

export function registryStatusMap(
  doc: ImportRegistryDoc,
): Record<string, { status?: string }> {
  const out: Record<string, { status?: string }> = {};
  for (const [key, row] of Object.entries(doc.imports)) {
    out[key] = { status: row.status };
  }
  return out;
}
