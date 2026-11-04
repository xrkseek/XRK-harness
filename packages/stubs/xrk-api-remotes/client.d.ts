/**
 * Client-face of the remotes assembly: wire contracts from connection, plus
 * the plugin-inventory snapshot the settings UI reads. Host `/remote`
 * generators are not copied into this tree; their type merges are pulled from
 * the already-copied domain packages, with plugin-inventory inlined here.
 */
export type {
  ClientResponse, ConfigurableProviderView, ConnectionHandle, ConnectionSinks, ContentBlock,
  CredentialView, DirectoryEntry, DirectoryListing, DirectoryPlace, DiscoveredModelView, HistoryEntry, HostFrame, IApiClient,
  MessageId, ModelCatalogFailure, ModelProviderGroup, ModelReasoningEffort, ModelSelection,
  MuxFrame, PromptContentPart, QuestionResponsePayload, QueueAction, RpcError, RpcId, RpcReceipt,
  RpcRequest, RpcResponse, RpcResult, SessionId, SessionModels, SessionSearchItem,
  SessionSummary, SettingsNamespaceView, SettingsPathOpView, SkillEntry, StreamChunk,
  SubagentAddress, SubagentCatalog, BandNode, BandSnapshot, JobView, ToolCallView, ToolEventView, ToolResultView,
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

/** Per-file comparison returned by Face `changes/fileDiff` (protocol WorkspaceFileDiff). */
export type WorkspaceFileDiff =
  | {
      readonly kind: 'text'
      readonly path: string
      readonly display: string
      readonly before: boolean
      readonly after: boolean
      readonly hunks: readonly {
        readonly oldStart: number
        readonly oldLines: number
        readonly newStart: number
        readonly newLines: number
        readonly lines: readonly string[]
      }[]
      readonly coarse: boolean
    }
  | { readonly kind: 'binary'; readonly path: string; readonly display: string }
  | { readonly kind: 'oversized'; readonly path: string; readonly display: string }

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
  /** User-installed — Settings may offer edit / disable / delete. */
  readonly managed: boolean
  /** CLI inventory version when known. */
  readonly version?: string
  /** `client` | `process` | `both` | `mcp` | `cordis` | `builtin`. */
  readonly kind?: string
  /** Original install spec when managed. */
  readonly source?: string
  /** Disk toggle differs from this Host live set — restart to apply. */
  readonly needsRestart?: boolean
}

/**
 * One composition capability under a session agent preset.
 * XRK badges select a tool surface (not a Cordis plugin tree); `moduleName`
 * uses the `composition:*` namespace for those rows.
 */
export interface AgentPresetPluginRow {
  readonly entryId: string | null
  readonly moduleName: string
  readonly enabled: boolean | 'conditional'
  readonly condition?: string
  readonly fiberPhase: PluginFiberPhase
}

/** One session badge's composition inventory group. */
export interface AgentPresetPluginGroup {
  readonly id: string
  readonly name?: string
  readonly isDefault: boolean
  readonly broken?: string
  readonly rows: readonly AgentPresetPluginRow[]
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
  /** Session badge compositions; omitted only when Face has no catalog. */
  readonly agentPresets?: readonly AgentPresetPluginGroup[]
}

/** Whether this Host's platform can run the local speech engine at all. */
export interface VoiceLocalEngine {
  readonly supported: boolean
  /** `${process.platform}-${process.arch}` of the Host. */
  readonly platform: string
  /** The optional native binding resolved and exported a recognizer. */
  readonly engine: boolean
  /** Why it cannot run, in the Host's own words (shown verbatim). */
  readonly reason?: string
}

/** One local-engine preparation task's live state. */
export interface VoicePrepareState {
  readonly phase: 'idle' | 'preparing' | 'ready' | 'failed'
  /** Asset id in flight; null when idle or ready. */
  readonly current: string | null
  readonly bytesDone: number
  readonly bytesTotal: number
  readonly speedBps: number
  readonly origin: string | null
  readonly failure: {
    readonly code: string
    readonly message: string
    readonly origin?: string
  } | null
}

