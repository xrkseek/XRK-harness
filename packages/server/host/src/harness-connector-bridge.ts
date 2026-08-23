/**
 * Face → harness connector (AI Office) job admission bridge.
 */
import { dispatchFaceMethod, type FaceRuntime } from "@xrkseek/server-face";

export interface HarnessConnectorJob {
  readonly id: string;
  readonly workspace?: string;
  readonly instruction?: string;
}

export function createHarnessConnectorBridgeFromFace(face: FaceRuntime): {
  readonly onJobAccepted: (
    job: HarnessConnectorJob,
  ) => Promise<{ sessionId?: string }>;
} {
  return {
    onJobAccepted: async (job) => {
      const sessionId = `office-${job.id}`;
      const created = await dispatchFaceMethod(face, "session.create", `hc-${job.id}`, {
        sessionId,
        ...(job.workspace ? { cwd: job.workspace } : {}),
        label: "office",
      });
      if (!created.result.ok) {
        return {};
      }
      const resolved =
        typeof created.result.value === "object" &&
        created.result.value &&
        "sessionId" in created.result.value
          ? String((created.result.value as { sessionId: string }).sessionId)
          : sessionId;
      const instruction = job.instruction?.trim();
      if (instruction) {
        await dispatchFaceMethod(face, "session.prompt", `hc-p-${job.id}`, {
          sessionId: resolved,
          mode: "queue",
          content: [{ type: "text", text: instruction }],
        });
      }
      return { sessionId: resolved };
    },
  };
}
