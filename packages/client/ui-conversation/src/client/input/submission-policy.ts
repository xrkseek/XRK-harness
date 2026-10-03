/**
 * Composer + chat-tool UI preferences. Owns live busy-Enter and tools-default-
 * expanded stores; Host and Agent keep delivery-window authority for Enter.
 */
import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@xrkseek/client-runtime/client'
import type {
  BusyEnterBehavior, ComposerSubmitGesture, InputSubmitMode,
} from '../contract/composer-submission.ts'
import {
  BUSY_ENTER_FIELD,
  DEFAULT_BUSY_ENTER_BEHAVIOR,
  DEFAULT_TOOLS_DEFAULT_EXPANDED,
  TOOLS_DEFAULT_EXPANDED_FIELD,
} from '../../submission-settings.ts'
import type { ConversationSettings } from '../../submission-settings.ts'
import { resolveSubmitMode } from './resolve-submit-mode.ts'

export { DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_TOOLS_DEFAULT_EXPANDED } from '../../submission-settings.ts'
export { resolveSubmitMode } from './resolve-submit-mode.ts'

/**
 * Preference face shared by the composer bar, Settings rows, and (via
 * `ctx.provide`) ToolCallTree inject: one live store pair backed by the Host
 * user-settings document when composed.
 */
export class ComposerSubmissionPolicy {
  /** Reactive preference source for the composer bar and the Settings row. */
  readonly busyEnter: SnapshotStore<BusyEnterBehavior> = createSnapshotStore(DEFAULT_BUSY_ENTER_BEHAVIOR)
  /** When true, chat tool rows mount expanded. */
  readonly toolsDefaultExpanded: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_TOOLS_DEFAULT_EXPANDED)
  private readonly host: SettingsScope<ConversationSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime — a disposed scope never publishes again, so
   * the policy needs no release hook.
   */
  constructor(host?: SettingsScope<ConversationSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Resolve one keyboard gesture without changing state.
   * @param running - whether the addressed agent currently reports busy.
   * @param gesture - plain Enter or the Cmd/Ctrl-accelerated chord.
   * @param steeringAvailable - whether this session transport supports steering.
   * @returns Queue outside steer-capable busy state; otherwise the preferred mode or its opposite.
   */
  resolve(
    running: boolean,
    gesture: ComposerSubmitGesture,
    steeringAvailable: boolean,
    followSteer = false,
  ): InputSubmitMode {
    return resolveSubmitMode(
      this.busyEnter.getSnapshot(),
      running,
      gesture,
      steeringAvailable,
      followSteer,
    )
  }

  /**
   * Change the busy-state submission behavior; the live value publishes
   * before the durable write starts.
   * @param behavior - Queue or Steer.
   */
  setBusyEnter(behavior: BusyEnterBehavior): void {
    if (this.busyEnter.getSnapshot() === behavior) return
    this.busyEnter.set(behavior)
    void this.host?.set(BUSY_ENTER_FIELD, behavior)
  }

  /**
   * Change whether chat tool rows start expanded.
   * @param expanded - true → mount open; false → collapsed (default).
   */
  setToolsDefaultExpanded(expanded: boolean): void {
    if (this.toolsDefaultExpanded.getSnapshot() === expanded) return
    this.toolsDefaultExpanded.set(expanded)
    void this.host?.set(TOOLS_DEFAULT_EXPANDED_FIELD, expanded)
  }

  /**
   * Adopt the scope's accepted durable behavior without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<ConversationSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined) return
    if (
      section.busyEnter !== undefined
      && this.busyEnter.getSnapshot() !== section.busyEnter
    ) {
      this.busyEnter.set(section.busyEnter)
    }
    if (
      typeof section.toolsDefaultExpanded === 'boolean'
      && this.toolsDefaultExpanded.getSnapshot() !== section.toolsDefaultExpanded
    ) {
      this.toolsDefaultExpanded.set(section.toolsDefaultExpanded)
    }
  }
}
