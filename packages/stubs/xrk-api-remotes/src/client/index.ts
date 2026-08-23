/**
 * Face Client remotes assembly: mount commands / goals / pluginInventory /
 * messageFeedback / dynamicCordisRunner onto `ctx.remote` via the Face gateway.
 * Type-only Cordis; no value import of the gateway (bundle purity).
 */

import type { Context } from '@xrkseek/cordis'

/** One Face namespace: method name → positional wire fields, or `'args'` bag. */
type FaceArgSpec = readonly string[] | 'args'
type FaceRemoteSpec = Record<string, Record<string, FaceArgSpec>>

interface FaceBindableRemote {
  $bindFace(spec: FaceRemoteSpec): Promise<void>
}

/** Face-native Remote methods (positional wires, or `'args'` for a single bag). */
const FACE_REMOTES: FaceRemoteSpec = {
  commands: {
    list: ['agentId'],
    execute: ['agentId', 'line'],
  },
  goals: {
    create: ['agentId', 'request'],
    edit: ['agentId', 'ref', 'request'],
    pause: ['agentId', 'ref'],
    resume: ['agentId', 'ref'],
    complete: ['agentId', 'ref'],
    clear: ['agentId', 'ref'],
  },
  pluginInventory: {
    list: [],
  },
  messageFeedback: {
    list: 'args',
    put: 'args',
    delete: 'args',
  },
  costMeter: {
    getState: [],
    updateConfig: ["patch"],
    fetchPrices: [],
    refreshBalance: [],
    refreshGoQuota: [],
    refreshCustomBalance: [],
    refreshCodingPlan: ["provider"],
    resetHistory: [],
    importLegacyHistory: [],
    getDaySessions: ["date"],
    getTopSessions: ["limit", "sort", "dir"],
  },
  dynamicCordisRunner: {
    inventory: [],
    syncInspectManifest: 'args',
    reportRenderFailure: 'args',
    reportClientGuardFailure: 'args',
    resolveInspectQuery: 'args',
    resolveRequestRun: 'args',
    stopFromPanel: 'args',
    undefineFromPanel: 'args',
    invoke: 'args',
    getClientCode: 'args',
    runHostHalf: 'args',
    settleUserRun: 'args',
  },
  fileReferences: {
    list: ['agentId', 'query'],
  },
  sessionReferenceResolver: {
    candidates: ['agentId', 'query'],
  },
}

/** Required service: the Face Client Remote contribution mount. */
export const inject = ['remote']

/**
 * Mount Face-native Remote namespaces selected for this Client assembly.
 * @param ctx - Client Cordis root carrying the Remote service.
 */
export async function apply(ctx: Context): Promise<void> {
  const remote = ctx.get('remote') as FaceBindableRemote | undefined
  if (remote === undefined || typeof remote.$bindFace !== 'function') {
    throw new Error('api-remotes: Face gateway remote.$bindFace is unavailable')
  }
  await remote.$bindFace(FACE_REMOTES)
}
