/**
 * Validate packaged Desktop update artifacts before any network upload (ADR-0008).
 * Pattern from dsh `desktop-upload-plan.ts` — win-x64 / mac-arm64 / mac-x64.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  desktopPackageCompleteFilename,
  desktopUpdateMetadataFilename,
  resolveDesktopUploadConfig,
  type DesktopUploadConfig,
} from "./desktop-auto-update-environment.js";
import type { DesktopPackageTargetName } from "./package-targets.js";

export interface DesktopUploadArtifact {
  readonly path: string;
  readonly filename: string;
  readonly key: string;
  readonly contentType: string;
  readonly channelMetadata: boolean;
  /** Published YAML with absolute artifact URLs; binaries stay file-backed. */
  readonly contents?: string;
}

export interface DesktopUploadPlan {
  readonly environment: "test" | "production";
  readonly target: DesktopPackageTargetName;
  readonly version: string;
  readonly publicUrl: string;
  readonly bucket: string;
  readonly secretIdEnvName: string;
  readonly secretKeyEnvName: string;
  readonly artifacts: readonly DesktopUploadArtifact[];
  readonly commit?: string;
  readonly dirty?: boolean;
}

export interface DesktopUploadPlanOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly artifactsRoot?: string;
  readonly packageCompletePath?: string;
  readonly version?: string;
}

