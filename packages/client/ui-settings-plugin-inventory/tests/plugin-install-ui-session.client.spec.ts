import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPluginInstallUiSnapshot,
  resetPluginInstallUiSessionForTests,
  runPluginInstallUi,
  subscribePluginInstallUi,
} from "../src/client/plugin-install-ui-session.ts";

afterEach(() => {
  resetPluginInstallUiSessionForTests();
});

describe("plugin-install-ui-session", () => {
  it("keeps busy + streaming log after subscriber churn (Settings remount)", async () => {
    const deferred = Promise.withResolvers<{
      command: string;
      output: string;
      exitCode: number;
    }>();
    let pushLog: ((text: string) => void) | undefined;
    const seen: boolean[] = [];
    const unsubA = subscribePluginInstallUi(() => {
      seen.push(getPluginInstallUiSnapshot().busy);
    });

    const run = runPluginInstallUi({
      spec: "@fixture/pkg",
      install: async () => deferred.promise,
      subscribeInstallLog: (_id, onText) => {
        pushLog = onText;
        return () => {
          pushLog = undefined;
        };
      },
    });

    await Promise.resolve();
    expect(getPluginInstallUiSnapshot().busy).toBe(true);
    expect(getPluginInstallUiSnapshot().log?.command).toContain("@fixture/pkg");
    unsubA();

    // Remount: new subscriber still sees in-flight state.
    const snapOnMount = getPluginInstallUiSnapshot();
    expect(snapOnMount.busy).toBe(true);
    expect(snapOnMount.log?.output).toBe("");

    pushLog?.("downloading…\n");
    expect(getPluginInstallUiSnapshot().log?.output).toContain("downloading");

    deferred.resolve({
      command: "xrkh plugin add @fixture/pkg",
      output: "downloading…\nok\n",
      exitCode: 0,
    });
    await run;

    expect(getPluginInstallUiSnapshot().busy).toBe(false);
    expect(getPluginInstallUiSnapshot().success).toBe(true);
    expect(getPluginInstallUiSnapshot().clientRefreshHint).toBe(true);
    expect(seen.some(Boolean)).toBe(true);
  });

  it("preserves success refresh hint across resets of settled log only via clear", async () => {
    await runPluginInstallUi({
      spec: "done-pkg",
      install: async () => ({
        command: "xrkh plugin add done-pkg",
        output: "ok",
        exitCode: 0,
      }),
    });
    expect(getPluginInstallUiSnapshot().clientRefreshHint).toBe(true);
    expect(getPluginInstallUiSnapshot().success).toBe(true);

    const { clearPluginInstallSettledUi } = await import(
      "../src/client/plugin-install-ui-session.ts"
    );
    clearPluginInstallSettledUi();
    expect(getPluginInstallUiSnapshot().success).toBe(false);
    expect(getPluginInstallUiSnapshot().log).toBeNull();
    // Refresh CTA must survive field edits after a finished install.
    expect(getPluginInstallUiSnapshot().clientRefreshHint).toBe(true);
  });
});
