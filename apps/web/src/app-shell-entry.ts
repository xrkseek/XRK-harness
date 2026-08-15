/**
 * AppShellEntry — BootComposition settle, then SlotRegistry chrome.
 */

import { activateBootComposition, formatBootReport } from "./boot-composition.js";
import { readBootManifest } from "./boot-manifest.js";
import { ShellController } from "./shell-controller.js";
import { mountShell } from "./shell/mount-shell.js";
import { el } from "./dom.js";

export class AppShellEntry {
  constructor(private readonly root: HTMLElement) {}

  run(): ShellController {
    const boot = readBootManifest();
    const ctl = new ShellController();

    if (!boot) {
      ctl.gate.fail("missing __DSH_BOOT__ / __XRK_BOOT__");
      this.renderFailure(ctl);
      return ctl;
    }

    activateBootComposition(ctl.gate, ctl);

    const snap = ctl.gate.getSnapshot();
    if (snap.phase !== "settled") {
      this.renderFailure(ctl);
      return ctl;
    }

    mountShell(this.root, ctl);
    return ctl;
  }

  private renderFailure(ctl: ShellController): void {
    this.root.innerHTML = "";
    this.root.className = "xrk-app-shell xrk-boot-failed";
    const title = el("h1", "XRK");
    const sub = el("p", "Boot did not settle — chrome not mounted.");
    const pre = el("pre", formatBootReport(ctl.gate));
    pre.className = "log";
    this.root.append(title, sub, pre);
  }
}

export function mountAppShell(root: HTMLElement): ShellController {
  return new AppShellEntry(root).run();
}
