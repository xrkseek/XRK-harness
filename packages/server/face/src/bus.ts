import { randomUUID } from "node:crypto";
import type { HostFrame, MuxFrame } from "./types.js";

export interface FaceBus {
  subscribeMux(listener: (rpcId: string, frame: MuxFrame) => void): () => void;
  subscribeHost(listener: (rpcId: string, frame: HostFrame) => void): () => void;
  publishMux(frame: MuxFrame): void;
  publishHost(frame: HostFrame): void;
}

export function createFaceBus(): FaceBus {
  const mux = new Set<(rpcId: string, frame: MuxFrame) => void>();
  const host = new Set<(rpcId: string, frame: HostFrame) => void>();
  return {
    subscribeMux(listener) {
      mux.add(listener);
      return () => {
        mux.delete(listener);
      };
    },
    subscribeHost(listener) {
      host.add(listener);
      return () => {
        host.delete(listener);
      };
    },
    publishMux(frame) {
      const rpcId = randomUUID();
      for (const l of mux) l(rpcId, frame);
    },
    publishHost(frame) {
      const rpcId = randomUUID();
      for (const l of host) l(rpcId, frame);
    },
  };
}
