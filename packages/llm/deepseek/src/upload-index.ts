/**
 * Durable DeepSeek attachment→file-id index (`~/.xrk/llm-deepseek/files-v3.json`).
 * Ported from DSH `dsh-v0.1.1-rc.2` with XRK home paths.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  deepSeekFileId,
  deepSeekFileScopeDigest,
  type DeepSeekFileId,
  type DeepSeekFileScope,
} from "./file-id.js";

export type ImageVariantId = string & { readonly __brand: "ImageVariantId" };

export function imageVariantId(digest: string): ImageVariantId {
  return digest as ImageVariantId;
}

export interface DeepSeekUploadRecord {
  readonly scope: DeepSeekFileScope;
  readonly attachmentId: string;
  readonly variantId: ImageVariantId;
  readonly fileId: DeepSeekFileId;
  readonly bytes: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

interface StoredIndex {
  readonly formatVersion: 3;
  readonly records: DeepSeekUploadRecord[];
}

export function deepSeekFileScope(
  baseURL: string,
  apiKey: string,
): DeepSeekFileScope {
  const digest = createHash("sha256")
    .update(baseURL.replace(/\/+$/u, ""))
    .update("\0")
    .update(apiKey)
    .digest("hex");
  return deepSeekFileScopeDigest(digest);
}

function resolveIndexPath(custom?: string): string {
  if (custom) return custom;
  const home = process.env.XRK_HOME?.trim() || path.join(homedir(), ".xrk");
  return path.join(home, "llm-deepseek", "files-v3.json");
}

function absent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await writeFile(tmp, text, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(tmp, file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "EPERM") {
      await unlink(file).catch(() => undefined);
      await rename(tmp, file);
      return;
    }
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

function parseRecord(value: unknown): DeepSeekUploadRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("llm-deepseek: upload index contains a non-object record");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.scope !== "string" ||
    !/^[0-9a-f]{64}$/u.test(record.scope) ||
    typeof record.attachmentId !== "string" ||
    typeof record.variantId !== "string" ||
    typeof record.fileId !== "string" ||
    record.fileId.length === 0 ||
    !Number.isSafeInteger(record.bytes) ||
    (record.bytes as number) < 0 ||
    !Number.isSafeInteger(record.createdAt) ||
    (record.createdAt as number) < 0 ||
    !Number.isSafeInteger(record.expiresAt) ||
    (record.expiresAt as number) < 0
  ) {
    throw new Error("llm-deepseek: upload index contains an invalid record");
  }
  return {
    scope: deepSeekFileScopeDigest(record.scope),
    attachmentId: record.attachmentId,
    variantId: imageVariantId(record.variantId),
    fileId: deepSeekFileId(record.fileId),
    bytes: record.bytes as number,
    createdAt: record.createdAt as number,
    expiresAt: record.expiresAt as number,
  };
}

function parseIndex(text: string): StoredIndex {
  const value = JSON.parse(text) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("llm-deepseek: upload index is not an object");
  }
  const index = value as { formatVersion?: unknown; records?: unknown };
  if (index.formatVersion !== 3 || !Array.isArray(index.records)) {
    throw new Error("llm-deepseek: unsupported upload index format");
  }
  return { formatVersion: 3, records: index.records.map(parseRecord) };
}

function reusable(
  record: DeepSeekUploadRecord,
  now: number,
  refreshMarginMs: number,
): boolean {
  return record.expiresAt - now > refreshMarginMs;
}

export class DeepSeekUploadIndex {
  readonly path: string;

  constructor(indexPath?: string) {
    this.path = resolveIndexPath(indexPath);
  }

  private async load(): Promise<StoredIndex> {
    try {
      return parseIndex(await readFile(this.path, "utf8"));
    } catch (error: unknown) {
      if (absent(error)) return { formatVersion: 3, records: [] };
      if (error instanceof SyntaxError) {
        return { formatVersion: 3, records: [] };
      }
      throw error;
    }
  }

  private async save(index: StoredIndex): Promise<void> {
    await writeAtomic(this.path, `${JSON.stringify(index, undefined, 2)}\n`);
  }

  async get(
    scope: DeepSeekFileScope,
    variantId: ImageVariantId,
    now: number,
    refreshMarginMs: number,
  ): Promise<DeepSeekUploadRecord | undefined> {
    const record = (await this.load()).records.find(
      (candidate) =>
        candidate.scope === scope && candidate.variantId === variantId,
    );
    return record !== undefined && reusable(record, now, refreshMarginMs)
      ? record
      : undefined;
  }

  async commit(
    candidate: DeepSeekUploadRecord,
    now: number,
    refreshMarginMs: number,
  ): Promise<{ record: DeepSeekUploadRecord; accepted: boolean }> {
    const index = await this.load();
    const existing = index.records.find(
      (record) =>
        record.scope === candidate.scope &&
        record.variantId === candidate.variantId &&
        reusable(record, now, refreshMarginMs),
    );
    if (existing !== undefined) return { record: existing, accepted: false };
    const records = index.records.filter(
      (record) =>
        reusable(record, now, refreshMarginMs) &&
        !(
          record.scope === candidate.scope &&
          record.variantId === candidate.variantId
        ),
    );
    records.push(candidate);
    await this.save({ formatVersion: 3, records });
    return { record: candidate, accepted: true };
  }

  async remove(
    scope: DeepSeekFileScope,
    variantId: ImageVariantId,
    fileId: DeepSeekFileId,
  ): Promise<void> {
    const index = await this.load();
    const records = index.records.filter(
      (record) =>
        !(
          record.scope === scope &&
          record.variantId === variantId &&
          record.fileId === fileId
        ),
    );
    if (records.length !== index.records.length) {
      await this.save({ formatVersion: 3, records });
    }
  }
}
