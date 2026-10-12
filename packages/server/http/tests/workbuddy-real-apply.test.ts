/**
 * Optional smoke against the local community-plugin-mirror WorkBuddy pack.
 * Skips when the pack is not present (CI / clean machines).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tryApplyWorkBuddyHost } from "../src/dsh-compat/workbuddy-host.js";
import { resetHostApplyRegistry } from "../src/dsh-compat/host-apply-registry.js";

const MIRROR_WB = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".xrk/community-plugin-mirror/packs/dsh-workbuddy-connect/package",
);

const hasMirror =
  Boolean(process.env.USERPROFILE || process.env.HOME) &&
  existsSync(path.join(MIRROR_WB, "lib", "index.js"));

afterEach(() => {
  resetHostApplyRegistry();
});

describe.skipIf(!hasMirror)("workbuddy-host real pack", () => {
  it("applies mirrored dsh-workbuddy-connect and syncs at least one provider", async () => {
    const syncCommunityLlmProvider = vi.fn(async () => undefined);
    const contribution = await tryApplyWorkBuddyHost(
      MIRROR_WB,
      "dsh-workbuddy-connect",
      { syncCommunityLlmProvider },
    );
    expect(contribution).toBeDefined();
    expect(contribution?.meta.id).toBe("dsh-workbuddy-connect-host");
    expect((contribution?.http?.length ?? 0) > 0).toBe(true);
    await vi.waitFor(
      () => {
        expect(syncCommunityLlmProvider).toHaveBeenCalled();
      },
      { timeout: 15_000 },
    );
    const arg = syncCommunityLlmProvider.mock.calls[0]?.[0] as {
      providerId: string;
      baseUrl: string;
      models: readonly { id: string }[];
    };
    expect(arg.providerId).toMatch(/workbuddy/i);
    expect(arg.baseUrl).toMatch(/^https?:\/\/127\.0\.0\.1:\d+/);
    expect(arg.models.length).toBeGreaterThan(0);
  }, 20_000);
});
