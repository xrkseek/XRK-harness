/**
 * Client-face of the remotes assembly: wire contracts from connection, plus
 * the plugin-inventory snapshot the settings UI reads. Host `/remote`
 * generators are not copied into this tree; their type merges are pulled from
 * the already-copied domain packages, with plugin-inventory inlined here.
 */
export type {
  ClientResponse, ConfigurableProviderView, ConnectionHandle, ConnectionSinks, ContentBlock,
  CredentialView, DirectoryListing, DiscoveredModelView, HistoryEntry, HostFrame, IApiClient,
  MessageId, ModelCatalogFailure, ModelProviderGroup, ModelReasoningEffort, ModelSelection,
  MuxFrame, PromptContentPart, QuestionResponsePayload, QueueAction, RpcError, RpcId, RpcReceipt,
  RpcRequest, RpcResponse, RpcResult, SessionId, SessionModels, SessionSearchItem,
  SessionSummary, SettingsNamespaceView, SettingsPathOpView, SkillEntry, StreamChunk,
  SubagentAddress, SubagentCatalog, JobView, ToolCallView, ToolEventView, ToolResultView,
  WorkspaceId, WorkspaceView, ConnectionConfig, ConnectionState,
} from '@xrkseek/client-connection/client'

export type { TypertClientRemote as ClientRemote } from '@xrkseek/xrk-typert-protocol'
export type { JsonValue } from '@xrkseek/xrk-session/types'
export type { ApiRemoteForwardedEvent } from './types.d.ts'

export type {} from '@xrkseek/xrk-commands/remote'
export type {} from '@xrkseek/xrk-goal/remote'
export type {} from '@xrkseek/xrk-message-feedback/remote'
export type {} from '@xrkseek/xrk-commands/types'
export type {} from '@xrkseek/xrk-llm/types'
export type {} from '@xrkseek/xrk-settings/types'
export type { FileReferenceCandidate } from '@xrkseek/xrk-file-reference/types'
export type { SessionReferenceMentionCandidate } from '@xrkseek/xrk-session-reference/types'

import type { Branded } from '@xrkseek/xrk-brand'
import type { RemoteResult, TypertClientRemote } from '@xrkseek/xrk-typert-protocol'
import type { CommandDescriptor, CommandExecution } from '@xrkseek/xrk-commands/types'
import type { FileReferenceCandidate } from '@xrkseek/xrk-file-reference/types'
import type { SessionReferenceMentionCandidate } from '@xrkseek/xrk-session-reference/types'
import type { SessionId } from '@xrkseek/xrk-session/types'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  readonly moduleName: string
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
}

declare module '@xrkseek/xrk-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    /** Face-bound slash-command Remote (see api-remotes `$bindFace`). */
    commands: {
      execute: (
        agentId: SessionId,
        line: string,
        signal?: AbortSignal,
      ) => Promise<RemoteResult<CommandExecution | undefined>>
      list: (agentId: SessionId) => Promise<RemoteResult<readonly CommandDescriptor[]>>
    }
    pluginInventory: {
      list: () => Promise<RemoteResult<PluginInventorySnapshot>>
    }
    fileReferences: {
      list: (
        agentId: SessionId,
        query: string,
        signal?: AbortSignal,
      ) => Promise<RemoteResult<readonly FileReferenceCandidate[]>>
    }
    sessionReferenceResolver: {
      candidates: (
        agentId: SessionId,
        query: string,
        signal?: AbortSignal,
      ) => Promise<RemoteResult<readonly SessionReferenceMentionCandidate[]>>
    }
  }
}

declare module '@xrkseek/cordis' {
  interface Context {
    remote: TypertClientRemote
  }
}
