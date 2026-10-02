/**
 * DSH `registerAuto` — Auto (Guardian) is not a configured table entry; it
 * appears in the current-session catalog only while an integration is live.
 *
 * Dispose closes admission, optionally migrates live Auto sessions, aborts
 * in-flight reviews, drains them, then withdraws the catalog (DSH auto-review
 * lifecycle).
 */

import {
  AUTO_PERMISSION_PRESET,
  FACE_PERMISSION_PRESETS,
} from "./face-schema.js";

/** Synchronous admission gate run before selecting or restoring Auto. */
export type FacePermissionAutoAdmit = () => void;

/** Live registration surface for in-flight review cancellation. */
export interface FacePermissionAutoLifecycle {
  readonly signal: AbortSignal;
  /** Whether new Auto selections / reviews are still accepted. */
  isAccepting(): boolean;
  /** Track a review so dispose can drain it after abort. */
  track(work: Promise<unknown>): void;
}

export interface FacePermissionAutoGate {
  /**
   * Publish Auto for the integration lifetime (DSH `registerAuto`).
   * @param admit - synchronous gate run before live Auto selection or restore.
   * @param options.migrateAway - move live Auto sessions off Auto before
   *   withdrawing the catalog (typically → `danger-full-access`).
   * @returns disposer that closes admission, migrates, aborts reviews, drains,
   *   then removes Auto from the catalog.
   */
  registerAuto(
    admit: FacePermissionAutoAdmit,
    options?: {
      readonly migrateAway?: () => void;
    },
  ): () => void;
  /** Whether Guardian/auto-review has published Auto. */
  isLive(): boolean;
  /** Whether the live integration still accepts Auto selection / restore. */
  isAccepting(): boolean;
  /**
   * Run the live admit hook (before `/permission auto` or restore).
   * @throws when Auto is not live, closing, or when admit rejects.
   */
  admit(): void;
  /** Base presets, then `auto` while live. */
  catalogNames(): readonly string[];
  /** Listen for catalog attach/detach (republish permissions projection). */
  onCatalogChange(listener: () => void): () => void;
  /** Abort/track face while Auto is published; undefined when withdrawn. */
  lifecycle(): FacePermissionAutoLifecycle | undefined;
}

/**
 * Process-local Auto catalog gate. One admit at a time (DSH rejects duplicates).
 */
export function createFacePermissionAutoGate(): FacePermissionAutoGate {
  let autoAdmit: FacePermissionAutoAdmit | undefined;
  let migrateAway: (() => void) | undefined;
  let accepting = false;
  let lifecycleAbort: AbortController | undefined;
  const active = new Set<Promise<unknown>>();
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* catalog listeners must not break Host */
      }
    }
  };

  const lifecycleFace = (): FacePermissionAutoLifecycle | undefined => {
    if (lifecycleAbort === undefined) return undefined;
    const signal = lifecycleAbort.signal;
    return {
      signal,
      isAccepting: () => accepting,
      track(work) {
        active.add(work);
        void work.finally(() => {
          active.delete(work);
        });
      },
    };
  };

  return {
    registerAuto(admit, options) {
      if (autoAdmit !== undefined) {
        throw new Error('permission: preset "auto" is already registered');
      }
      autoAdmit = admit;
      migrateAway = options?.migrateAway;
      accepting = true;
      lifecycleAbort = new AbortController();
      emit();
      return () => {
        if (autoAdmit !== admit) return;
        // DSH: close admission first so migration observers cannot re-select Auto.
        accepting = false;
        try {
          migrateAway?.();
        } finally {
          const abort = lifecycleAbort;
          lifecycleAbort = undefined;
          migrateAway = undefined;
          abort?.abort(new Error("auto-review integration disposed"));
          // Drain without blocking Host close; reviews observe abort via signal.
          void Promise.allSettled([...active]).then(() => {
            active.clear();
          });
          autoAdmit = undefined;
          emit();
        }
      };
    },

    isLive() {
      return autoAdmit !== undefined;
    },

    isAccepting() {
      return accepting && autoAdmit !== undefined;
    },

    admit() {
      if (autoAdmit === undefined) {
        throw new Error(
          'permission: preset "auto" is not available (Guardian integration not mounted)',
        );
      }
      if (!accepting) {
        throw new Error("auto-review: integration is closing");
      }
      autoAdmit();
    },

    catalogNames() {
      return autoAdmit === undefined
        ? FACE_PERMISSION_PRESETS
        : [...FACE_PERMISSION_PRESETS, AUTO_PERMISSION_PRESET];
    },

    onCatalogChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    lifecycle: lifecycleFace,
  };
}
