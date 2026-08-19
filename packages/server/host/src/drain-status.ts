/**
 * DSH `agent/status` → `host/session-status`: running:true on wake;
 * running:false after drain body exits and latch settle completes.
 */

import type { AgentRunResult } from "@xrkseek/core-agent";
import type { SessionDrainHub } from "@xrkseek/core-session";

/** Host-side drain control (admit wake / resume join). */
export interface SessionDrainControl {
  run(sessionId: string): Promise<AgentRunResult | undefined>;
  wake(sessionId: string): void;
  cancel(sessionId: string): Promise<void>;
  isActive(sessionId: string): boolean;
}

export function wireDrainStatus(
  hub: SessionDrainHub,
  publish: (sessionId: string, running: boolean) => void,
  lastResult: Map<string, AgentRunResult | undefined>,
): SessionDrainControl {
  return {
    async run(sessionId) {
      await hub.run(sessionId);
      return lastResult.get(sessionId);
    },
    wake(sessionId) {
      const was = hub.isActive(sessionId);
      hub.wake(sessionId);
      if (!was && hub.isActive(sessionId)) publish(sessionId, true);
    },
    cancel(sessionId) {
      return hub.cancel(sessionId);
    },
    isActive(sessionId) {
      return hub.isActive(sessionId);
    },
  };
}

/** Host drain body `finally`: latch settle runs after this, so defer one tick. */
export function publishDrainIdle(
  hub: SessionDrainHub,
  sessionId: string,
  publish: (sessionId: string, running: boolean) => void,
): void {
  setTimeout(() => {
    if (!hub.isActive(sessionId)) publish(sessionId, false);
  }, 0);
}
