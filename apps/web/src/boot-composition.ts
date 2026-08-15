/**
 * XRK BootComposition roster — local factories only (no Cordis / remote ui-*).
 * Settle via BootGate before any chrome mount.
 */

import {
  BootGate,
  type BootEntryState,
} from "@xrkseek/web-runtime";
import type { ShellController } from "./shell-controller.js";

export const BOOT_ENTRY_IDS = [
  "connection",
  "face-client",
  "layout-slots",
] as const;

export type BootEntryId = (typeof BOOT_ENTRY_IDS)[number];

export type BootActivator = (ctl: ShellController) => void;

const DEFAULT_ACTIVATORS: Record<BootEntryId, BootActivator> = {
  connection: (ctl) => {
    ctl.rebuildClient();
  },
  "face-client": (ctl) => {
    void ctl.view;
  },
  "layout-slots": (ctl) => {
    ctl.declareChromeSlots();
  },
};

/**
 * Register → activate → mark. Fail-loud if any entry throws or stays non-active.
 * Does not require a live Host (connection is local FaceClient ctor only).
 */
export function activateBootComposition(
  gate: BootGate,
  ctl: ShellController,
  options?: {
    readonly activators?: Partial<Record<BootEntryId, BootActivator>>;
    /** Force a specific entry to failed (tests). */
    readonly forceFail?: BootEntryId;
  },
): void {
  const activators = { ...DEFAULT_ACTIVATORS, ...options?.activators };

  for (const id of BOOT_ENTRY_IDS) {
    gate.register(id, "loading");
  }

  for (const id of BOOT_ENTRY_IDS) {
    if (options?.forceFail === id) {
      gate.mark(id, "failed");
      return;
    }
    try {
      activators[id](ctl);
      gate.mark(id, "active");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      gate.mark(id, "failed");
      gate.fail(`boot entry "${id}": ${msg}`);
      return;
    }
  }

  const snap = gate.getSnapshot();
  if (snap.phase === "booting") {
    const stuck = Object.entries(snap.status)
      .filter(([, s]) => s !== "active")
      .map(([id, s]) => `${id}=${s}`)
      .join(", ");
    gate.fail(`boot did not settle: ${stuck || "empty"}`);
  }
}

export function formatBootReport(gate: BootGate): string {
  const snap = gate.getSnapshot();
  const lines = [
    `phase=${snap.phase}`,
    ...Object.entries(snap.status).map(
      ([id, state]: [string, BootEntryState]) => `  ${id}: ${state}`,
    ),
  ];
  if (snap.report) lines.push(`report: ${snap.report}`);
  return lines.join("\n");
}
