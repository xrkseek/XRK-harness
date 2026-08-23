/**
 * File-backed harness connector job index (~/.xrk/harness-connector/jobs.json).
 */
import { createXrkDocStore } from "./underlying/doc-store.js";

export interface ConnectorJobRecord {
  readonly id: string;
  readonly state: "pending" | "accepted" | "running" | "completed" | "failed";
  readonly workspace?: string;
  readonly instruction?: string;
  readonly progress: number;
  readonly result?: unknown;
  readonly error?: string;
  readonly updatedAt: string;
}

interface ConnectorJobIndex {
  jobs: Record<string, ConnectorJobRecord>;
}

const JOB_STORE = createXrkDocStore<ConnectorJobIndex>(
  ["harness-connector", "jobs.json"],
  { jobs: {} },
);

const HEARTBEAT_STORE = createXrkDocStore<{ at: number }>(
  ["harness-connector", "heartbeat.json"],
  { at: 0 },
);

const memoryJobs = new Map<string, ConnectorJobRecord>();

function useMemory(xrkHome: string | undefined): boolean {
  return !xrkHome?.trim();
}

function readIndex(xrkHome: string | undefined) {
  if (useMemory(xrkHome)) {
    const jobs: Record<string, ConnectorJobRecord> = {};
    for (const [id, row] of memoryJobs) jobs[id] = row;
    return { revision: 0, updatedAt: new Date(0).toISOString(), data: { jobs } };
  }
  return JOB_STORE.read(xrkHome);
}

function writeIndex(xrkHome: string | undefined, index: ConnectorJobIndex) {
  if (useMemory(xrkHome)) {
    memoryJobs.clear();
    for (const [id, row] of Object.entries(index.jobs)) {
      memoryJobs.set(id, row);
    }
    return {
      revision: 0,
      updatedAt: new Date().toISOString(),
      data: index,
    };
  }
  return JOB_STORE.write(xrkHome, index);
}

export function getConnectorJob(
  jobId: string,
  xrkHome?: string,
): ConnectorJobRecord | undefined {
  const index = readIndex(xrkHome);
  return index.data.jobs[jobId];
}

export function upsertConnectorJob(
  job: ConnectorJobRecord,
  xrkHome?: string,
): ConnectorJobRecord {
  const index = readIndex(xrkHome);
  const next: ConnectorJobIndex = {
    jobs: { ...index.data.jobs, [job.id]: job },
  };
  writeIndex(xrkHome, next);
  return job;
}

export function listConnectorJobs(xrkHome?: string): readonly ConnectorJobRecord[] {
  const index = readIndex(xrkHome);
  return Object.values(index.data.jobs).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function connectorJobSummary(xrkHome?: string): {
  total: number;
  active: number;
  completed: number;
  failed: number;
} {
  const rows = listConnectorJobs(xrkHome);
  let active = 0;
  let completed = 0;
  let failed = 0;
  for (const row of rows) {
    if (
      row.state === "pending" ||
      row.state === "accepted" ||
      row.state === "running"
    ) {
      active += 1;
    } else if (row.state === "completed") {
      completed += 1;
    } else if (row.state === "failed") {
      failed += 1;
    }
  }
  return { total: rows.length, active, completed, failed };
}

export function touchConnectorHeartbeat(xrkHome?: string): number {
  const at = Date.now();
  if (useMemory(xrkHome)) return at;
  HEARTBEAT_STORE.write(xrkHome, { at });
  return at;
}

export function readConnectorHeartbeat(xrkHome?: string): number | null {
  if (useMemory(xrkHome)) return null;
  const at = HEARTBEAT_STORE.read(xrkHome).data.at;
  return typeof at === "number" ? at : null;
}