interface UpdateFileInfo {
  readonly filename: string;
  readonly size: number;
  readonly sha512: string;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`xrk desktop upload: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`xrk desktop upload: ${label} must be a non-empty string`);
  }
  return value;
}

function numberField(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`xrk desktop upload: ${label} must be a positive integer`);
  }
  return value;
}

async function sha512File(path: string): Promise<string> {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("base64");
}

/**
 * Minimal electron-builder update YAML reader (version / files / path / sha512 / size).
 * Avoids adding js-yaml to the private desktop package.
 */
export function parseDesktopUpdateMetadataYaml(text: string): {
  readonly version: string;
  readonly files: readonly UpdateFileInfo[];
  readonly path?: string;
  readonly sha512?: string;
} {
  const versionMatch = /^version:\s*(\S+)\s*$/mu.exec(text);
  if (!versionMatch) {
    throw new Error("xrk desktop upload: update metadata missing version");
  }
  const version = versionMatch[1]!;
  const files: UpdateFileInfo[] = [];
  const fileBlocks = text.split(/^\s*- /mu).slice(1);
  for (const block of fileBlocks) {
    const url =
      /^url:\s*(\S+)/mu.exec(block)?.[1] ??
      /^path:\s*(\S+)/mu.exec(block)?.[1];
    const sha512 = /(?:^|\n)\s*sha512:\s*(\S+)/u.exec(block)?.[1];
    const sizeRaw = /(?:^|\n)\s*size:\s*(\d+)/u.exec(block)?.[1];
    if (!url || !sha512 || !sizeRaw) {
      throw new Error(
        "xrk desktop upload: update metadata file entry needs url, sha512, size",
      );
    }
    files.push({
      filename: basename(url),
      size: Number(sizeRaw),
      sha512,
    });
  }
  if (files.length === 0) {
    // Single-file shape: top-level path + sha512 + size
    const path =
      /^path:\s*(\S+)\s*$/mu.exec(text)?.[1] ??
      /^url:\s*(\S+)\s*$/mu.exec(text)?.[1];
    const sha512 = /^sha512:\s*(\S+)\s*$/mu.exec(text)?.[1];
    const sizeRaw = /^size:\s*(\d+)\s*$/mu.exec(text)?.[1];
    if (path && sha512 && sizeRaw) {
      files.push({
        filename: basename(path),
        size: Number(sizeRaw),
        sha512,
      });
    }
  }
  if (files.length === 0) {
    throw new Error("xrk desktop upload: update metadata has no files");
  }
  return {
    version,
    files,
    ...( /^path:\s*(\S+)\s*$/mu.exec(text)
      ? { path: /^path:\s*(\S+)\s*$/mu.exec(text)![1]! }
      : {}),
    ...( /^sha512:\s*(\S+)\s*$/mu.exec(text)
      ? { sha512: /^sha512:\s*(\S+)\s*$/mu.exec(text)![1]! }
      : {}),
  };
}

function renderPublishedMetadata(
  metadataText: string,
  payloadUrl: string,
  info: UpdateFileInfo,
): string {
  // Rewrite url/path lines (including list items) to the public absolute URL.
  const lines = metadataText.split(/\r?\n/u).map((line) =>
    line.replace(
      /^(\s*(?:-\s*)?(?:url|path):\s*)\S+\s*$/u,
      `$1${payloadUrl}`,
    ),
  );
  if (
    !lines.some((line) =>
      /^\s*(?:-\s*)?(?:url|path):\s*/u.test(line),
    )
  ) {
    lines.push(`path: ${payloadUrl}`);
    lines.push(`sha512: ${info.sha512}`);
    lines.push(`size: ${info.size}`);
  }
  return `${lines.join("\n").replace(/\n*$/u, "")}\n`;
}

async function verifyChecksummedArtifact(
  artifactsRoot: string,
  info: UpdateFileInfo,
): Promise<string> {
  const path = join(artifactsRoot, info.filename);
  const details = await stat(path).catch(() => undefined);
  if (details === undefined || !details.isFile()) {
    throw new Error(`xrk desktop upload: missing artifact ${path}`);
  }
  if (details.size !== info.size) {
    throw new Error(
      `xrk desktop upload: ${info.filename} size ${details.size} does not match update metadata ${info.size}`,
    );
  }
  const actual = await sha512File(path);
  if (actual !== info.sha512) {
    throw new Error(
      `xrk desktop upload: ${info.filename} SHA-512 does not match update metadata`,
    );
  }
  return path;
}

async function requireArtifact(
  artifactsRoot: string,
  filename: string,
): Promise<string> {
  const path = join(artifactsRoot, filename);
  const details = await stat(path).catch(() => undefined);
  if (details === undefined || !details.isFile() || details.size === 0) {
    throw new Error(`xrk desktop upload: missing or empty artifact ${path}`);
  }
  return path;
}

function uploadArtifact(
  path: string,
  keyPrefix: string,
  contentType: string,
  channelMetadata = false,
): DesktopUploadArtifact {
  const filename = basename(path);
  return {
    path,
    filename,
    key: `${keyPrefix}/${filename}`,
    contentType,
    channelMetadata,
  };
}

/**
 * Build a validated upload plan from packaged artifacts + completion record.
 */
export async function createDesktopUploadPlan(
  targetName: DesktopPackageTargetName,
  options: DesktopUploadPlanOptions = {},
): Promise<DesktopUploadPlan> {
  if (
    targetName !== "win-x64" &&
    targetName !== "mac-arm64" &&
    targetName !== "mac-x64"
  ) {
    throw new Error(
      `xrk desktop upload: unsupported target ${String(targetName)}`,
    );
  }
  const environment = options.environment ?? process.env;
  const platform = targetName.startsWith("mac-") ? "darwin" : "win32";
  const arch = targetName.endsWith("arm64") ? "arm64" : "x64";
  const update: DesktopUploadConfig = resolveDesktopUploadConfig(
    environment,
    platform,
    arch,
  );
  if (update.target !== targetName) {
    throw new Error(
      `xrk desktop upload: resolved target ${update.target} !== ${targetName}`,
    );
  }

  const artifactsRoot = options.artifactsRoot;
  if (!artifactsRoot) {
    throw new Error("xrk desktop upload: artifactsRoot is required");
  }

  const completePath =
    options.packageCompletePath ??
    join(artifactsRoot, desktopPackageCompleteFilename(targetName));
  let buildRecord: Record<string, unknown>;
  try {
    buildRecord = object(
      JSON.parse(await readFile(completePath, "utf8")) as unknown,
      "package completion record",
    );
  } catch (error) {
    throw new Error(
      `xrk desktop upload: cannot read completion record at ${completePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  const buildVersion = stringField(
    options.version ?? buildRecord.version,
    "package completion record.version",
  );
  if (
    buildRecord.schemaVersion !== 1 ||
    buildRecord.target !== targetName ||
    buildRecord.environment !== update.environment ||
    buildRecord.publicUrl !== update.publicUrl
  ) {
    throw new Error(
      `xrk desktop upload: completion record for ${buildVersion} does not match the ${update.environment} update destination`,
    );
  }

  const metadataFilename = desktopUpdateMetadataFilename(buildVersion, platform);
  const metadataPath = join(artifactsRoot, metadataFilename);
  let metadataText: string;
  try {
    metadataText = await readFile(metadataPath, "utf8");
  } catch (error) {
    throw new Error(
      `xrk desktop upload: cannot read update metadata at ${metadataPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  const metadata = parseDesktopUpdateMetadataYaml(metadataText);
  if (metadata.version !== buildVersion) {
    throw new Error(
      `xrk desktop upload: ${metadataFilename} version ${metadata.version} does not match ${buildVersion}`,
    );
  }
  if (metadata.files.length !== 1) {
    throw new Error(
      `xrk desktop upload: ${metadataFilename}.files must contain exactly one target update file`,
    );
  }

  const os = platform === "darwin" ? "mac" : "win";
  const unsigned =
    platform === "win32" && buildRecord.signed === false;
  const nameSuffix = unsigned ? "-unsigned" : "";
  const base = `xrk-harness-${buildVersion}-${os}-${arch}${nameSuffix}`;
  const updaterExtension = platform === "darwin" ? "zip" : "exe";
  const expectedName = `${base}.${updaterExtension}`;
  const updaterInfo = metadata.files[0]!;
  if (updaterInfo.filename !== expectedName) {
    throw new Error(
      `xrk desktop upload: expected updater ${expectedName}, got ${updaterInfo.filename}`,
    );
  }
  const updaterPath = await verifyChecksummedArtifact(artifactsRoot, updaterInfo);
  const artifacts: DesktopUploadArtifact[] = [];
  const binaryPrefix = update.binaryKeyPrefix;

  if (platform === "darwin") {
    const dmgPath = await requireArtifact(artifactsRoot, `${base}.dmg`);
    const blockmapPath = await requireArtifact(
      artifactsRoot,
      `${base}.zip.blockmap`,
    );
    artifacts.push(
      uploadArtifact(dmgPath, binaryPrefix, "application/x-apple-diskimage"),
      uploadArtifact(updaterPath, binaryPrefix, "application/zip"),
      uploadArtifact(blockmapPath, binaryPrefix, "application/octet-stream"),
    );
  } else {
    const blockmapPath = await requireArtifact(
      artifactsRoot,
      `${base}.exe.blockmap`,
    );
    artifacts.push(
      uploadArtifact(
        updaterPath,
        binaryPrefix,
        "application/vnd.microsoft.portable-executable",
      ),
      uploadArtifact(blockmapPath, binaryPrefix, "application/octet-stream"),
    );
  }

  const payloadUrl = `${update.origin}/${binaryPrefix}/${updaterInfo.filename}`;
  const publishedYaml = renderPublishedMetadata(
    metadataText,
    payloadUrl,
    updaterInfo,
  );
  const channelArtifact: DesktopUploadArtifact = {
    ...uploadArtifact(metadataPath, update.keyPrefix, "application/yaml", true),
    contents: publishedYaml,
  };
  artifacts.push(channelArtifact);
  // Stable alias for non-prerelease builds (semver without `-`).
  if (!/-/.test(buildVersion)) {
    const stableFilename =
      platform === "darwin" ? "latest-mac.yml" : "latest.yml";
    artifacts.push({
      ...channelArtifact,
      filename: stableFilename,
      key: `${update.keyPrefix}/${stableFilename}`,
    });
  }

  return {
    environment: update.environment,
    target: targetName,
    version: buildVersion,
    publicUrl: update.publicUrl,
    bucket: update.bucket,
    secretIdEnvName: update.secretIdEnvName,
    secretKeyEnvName: update.secretKeyEnvName,
    artifacts,
    ...(typeof buildRecord.commit === "string"
      ? { commit: buildRecord.commit }
      : {}),
    ...(typeof buildRecord.dirty === "boolean"
      ? { dirty: buildRecord.dirty }
      : {}),
  };
}

export { numberField, object, stringField };
