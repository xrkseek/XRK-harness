/**
 * Credential-free evidence + pluggable PUT for Desktop update uploads (ADR-0008).
 * Default transport writes to a local mirror directory (CI / dry-run);
 * production injects an HTTPS/COS putObject.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  DesktopUploadArtifact,
  DesktopUploadPlan,
} from "./desktop-upload-plan.js";

export interface DesktopUploadPutObject {
  readonly key: string;
  readonly contentType: string;
  readonly body: Buffer;
  readonly contentMd5: string;
  readonly contentLength: number;
}

export type DesktopUploadTransport = (
  object: DesktopUploadPutObject,
) => Promise<{ readonly httpStatus?: number; readonly requestId?: string }>;

async function fingerprint(artifact: DesktopUploadArtifact): Promise<{
  readonly size: number;
  readonly sha512: string;
  readonly md5: string;
  readonly body: Buffer;
}> {
  const chunks: Buffer[] = [];
  if (artifact.contents !== undefined) {
    chunks.push(Buffer.from(artifact.contents));
  } else {
    for await (const chunk of createReadStream(artifact.path)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  }
  const body = Buffer.concat(chunks);
  return {
    size: body.byteLength,
    sha512: createHash("sha512").update(body).digest("base64"),
    md5: createHash("md5").update(body).digest("base64"),
    body,
  };
}

/** Local filesystem mirror used by CI `--check` / dry-run uploads. */
export function createDesktopFilesystemUploadTransport(
  mirrorRoot: string,
): DesktopUploadTransport {
  return async (object) => {
    const dest = join(mirrorRoot, ...object.key.split("/"));
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, object.body, { mode: 0o600 });
    return { httpStatus: 200, requestId: "filesystem" };
  };
}

/**
 * Upload an already validated release, flushing plan/events/result evidence.
 * Never retries; never logs credential values.
 */
export async function uploadDesktopRelease(
  plan: DesktopUploadPlan,
  transport: DesktopUploadTransport,
  recordsRoot: string,
): Promise<string> {
  await mkdir(recordsRoot, { recursive: true });
  const directory = await mkdtemp(
    join(recordsRoot, `${plan.environment}-${plan.target}-`),
  );
  process.stdout.write(`xrk desktop upload: record ${directory}\n`);
  let stage = "prepare";
  let key: string | undefined;
  let confirmedPuts = 0;
  let success = false;
  let failure: object | undefined;
  const eventsPath = join(directory, "events.jsonl");
  await writeFile(eventsPath, "", { flag: "wx", mode: 0o600 });

  const appendEvent = async (event: object): Promise<void> => {
    await writeFile(eventsPath, `${JSON.stringify(event)}\n`, {
      flag: "a",
      mode: 0o600,
    });
  };

  try {
    await appendEvent({
      type: "upload-start",
      environment: plan.environment,
      target: plan.target,
      version: plan.version,
    });
    stage = "hash-input";
    const artifacts = [];
    for (const artifact of plan.artifacts) {
      key = artifact.key;
      artifacts.push({ ...artifact, ...(await fingerprint(artifact)) });
    }
    await writeFile(
      join(directory, "plan.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          environment: plan.environment,
          target: plan.target,
          version: plan.version,
          bucket: plan.bucket,
          publicUrl: plan.publicUrl,
          maxAttempts: 1,
          artifacts: artifacts.map((a) => ({
            key: a.key,
            filename: a.filename,
            contentType: a.contentType,
            channelMetadata: a.channelMetadata,
            size: a.size,
            sha512: a.sha512,
          })),
        },
        null,
        2,
      )}\n`,
      { flag: "wx", mode: 0o600 },
    );

    for (const artifact of artifacts) {
      key = artifact.key;
      stage = "verify-input";
      const current = await fingerprint(artifact);
      if (current.sha512 !== artifact.sha512 || current.size !== artifact.size) {
        throw new Error("xrk desktop upload: input changed before PUT");
      }
      stage = "put";
      await appendEvent({
        type: "put-intent",
        key,
        size: artifact.size,
        sha512: artifact.sha512,
        channelMetadata: artifact.channelMetadata,
      });
      const receipt = await transport({
        key: artifact.key,
        contentType: artifact.contentType,
        body: current.body,
        contentMd5: current.md5,
        contentLength: current.size,
      });
      confirmedPuts += 1;
      await appendEvent({
        type: "put-complete",
        key,
        ...receipt,
      });
    }
    success = true;
    await writeFile(
      join(directory, "result.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          ok: true,
          confirmedPuts,
          publicUrl: plan.publicUrl,
          version: plan.version,
          target: plan.target,
          environment: plan.environment,
        },
        null,
        2,
      )}\n`,
      { flag: "wx", mode: 0o600 },
    );
    return directory;
  } catch (error) {
    failure = {
      stage,
      key,
      message: error instanceof Error ? error.message : String(error),
    };
    await writeFile(
      join(directory, "result.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          ok: false,
          confirmedPuts,
          failure,
        },
        null,
        2,
      )}\n`,
      { flag: "w", mode: 0o600 },
    );
    throw error;
  } finally {
    if (!success) {
      await appendEvent({
        type: "upload-failed",
        confirmedPuts,
        failure,
      }).catch(() => undefined);
    }
  }
}
