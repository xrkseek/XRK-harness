/**
 * SenseVoice asset preparer — fetch, verify, publish; never leave a half file.
 *
 * The invariants worth keeping (all of them learned from a broken download):
 *   1. One `.part` file per asset, removed before the transfer starts, so a
 *      crash leaves garbage we can delete rather than a file that looks ready.
 *   2. sha256 is computed **while** streaming, and the declared byte count is a
 *      ceiling — a mirror answering with an HTML error page fails at the first
 *      chunk instead of writing 238 MB of markup.
 *   3. Publish is a single `rename` inside the same directory: readers either
 *      see the old state or the verified file, never a prefix of it.
 *   4. Origins are walked in order (huggingface.co → hf-mirror.com). A failed
 *      origin is retried from byte zero — no ranged resume, because a mirror
 *      that died mid-body cannot be trusted to agree on the prefix.
 *
 * Deliberately not here: ranged resume, concurrent multi-origin racing, and a
 * background idle reaper. One user, one press, one transfer (YAGNI until the
 * product proves otherwise).
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  SENSEVOICE_ASSETS,
  SENSEVOICE_ORIGINS,
  SENSEVOICE_TOTAL_BYTES,
  type SenseVoiceAsset,
} from "./sensevoice-assets.js";
import { openAssetStream, type DownloadStream } from "./download-http.js";

/** Where the preparer is in its lifecycle. */
export type SenseVoicePreparePhase = "idle" | "preparing" | "ready" | "failed";

/** Failure taxonomy — the card turns each of these into one "do this next" line. */
export type SenseVoicePrepareErrorCode =
  | "network"
  | "timeout"
  | "http"
  | "integrity"
  | "storage"
  | "cancelled"
  | "unknown";

export interface SenseVoicePrepareFailure {
  readonly code: SenseVoicePrepareErrorCode;
  readonly message: string;
  /** Origin that was serving when it broke (absent for local failures). */
  readonly origin?: string;
}

export interface SenseVoicePrepareState {
  readonly phase: SenseVoicePreparePhase;
  /** Asset id in flight; `null` when idle / ready. */
  readonly current: string | null;
  readonly bytesDone: number;
  readonly bytesTotal: number;
  /** Smoothed bytes/second of the current asset (0 before the first sample). */
  readonly speedBps: number;
  readonly failure: SenseVoicePrepareFailure | null;
  /** Origin serving the current transfer. */
  readonly origin: string | null;
}

export interface SenseVoicePreparerOptions {
  /** Absolute cache directory (`{XRK_HOME}/voice/sensevoice` by default). */
  readonly dataRoot: string
  readonly origins?: readonly string[]
  readonly fetchImpl?: typeof fetch
  /**
   * How long one origin may take to answer with response headers before the
   * walk moves to the next one. Only the wait for *headers* is bounded — a
   * body that has started arriving keeps its full transfer time.
   */
  readonly originTimeoutMs?: number
  /** Progress tick floor; a 238 MB body would otherwise re-render hundreds of times a second. */
  readonly progressIntervalMs?: number
}

const REPORT_FLOOR_MS = 250;

/**
 * A dead origin must not own the whole press.
 *
 * `huggingface.co` from a mainland link does not refuse — it black-holes, so
 * an unbounded `fetch` sat at 0 % for as long as the socket kept waiting.
 * Twelve seconds is long enough for a slow-but-alive mirror and short enough
 * that the next origin is tried while the user is still watching.
 */
const ORIGIN_HEADER_TIMEOUT_MS = 12_000;

/**
 * Adapt a `fetch` body to the one stream shape `writeVerified` consumes, so
 * the injected test seam and the real downloader share every downstream step
 * (hashing, byte ceiling, `.part` handling, atomic publish).
 * @param stream - Web stream from a `Response`.
 * @returns The same bytes as an async iterable.
 */
async function* bodyChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function classify(err: unknown, abortedByCaller: boolean): SenseVoicePrepareFailure {
  if (abortedByCaller) {
    return { code: "cancelled", message: "preparation cancelled" };
  }
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  if (name === "AbortError" || name === "TimeoutError") {
    return { code: "timeout", message };
  }
  if (/sha256|byte count|exceeded/i.test(message)) {
    return { code: "integrity", message };
  }
  if (/ENOSPC|EACCES|EPERM|EROFS|ENOENT/i.test(message)) {
    return { code: "storage", message };
  }
  return { code: "network", message };
}

