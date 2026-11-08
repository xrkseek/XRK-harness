import { describe, expect, it } from "vitest";
import { collectArchiveActivity } from "../src/session-archive-activity.js";
import type { FaceRuntime } from "../src/context.js";

function runtimeStub(input: {
  readonly latch: boolean;
  readonly uiIdle: boolean;
  readonly jobs?: readonly { id: string; status: string; command?: string }[];
}): FaceRuntime {
  return {
    drain: {
      isActive: () => input.latch,
    },
    isTurnUiIdle: () => input.uiIdle,
    shell: input.jobs
      ? {
          listJobsNow: () => input.jobs,
        }
      : undefined,
    subagents: {
      list: () => [],
    },
  } as unknown as FaceRuntime;
}

describe("collectArchiveActivity", () => {
  it("ignores a drain latch when the turn UI is already idle", () => {
    expect(
      collectArchiveActivity(
        runtimeStub({ latch: true, uiIdle: true }),
        "s1",
      ),
    ).toEqual([]);
  });

  it("reports a live turn when latch is held and UI is not idle", () => {
    expect(
      collectArchiveActivity(
        runtimeStub({ latch: true, uiIdle: false }),
        "s1",
      ),
    ).toEqual([
      {
        kind: "turn",
        id: "s1",
        title: "session turn running",
      },
    ]);
  });
});