/** Local STT readiness as the Settings card sees it. */
export interface VoiceLocalInspect {
  /** Where the weights must live. */
  readonly dataRoot: string
  /** Weights on disk AND a binding that can run them. */
  readonly ready: boolean
  readonly assets: {
    readonly ready: boolean
    /** Basenames still absent (empty when ready). */
    readonly missing: readonly string[]
    readonly totalBytes: number
  }
  readonly engine: VoiceLocalEngine
  /**
   * `asr.downloadProxy` as the Host parsed it. Absent on Hosts that predate
   * the field; a present-but-invalid value means the downloader will refuse
   * to run rather than silently go direct.
   */
  readonly proxy?: {
    readonly text: string
    readonly valid: boolean
    /** Why the text cannot be used; null when it parses or is empty. */
    readonly error: string | null
    /** `host:port` the tunnel uses; null when there is no usable target. */
    readonly target: string | null
  }
  readonly prepare: VoicePrepareState
}

/** One OS voice the local TTS engine can speak with. */
export interface VoiceSystemVoice {
  /** Value a card writes into `tts.voice`. */
  readonly id: string
  /** Human label, usually `Name (locale)`. */
  readonly label: string
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
    /**
     * Face session Remote (`session.list` …). Provided as Cordis
     * `remote.session` so community clients (e.g. dsh-workbuddy-connect) activate.
     */
    session: {
      list: (args?: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      create: (args?: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      history: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      search: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      models: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      /** DSH alias → Face `session.models`. */
      modelCatalog: (args?: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      /** DSH alias → Face `session.history`. */
      page: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      selectModel: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      rename: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      fork: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      truncate: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      prompt: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      cancel: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      delete: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      updateQueue: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      status: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      attachment: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      respondApproval: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      setWorkingDirectory: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
      rolloutTrace: (args: Record<string, unknown>) => Promise<RemoteResult<unknown>>
    }
    /**
     * Face composer dictation Remote. The clip arrives base64 (16 kHz mono
     * PCM WAV unless `mimeType` says otherwise) and the Host owns the
     * Provider credential, so a browser never holds an API key. Settings
     * `asr.enabled` gates it exactly like the speak tool: off fails
     * with `voice-unavailable` rather than recording into a void.
     */
    voice: {
      transcribe: (args: {
        /** Recorded clip as base64, no `data:` prefix. */
        audio: string
        mimeType?: string
        /** BCP-47 / ISO hint; a backend may ignore it. */
        language?: string
        filename?: string
        /**
         * Settings probe (`Try a sentence`). Bypasses the `asr.enabled` gate so
         * an engine can be verified before the switch is saved.
         */
        probe?: boolean
      }) => Promise<RemoteResult<{
        text: string
        provider: string
        delivery: string
        /** True when the backend heard nothing usable (silence / noise). */
        noSpeech?: boolean
      }>>
      /** Local-engine readiness for Settings → Plugins → Voice. */
      inspect: () => Promise<RemoteResult<VoiceLocalInspect>>
      /**
       * Start (or join) the one-press download. Answers immediately with the
       * task snapshot — the transfer outlives the call, so poll `prepareStatus`.
       */
      prepare: () => Promise<RemoteResult<VoicePrepareState>>
      /** Poll target while a transfer runs. */
      prepareStatus: () => Promise<RemoteResult<VoicePrepareState>>
      /** Abort and settle the task as cancelled. */
      prepareCancel: () => Promise<RemoteResult<VoicePrepareState>>
      /**
       * OS voices the local TTS engine can speak with. Best-effort: a platform
       * with no enumerable list answers `[]` and the card falls back to a
       * free-text voice field.
       */
      voices: () => Promise<RemoteResult<{ readonly voices: readonly VoiceSystemVoice[] }>>
    }
    pluginInventory: {
      list: () => Promise<RemoteResult<PluginInventorySnapshot>>
      setEnabled: (
        entryId: PluginEntryId,
        enabled: boolean,
      ) => Promise<RemoteResult<{ entryId: PluginEntryId; enabled: boolean }>>
      remove: (
        entryId: PluginEntryId,
      ) => Promise<RemoteResult<{ entryId: PluginEntryId; removed: true }>>
      update: (
        entryId: PluginEntryId,
        /** Correlates live `plugin-inventory/install-log` chunks. */
        requestId?: string,
      ) => Promise<RemoteResult<{
        entryId: PluginEntryId
        updated: true
        /** Settled CLI mutate log (`xrkh plugin add …`). */
        command?: string
        output?: string
        exitCode?: number
      }>>
      reload: (
        entryId: PluginEntryId,
      ) => Promise<RemoteResult<{ entryId: PluginEntryId; reloaded: true }>>
      install: (
        spec: string,
        /** Optional npm registry URL (`npm pack --registry`). */
        registry?: string,
        /** Correlates live `plugin-inventory/install-log` chunks. */
        requestId?: string,
        /** Optional HTTP(S) proxy for this `npm pack` only (`xrkh plugin add --proxy`). */
        proxy?: string,
      ) => Promise<RemoteResult<{
        spec: string
        installed: true
        /** Settled CLI mutate log (`xrkh plugin add …`). */
        command: string
        output: string
        exitCode: number
      }>>
      open: (
        entryId: PluginEntryId,
      ) => Promise<RemoteResult<{ entryId: PluginEntryId; opened: true }>>
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
    changes: {
      fileDiff: (
        args: {
          readonly sessionId?: SessionId
          readonly agentId?: SessionId
          readonly seq: number
          readonly index: number
        },
        signal?: AbortSignal,
      ) => Promise<RemoteResult<{ readonly diff: WorkspaceFileDiff | null }>>
    }
    canvas: {
      list: (
        args: {
          readonly sessionId?: SessionId
          readonly agentId?: SessionId
        },
        signal?: AbortSignal,
      ) => Promise<RemoteResult<{
        readonly workspaceId: string
        readonly generation: number
        readonly items: readonly {
          readonly id: string
          readonly title: string
          readonly revision: number
          readonly updatedAt: string
        }[]
      }>>
      get: (
        args: {
          readonly sessionId?: SessionId
          readonly agentId?: SessionId
          readonly id: string
        },
        signal?: AbortSignal,
      ) => Promise<RemoteResult<{
        readonly workspaceId: string
        readonly canvas: {
          readonly id: string
          readonly title: string
          readonly revision: number
          readonly createdAt: string
          readonly updatedAt: string
          readonly sections: readonly unknown[]
        } | null
      }>>
    }
    threads: {
      list: (
        args: { readonly sessionId?: SessionId; readonly agentId?: SessionId },
        signal?: AbortSignal,
      ) => Promise<RemoteResult<{
        readonly workspaceId: string
        readonly threads: readonly {
          readonly id: string
          readonly title: string
          readonly brief: string
          readonly updatedAt: number
        }[]
        readonly bind: { readonly threadId: string; readonly sideline?: string } | null
      }>>
      upsert: (
        args: {
          readonly sessionId?: SessionId
          readonly agentId?: SessionId
          readonly id?: string
          readonly title: string
          readonly brief?: string
          readonly switch?: boolean
        },
        signal?: AbortSignal,
      ) => Promise<RemoteResult<{
        readonly workspaceId: string
        readonly thread: {
          readonly id: string
          readonly title: string
          readonly brief: string
          readonly updatedAt: number
        }
      }>>
      switch: (
        args: {
          readonly sessionId?: SessionId
          readonly agentId?: SessionId
          readonly id: string
        },
        signal?: AbortSignal,
      ) => Promise<RemoteResult<{
        readonly workspaceId: string
        readonly bind: { readonly threadId: string; readonly sideline?: string }
      }>>
      remove: (
        args: {
          readonly sessionId?: SessionId
          readonly agentId?: SessionId
          readonly id: string
        },
        signal?: AbortSignal,
      ) => Promise<RemoteResult<{
        readonly workspaceId: string
        readonly deleted: true
        readonly id: string
      }>>
    }
    team: {
      list: (
        args: { readonly sessionId?: SessionId; readonly agentId?: SessionId },
        signal?: AbortSignal,
      ) => Promise<RemoteResult<{
        readonly workspaceId: string
        readonly members: readonly {
          readonly id: string
          readonly name: string
          readonly playbook: string
          readonly role: string
          readonly seed?: true
          readonly catalog?: true
          readonly updatedAt: number
          readonly appearance?: {
            readonly shape: string
            readonly color: string
            readonly kit?: string
            readonly kitHat?: string
            readonly kitGlasses?: string
            readonly kitHeld?: string
            readonly face?: string
            readonly overlayHat?: string
            readonly overlayGlasses?: string
            readonly overlayHeld?: string
          }
          readonly scope?: string
          /** Owning project workspace when scope is workspace. */
          readonly workspaceId?: string
          readonly brief?: string
          readonly inject?: string
          readonly tools?: { readonly mode: string; readonly names: readonly string[] }
          readonly kind?: 'thin' | 'advanced'
          readonly ready?: boolean
          readonly envPrep?: string
          readonly envHint?: string
          readonly packDir?: string
        }[]
      }>>
      upsert: (
        args: {
          readonly sessionId?: SessionId
          readonly name: string
          readonly playbook: string
          readonly role?: string
          readonly id?: string
          readonly shape?: string
          readonly color?: string
          readonly kit?: string
          readonly face?: string
          readonly overlayHat?: string
          readonly overlayGlasses?: string
          readonly overlayHeld?: string
          readonly kitHat?: string
          readonly kitGlasses?: string
          readonly kitHeld?: string
          readonly appearance?: {
            readonly shape?: string
            readonly color?: string
            readonly kit?: string
            readonly kitHat?: string
            readonly kitGlasses?: string
            readonly kitHeld?: string
            readonly face?: string
            readonly overlayHat?: string
            readonly overlayGlasses?: string
            readonly overlayHeld?: string
          }
          readonly scope?: string
          readonly brief?: string
          readonly inject?: string
          readonly tools?: { readonly mode: string; readonly names: readonly string[] } | null
          readonly kind?: 'thin' | 'advanced'
          readonly ready?: boolean
        },
        signal?: AbortSignal,
      ) => Promise<RemoteResult<{ readonly workspaceId: string; readonly member: unknown }>>
      remove: (
        args: { readonly sessionId?: SessionId; readonly id: string; readonly scope?: string },
        signal?: AbortSignal,
      ) => Promise<RemoteResult<{ readonly workspaceId: string; readonly deleted: true; readonly id: string }>>
      capture: (
        args: { readonly sessionId?: SessionId; readonly name?: string },
        signal?: AbortSignal,
      ) => Promise<RemoteResult<{ readonly workspaceId: string; readonly member: unknown }>>
      dispatch: (
        args: {
          readonly sessionId?: SessionId
          readonly memberId: string
          readonly task: string
        },
        signal?: AbortSignal,
      ) => Promise<RemoteResult<{
        readonly workspaceId: string
        readonly memberId: string
        readonly childSessionId: string
      }>>
      export: (
        args: {
          readonly sessionId?: SessionId
          readonly id: string
        },
        signal?: AbortSignal,
      ) => Promise<RemoteResult<{
        readonly format: 'json' | 'zip'
        readonly fileName: string
        readonly text?: string
        readonly base64?: string
        readonly packIncomplete?: boolean
        readonly hint?: string
      }>>
      importPack: (
        args: {
          readonly sessionId?: SessionId
          readonly scope?: string
          readonly zipBase64: string
        },
        signal?: AbortSignal,
      ) => Promise<RemoteResult<{
        readonly workspaceId: string
        readonly member: unknown
        readonly packDir?: string
        readonly skillNames?: readonly string[]
        readonly envPrep?: string
        readonly ready?: boolean
      }>>
    }
  }
}

declare module '@xrkseek/cordis' {
  interface Context {
    remote: TypertClientRemote
  }
}