/** One prepared asset on disk: size is the fast check, sha256 the slow truth. */
async function statSize(file: string): Promise<number | undefined> {
  try {
    const info = await fs.stat(file);
    return info.isFile() ? info.size : undefined;
  } catch {
    return undefined;
  }
}

export class SenseVoicePreparer {
  private state: SenseVoicePrepareState = {
    phase: "idle",
    current: null,
    bytesDone: 0,
    bytesTotal: SENSEVOICE_TOTAL_BYTES,
    speedBps: 0,
    failure: null,
    origin: null,
  };
  private controller: AbortController | null = null;
  private running = false;

  constructor(private readonly options: SenseVoicePreparerOptions) {}

  /** Latest state (the Face handler serializes this straight to the card). */
  snapshot(): SenseVoicePrepareState {
    return this.state;
  }

  /** True when a transfer is in flight. */
  get busy(): boolean {
    return this.running;
  }

  /**
   * Walk every asset: skip verified-by-size files, download the rest.
   * @param options - Per-run transport overrides; `proxy` is the operator's
   *   HTTP CONNECT proxy for hosts that cannot reach the origins directly.
   * @returns the settled state (never throws — failures land on the state).
   */
  async prepare(options: { readonly proxy?: string } = {}): Promise<SenseVoicePrepareState> {
    if (this.running) return this.state;
    this.running = true;
    const controller = new AbortController();
    this.controller = controller;
    this.state = {
      phase: "preparing",
      current: null,
      bytesDone: 0,
      bytesTotal: SENSEVOICE_TOTAL_BYTES,
      speedBps: 0,
      failure: null,
      origin: null,
    };
    try {
      let done = 0;
      for (const asset of SENSEVOICE_ASSETS) {
        const dest = path.join(this.options.dataRoot, asset.file);
        if ((await statSize(dest)) === asset.bytes) {
          // Size match means a previous run already published it. The sha256
          // was verified at that publish; re-hashing 238 MB on every open would
          // cost more than the risk it removes.
          done += asset.bytes;
          this.patch({ bytesDone: done, current: asset.id });
          continue;
        }
        await this.download(asset, done, controller.signal, options.proxy);
        done += asset.bytes;
      }
      this.state = {
        ...this.state,
        phase: "ready",
        current: null,
        bytesDone: SENSEVOICE_TOTAL_BYTES,
        speedBps: 0,
        origin: null,
      };
    } catch (err) {
      this.state = {
        ...this.state,
        phase: "failed",
        current: null,
        speedBps: 0,
        failure: classify(err, controller.signal.aborted),
      };
    } finally {
      this.running = false;
      this.controller = null;
    }
    return this.state;
  }

  /** Abort an in-flight prepare; the state settles as `failed/cancelled`. */
  cancel(): SenseVoicePrepareState {
    this.controller?.abort();
    return this.snapshot();
  }

  private patch(next: Partial<SenseVoicePrepareState>): void {
    this.state = { ...this.state, ...next };
  }

