/** Tool UI slot declarations and their composed component props. */
import type { HostDescriptionSource } from '@xrkseek/client-connection/client'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { ImageAttachmentRef } from '@xrkseek/xrk-attachment'
import type { ToolCallBlock } from '@xrkseek/client-runtime/client'
import type {} from '@xrkseek/client-ui-conversation/client'
import type {} from '@xrkseek/client-locale/client'

/** Owner currency of the Tool image gallery slot (same shape as message images). */
export interface ToolImagesOwnerProps {
  images: readonly { readonly attachment: ImageAttachmentRef }[]
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
  align: 'start' | 'end'
}

declare module '@xrkseek/client-ui-slots' {
  interface SlotMap {
    /**
     * Keyed atomic Tool call view, dispatched by the wire Tool name. Register
     * with `key: '<tool name>'` to own how one tool's calls render inside a
     * turn — the key domain is open (any wire tool name, including a tool your
     * own package registered), so there is no compile-time key set to pick
     * from and a typo simply never renders.
     *
     * A key the shipped composition already covers is replaced, not shared;
     * an unclaimed key falls back to the generic tool row, so registering is
     * additive for your own tool and a takeover for a shipped one. The owner
     * passes the call's identity, its frozen running-or-settled node, and the
     * expansion state (see ToolCallOwnerProps), so the view stays a pure
     * function of what the turn already knows.
     */
    'tool.call.toolview': { kind: 'keyed'; scope: 'session'; owner: ToolCallOwnerProps }
    /**
     * Durable images of a settled image-bearing Tool call. Declared as a child
     * of the `read_image` toolview; the attachment plugin fills the gallery.
     */
    'tool.call.images': { kind: 'single'; scope: 'session'; owner: ToolImagesOwnerProps }
  }
}

/** Standard owner currency supplied to every atomic Tool view. */
export interface ToolCallOwnerProps {
  /** Tool call identity, stable across running and settled forms. */
  callId: string
  /** Wire Tool name and keyed dispatch value. */
  toolName: string
  /** Frozen running call or settled result node. */
  block: ToolCallBlock
  /** Session workspace root for relative summaries. */
  cwd?: string | undefined
  /** Host account home; POSIX home-rooted summaries display as `~`. */
  home?: string | undefined
  /** Open a Tool argument path through the Host. */
  openFile: (path: string) => void
  /**
   * Session-authorized image loader for `tool.call.images` (from the chat node).
   * Optional so non-image toolviews and tests need not supply it.
   */
  loadImage?: ((attachment: ImageAttachmentRef) => Promise<string>) | undefined
  /** Inspect this call in the trajectory view when available. */
  inspect?: (() => void) | undefined
}

/** Full props of a registered atomic Tool view. */
export type ToolCallViewProps = PropsRuntime<'tool.call.toolview'>

/** Injected Host description for POSIX home-path display (hook, not frozen inject). */
export type ToolHostInfoInjected = {
  hooks: {
    /** Generation-scoped Host facts; select `info => info?.home`. */
    hostDescription: HostDescriptionSource
  }
}

/** Full props of the Tool call-tree renderer registered as a `tool-call` Chat Node. */
export type ToolTreeProps = PropsRuntime<'conversation.chat.node', 'tool-call'>
  & PropsRenderSlots<'tool.call.toolview'>
  & PropsLocale<'conversation'>
  & InjectFace<ToolHostInfoInjected>

/** Full props of the selected Tool output renderer in the details panel. */
export type ToolDetailsProps = PropsRuntime<'conversation.details.tool'>
  & PropsLocale<'conversation'>
  & InjectFace<ToolHostInfoInjected>
