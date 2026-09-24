/**
 * Host-filesystem spill backend under `{XRK_HOME}/spill`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  capSpillText,
  pruneSpillTree,
  resolveXrkHome,
} from "@xrkseek/xrk-home-paths";
import {
  SpillLocator,
  type SaveTextSpill,
  type SpillRef,
  type SpillStore,
} from "./types.js";

const DEFAULT_RETRIEVAL =
  "Retrieve with read_file or grep on that path.";

export interface LocalSpillStoreOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Override spill root (tests). Default `{XRK_HOME}/spill`. */
  readonly root?: string;
  /** Subdir under root for tool results. Default `tool-outputs`. */
  readonly toolRelativeDir?: string;
}

/** Encode one untrusted string as a single safe path segment. */
export function encodeSpillSegment(raw: string): string {
  if (raw.length === 0) return "_";
  return raw.replace(/[^\w.-]+/g, "_").slice(0, 120) || "_";
}

export function defaultSpillRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveXrkHome(env), "spill");
}

/** Local filesystem {@link SpillStore}. */
export class LocalSpillStore implements SpillStore {
  private readonly root: string;
  private readonly toolRelativeDir: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: LocalSpillStoreOptions = {}) {
    this.env = options.env ?? process.env;
    this.root = path.resolve(options.root ?? defaultSpillRoot(this.env));
    this.toolRelativeDir = (options.toolRelativeDir ?? "tool-outputs").replace(
      /\\/g,
      "/",
    );
  }

  /** Absolute spill tree root (Host `hostReadableRoots`). */
  get spillRoot(): string {
    return this.root;
  }

  async saveText(input: SaveTextSpill): Promise<SpillRef> {
    return this.saveTextSync(input);
  }

  saveTextSync(input: SaveTextSpill): SpillRef {
    pruneSpillTree(this.root);
    const dir =
      input.source.kind === "tool"
        ? path.join(this.root, this.toolRelativeDir)
        : path.join(
            this.root,
            encodeSpillSegment(input.owner.sessionId),
          );
    mkdirSync(dir, { recursive: true });
    const base = encodeSpillSegment(
      input.suggestedName.replace(/\.[^.]+$/, "") || "spill",
    );
    const ext =
      path.extname(input.suggestedName).replace(/[^\w.]/g, "") || ".txt";
    const name =
      input.source.kind === "tool"
        ? `${encodeSpillSegment(input.owner.sessionId)}_${encodeSpillSegment(input.source.callId) || "call"}${ext.startsWith(".") ? ext : `.${ext}`}`
        : `${base}_${Date.now().toString(36)}${ext.startsWith(".") ? ext : `.${ext}`}`;
    const file = path.join(dir, name);
    const body = capSpillText(input.content);
    writeFileSync(file, body, "utf8");
    const bytes = Buffer.byteLength(body, "utf8");
    return {
      locator: SpillLocator(file),
      bytes,
      retrievalHint: DEFAULT_RETRIEVAL,
    };
  }
}

let shared: LocalSpillStore | undefined;
let sharedHome: string | undefined;

/** Process-wide default local store (lazy; rebinds when XRK_HOME changes). */
export function defaultLocalSpillStore(
  env: NodeJS.ProcessEnv = process.env,
): LocalSpillStore {
  const home = resolveXrkHome(env);
  if (!shared || sharedHome !== home) {
    shared = new LocalSpillStore({ env });
    sharedHome = home;
  }
  return shared;
}

/** Test hook: drop the shared singleton. */
export function resetDefaultLocalSpillStore(): void {
  shared = undefined;
  sharedHome = undefined;
}
