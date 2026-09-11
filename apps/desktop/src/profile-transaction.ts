/**
 * Desktop profile activation transaction (ADR-0008).
 * Shape: staging → health check → activate (journaled) → rollback on failure / crash recovery.
 * Does not run offline pnpm install or Cordis boot.
 */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  DESKTOP_HOST_PACKAGE,
  DESKTOP_HOST_RUNTIME_FILES,
  DESKTOP_PACKAGE_SET_FILE,
  verifyDesktopCorePackageSet,
} from "./core-package-set.js";
import {
  acquireDesktopPackageLock,
  type DesktopPackageLockHold,
} from "./package-lock.js";
import type { DesktopPaths } from "./paths.js";

/** Journaled activation step used for crash recovery. */
export type DesktopProfileActivationStep =
  | "prepared"
  | "active-moved"
  | "staging-activated";

/** Pending activation journal written to `paths.pending`. */
export interface DesktopPendingProfileTransaction {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly stagingProfile: string;
  readonly step: DesktopProfileActivationStep;
}

/** Hooks that bind profile replacement to Host lifecycle and health. */
export interface DesktopProfileHooks {
  /** Prove the staged profile before directory swaps. */
  healthCheck(projectDir: string): Promise<void>;
  /** Stop the active Host before directory moves. */
  beforeActivate(): Promise<void>;
  /** Start the active profile after commit or rollback. */
  afterActivate(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, undefined, 2)}\n`, {
    mode: 0o600,
  });
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function isDescendant(root: string, target: string): boolean {
  const child = path.relative(path.resolve(root), path.resolve(target));
  return (
    child !== "" &&
    child !== ".." &&
    !child.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(child)
  );
}

function removeOwnedDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) return;
  const stat = lstatSync(dirPath);
  if (stat.isSymbolicLink()) {
    unlinkSync(dirPath);
    return;
  }
  if (!stat.isDirectory()) {
    throw new Error(
      `xrk desktop profile: owned path is not a directory: ${dirPath}`,
    );
  }
  rmSync(dirPath, { recursive: true, force: true });
}

/**
 * Default health check: Host runtime entry under `node_modules`, or verified package-set.
 * Inject a custom hook for richer Host boot probes.
 */
export async function defaultDesktopProfileHealthCheck(
  projectDir: string,
  expectedHostVersion?: string,
): Promise<void> {
  const packageSetPath = path.join(projectDir, DESKTOP_PACKAGE_SET_FILE);
  if (existsSync(packageSetPath)) {
    if (expectedHostVersion === undefined) {
      throw new Error(
        "xrk desktop profile: package-set health check requires expectedHostVersion",
      );
    }
    verifyDesktopCorePackageSet(projectDir, expectedHostVersion);
  }
  const hostEntry = path.join(
    projectDir,
    "node_modules",
    ...DESKTOP_HOST_PACKAGE.split("/"),
    ...DESKTOP_HOST_RUNTIME_FILES[0].split("/"),
  );
  if (!existsSync(hostEntry) || !lstatSync(hostEntry).isFile()) {
    throw new Error(
      `xrk desktop profile: health check failed — missing ${DESKTOP_HOST_PACKAGE}/${DESKTOP_HOST_RUNTIME_FILES[0]}`,
    );
  }
}

/** Transactional owner of the reserved desktop profile directories. */
export class DesktopProfileTransactionManager {
  private lockHold: DesktopPackageLockHold | undefined;

  constructor(readonly paths: DesktopPaths) {}

  /** Recover an interrupted directory replacement before reading the active profile. */
  recover(): void {
    if (!existsSync(this.paths.pending)) return;
    const value = readJson(this.paths.pending);
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      typeof value.id !== "string" ||
      typeof value.stagingProfile !== "string" ||
      !isDescendant(this.paths.staging, value.stagingProfile) ||
      (value.step !== "prepared" &&
        value.step !== "active-moved" &&
        value.step !== "staging-activated")
    ) {
      throw new Error(
        `xrk desktop profile: invalid activation journal ${this.paths.pending}`,
      );
    }
    const pending: DesktopPendingProfileTransaction = {
      schemaVersion: 1,
      id: value.id,
      stagingProfile: value.stagingProfile,
      step: value.step,
    };
    if (!existsSync(this.paths.profile) && existsSync(this.paths.rollback)) {
      mkdirSync(path.dirname(this.paths.profile), { recursive: true });
      renameSync(this.paths.rollback, this.paths.profile);
    }
    removeOwnedDirectory(pending.stagingProfile);
    // Staging parent UUID dir may remain empty — clean best-effort
    const stagingParent = path.dirname(pending.stagingProfile);
    if (
      existsSync(stagingParent) &&
      isDescendant(this.paths.staging, stagingParent)
    ) {
      try {
        rmSync(stagingParent, { recursive: true, force: true });
      } catch {
        // ignore non-empty / race
      }
    }
    unlinkSync(this.paths.pending);
  }

  /** Allocate a fresh staging profile directory under `paths.staging`. */
  createStagingProfile(): string {
    const stagingProfile = path.join(
      this.paths.staging,
      randomUUID(),
      "profile",
    );
    mkdirSync(stagingProfile, { recursive: true, mode: 0o700 });
    return stagingProfile;
  }

  /**
   * Health-check a prepared staging profile, then journal-activate it.
   * On health-check / activate failure, removes the staging tree when still present.
   */
  async commitStagingProfile(
    stagingProfile: string,
    hooks: DesktopProfileHooks,
  ): Promise<void> {
    if (!isDescendant(this.paths.staging, stagingProfile)) {
      throw new Error(
        `xrk desktop profile: staging profile must live under ${this.paths.staging}`,
      );
    }
    if (!existsSync(stagingProfile)) {
      throw new Error(
        `xrk desktop profile: staging profile missing: ${stagingProfile}`,
      );
    }
    try {
      await hooks.healthCheck(stagingProfile);
      await this.activate(stagingProfile, hooks);
    } catch (error) {
      removeOwnedDirectory(stagingProfile);
      throw error;
    }
  }

  /**
   * Run `operation` under an exclusive desktop package lock file.
   * Stale locks (dead owner PID) may be reclaimed; live Electron / worker PIDs are not.
   * Use {@link assignPackageLockOwner} while a package worker may still write.
   */
  async withPackageLock<T>(operation: () => Promise<T>): Promise<T> {
    const hold = acquireDesktopPackageLock(this.paths.lock, {
      initialOwnerPid: process.pid,
    });
    this.lockHold = hold;
    try {
      return await operation();
    } finally {
      this.lockHold = undefined;
      hold.release();
    }
  }

  /**
   * Record the live package worker (or Electron) as transaction lock owner.
   * Prevents a later process from reclaiming the lock while the worker still runs.
   */
  assignPackageLockOwner(pid: number): void {
    const hold = this.lockHold;
    if (hold === undefined) {
      throw new Error("xrk desktop profile: package transaction lost its lock");
    }
    hold.assignOwner(pid);
  }

  /**
   * Recover, then commit under the package lock.
   * Callers prepare `stagingProfile` contents before invoking.
   */
  async runTransaction(
    stagingProfile: string,
    hooks: DesktopProfileHooks,
  ): Promise<void> {
    await this.withPackageLock(async () => {
      this.recover();
      await this.commitStagingProfile(stagingProfile, hooks);
    });
  }

  private async activate(
    stagingProfile: string,
    hooks: DesktopProfileHooks,
  ): Promise<void> {
    const pending: DesktopPendingProfileTransaction = {
      schemaVersion: 1,
      id: path.basename(path.dirname(stagingProfile)),
      stagingProfile,
      step: "prepared",
    };
    writeJson(this.paths.pending, pending);
    await hooks.beforeActivate();
    let activeMoved = false;
    try {
      removeOwnedDirectory(this.paths.rollback);
      mkdirSync(path.dirname(this.paths.rollback), {
        recursive: true,
        mode: 0o700,
      });
      writeJson(this.paths.pending, {
        ...pending,
        step: "active-moved",
      } satisfies DesktopPendingProfileTransaction);
      if (existsSync(this.paths.profile)) {
        renameSync(this.paths.profile, this.paths.rollback);
        activeMoved = true;
      }
      mkdirSync(path.dirname(this.paths.profile), {
        recursive: true,
        mode: 0o700,
      });
      writeJson(this.paths.pending, {
        ...pending,
        step: "staging-activated",
      } satisfies DesktopPendingProfileTransaction);
      renameSync(stagingProfile, this.paths.profile);
      await hooks.afterActivate();
      unlinkSync(this.paths.pending);
    } catch (error) {
      if (existsSync(this.paths.profile)) {
        removeOwnedDirectory(this.paths.profile);
      }
      if (activeMoved && existsSync(this.paths.rollback)) {
        renameSync(this.paths.rollback, this.paths.profile);
      }
      if (existsSync(this.paths.pending)) unlinkSync(this.paths.pending);
      await hooks.afterActivate().catch(() => undefined);
      throw error;
    }
  }
}