  private async download(
    asset: SenseVoiceAsset,
    doneBefore: number,
    signal: AbortSignal,
    proxy?: string,
  ): Promise<void> {
    const origins = this.options.origins ?? SENSEVOICE_ORIGINS;
    await fs.mkdir(this.options.dataRoot, { recursive: true });
    const dest = path.join(this.options.dataRoot, asset.file);
    const part = `${dest}.part`;

    let lastFailure: SenseVoicePrepareFailure | null = null;
    for (const origin of origins) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      this.patch({ current: asset.id, origin });
      // Bound only the wait for headers. The gate is cleared the instant they
      // land, so the body below is governed by the caller's signal alone —
      // otherwise a 238 MB transfer on a slow link would be cut at the same
      // deadline that exists to catch a dead origin.
      const gate = new AbortController();
      const headerTimeoutMs = this.options.originTimeoutMs ?? ORIGIN_HEADER_TIMEOUT_MS;
      let headerTimedOut = false;
      const gateTimer = setTimeout(() => {
        headerTimedOut = true;
        gate.abort();
      }, headerTimeoutMs);
      try {
        const opened = await this.open(
          `${origin}${asset.path}`,
          AbortSignal.any([signal, gate.signal]),
          proxy,
        );
        clearTimeout(gateTimer);
        if (opened.status < 200 || opened.status >= 300 || opened.body === null) {
          lastFailure = {
            code: "http",
            message: `HTTP ${opened.status}`,
            origin,
          };
          continue;
        }
        await this.writeVerified(asset, opened.body, part, dest, doneBefore, origin, signal);
        return;
      } catch (err) {
        clearTimeout(gateTimer);
        if (signal.aborted) throw err;
        lastFailure = headerTimedOut
          ? {
              code: "timeout",
              message: `no response in ${headerTimeoutMs} ms`,
              origin,
            }
          : { ...classify(err, false), origin };
      }
    }
    throw new Error(
      lastFailure === null
        ? `no origin could serve ${asset.file}`
        : `${asset.file}: ${lastFailure.code} — ${lastFailure.message}`,
    );
  }

  /**
   * Open one asset URL.
   *
   * The default path is @see openAssetStream, which probes every DNS record —
   * `fetch` here connected to a black-holed address and reported a 10 s
   * connect timeout while `curl` on the same box succeeded in 1.5 s. The
   * `fetchImpl` seam stays for tests that script responses.
   * @param url - Absolute asset URL.
   * @param signal - Caller cancellation.
   * @param proxy - Operator-configured HTTP CONNECT proxy, if any.
   * @returns Status plus the body stream.
   */
  private async open(
    url: string,
    signal: AbortSignal,
    proxy?: string,
  ): Promise<DownloadStream> {
    const fetchImpl = this.options.fetchImpl;
    if (fetchImpl === undefined) return openAssetStream(url, signal, proxy);
    const response = await fetchImpl(url, { signal });
    return {
      status: response.status,
      body: response.body === null ? null : bodyChunks(response.body),
    };
  }

  private async writeVerified(
    asset: SenseVoiceAsset,
    body: AsyncIterable<Uint8Array>,
    part: string,
    dest: string,
    doneBefore: number,
    origin: string,
    signal: AbortSignal,
  ): Promise<void> {
    // A leftover `.part` is garbage from a crashed run; drop it before `w`.
    await fs.rm(part, { force: true });
    const handle = await fs.open(part, "w", 0o600);
    const hash = createHash("sha256");
    const startedAt = Date.now();
    let received = 0;
    let lastReport = 0;
    try {
      for await (const value of body) {
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        received += value.byteLength;
        if (received > asset.bytes) {
          throw new Error(`byte count exceeded for ${asset.file} (${received} > ${asset.bytes})`);
        }
        hash.update(value);
        let offset = 0;
        while (offset < value.byteLength) {
          const { bytesWritten } = await handle.write(
            value,
            offset,
            value.byteLength - offset,
          );
          offset += bytesWritten;
        }
        const now = Date.now();
        if (now - lastReport >= (this.options.progressIntervalMs ?? REPORT_FLOOR_MS)) {
          lastReport = now;
          const elapsed = Math.max(1, now - startedAt) / 1000;
          this.patch({
            bytesDone: doneBefore + received,
            speedBps: Math.round(received / elapsed),
          });
        }
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (received !== asset.bytes) {
      await fs.rm(part, { force: true });
      throw new Error(
        `byte count mismatch for ${asset.file} (${received} != ${asset.bytes})`,
      );
    }
    const digest = hash.digest("hex");
    if (digest !== asset.sha256) {
      await fs.rm(part, { force: true });
      throw new Error(
        `sha256 mismatch for ${asset.file} (${digest} != ${asset.sha256})`,
      );
    }
    await fs.rename(part, dest);
    this.patch({ bytesDone: doneBefore + received, origin });
  }
}

/**
 * One preparer per data root for the life of the process.
 *
 * Two cards (or two sessions) pressing download must never race on the same
 * `.part`, and the state has to survive a settings panel reopening mid-transfer.
 */
const preparers = new Map<string, SenseVoicePreparer>();

export function senseVoicePreparer(
  options: SenseVoicePreparerOptions,
): SenseVoicePreparer {
  const key = path.resolve(options.dataRoot);
  let existing = preparers.get(key);
  if (existing === undefined) {
    existing = new SenseVoicePreparer({ ...options, dataRoot: key });
    preparers.set(key, existing);
  }
  return existing;
}
