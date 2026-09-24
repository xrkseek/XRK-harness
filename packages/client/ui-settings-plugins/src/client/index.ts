/**
 * Plugins settings surface, browser half — one section whose feature-owned
 * tabs include configurable Host plugin cards and read-only inventory.
 *
 * The section declares `settings.plugins.tab`; its own `configurable` tab then
 * declares `settings.plugin.item` and renders whatever cards were registered
 * into it. Shipped cards: MCP, shell (`bash`), agent-loop, workspace-inject, web-search,
 * session-telemetry, sandbox, computer-use, browser, voice, image-gen, video-gen,
 * curated-memory, external-agent, cron. Advanced tab: auto-review classifier · memory-embed.
 * General 「远程」: ssh-remote (restart).
 */
import type { ConnectionHandle } from '@xrkseek/client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@xrkseek/client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry)
// and the ctx.settingsScope Context merge. Cross-plugin collaboration goes
// through the service, never a value import (client bundle purity gate).
import type {} from '@xrkseek/client-ui-settings/client'
import type { ClientContext } from '@xrkseek/client-runtime/client'
import { resolveSlotLabel } from '@xrkseek/client-ui-slots'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@xrkseek/xrk-api-remotes/client'
import { AdvancedPluginsTab } from './AdvancedPluginsTab.tsx'
import { AgentLoopCard } from './AgentLoopCard.tsx'
import { AutoReviewCard } from './AutoReviewCard.tsx'
import { BashCard } from './BashCard.tsx'
import { BrowserCard } from './BrowserCard.tsx'
import { ConfigurablePluginsTab } from './ConfigurablePluginsTab.tsx'
import { ComputerUseCard } from './ComputerUseCard.tsx'
import { CronCard } from './CronCard.tsx'
import { CuratedMemoryCard } from './CuratedMemoryCard.tsx'
import { ExternalAgentCard } from './ExternalAgentCard.tsx'
import { ImageGenCard } from './ImageGenCard.tsx'
import { McpCard } from './McpCard.tsx'
import { MemoryEmbedCard } from './MemoryEmbedCard.tsx'
import { SandboxCard } from './SandboxCard.tsx'
import { SshRemoteCard } from './SshRemoteCard.tsx'
import { TelemetryCard } from './TelemetryCard.tsx'
import { VideoGenCard } from './VideoGenCard.tsx'
import { VoiceCard } from './VoiceCard.tsx'
import { WebSearchCard } from './WebSearchCard.tsx'
import { WorkspaceInjectCard } from './WorkspaceInjectCard.tsx'
import { PluginsSettingsSection } from './PluginsSettingsSection.tsx'
import type { PluginsSettingsSectionInjected, PluginsSettingsTabEntry } from './PluginsSettingsSection.tsx'
import { AGENT_LOOP_NS, AgentLoopCardController } from './agent-loop-card-controller.ts'
import {
  AUTO_REVIEW_NS,
  AUTO_REVIEW_CLASSIFIER_TOKEN_REF,
  AutoReviewCardController,
} from './auto-review-card-controller.ts'
import { SHELL_NS, BashCardController } from './bash-card-controller.ts'
import { BROWSER_NS, BrowserCardController } from './browser-card-controller.ts'
import { COMPUTER_USE_NS, ComputerUseCardController, COMPUTER_USE_BACKGROUND_REF } from './computer-use-card-controller.ts'
import { CRON_NS, CronCardController } from './cron-card-controller.ts'
import { CURATED_MEMORY_NS, CuratedMemoryCardController } from './curated-memory-card-controller.ts'
import { EXTERNAL_AGENT_NS, ExternalAgentCardController } from './external-agent-card-controller.ts'
import { IMAGE_GEN_NS, ImageGenCardController, IMAGE_GEN_OPENAI_REF } from './image-gen-card-controller.ts'
import {
  MEMORY_EMBED_NS,
  MEMORY_EMBED_TOKEN_REF,
  MemoryEmbedCardController,
} from './memory-embed-card-controller.ts'
import { SANDBOX_NS, SandboxCardController } from './sandbox-card-controller.ts'
import { SESSION_TELEMETRY_NS, TelemetryCardController } from './telemetry-card-controller.ts'
import { SSH_REMOTE_NS, SshRemoteCardController } from './ssh-remote-card-controller.ts'
import { MCP_NS, McpCardController } from './mcp-card-controller.ts'
import { VIDEO_GEN_NS, VideoGenCardController, VIDEO_GEN_OPENAI_REF } from './video-gen-card-controller.ts'
import { VOICE_NS, VoiceCardController, VOICE_OPENAI_REF } from './voice-card-controller.ts'
import { WEB_SEARCH_NS, WebSearchCardController, WEB_SEARCH_BRAVE_REF, WEB_SEARCH_TAVILY_REF } from './web-search-card-controller.ts'
import { WORKSPACE_INJECT_NS, WorkspaceInjectCardController } from './workspace-inject-card-controller.ts'
import {
  AdvancedPluginsTabController,
  asAdvancedPluginsTabFace,
} from './advanced-tab-store.ts'
import { ConfigurablePluginsTabController } from './tab-store.ts'
import { en, zh } from './locales.ts'

export type { PluginsSettingsSectionInjected, PluginsSettingsSectionProps } from './PluginsSettingsSection.tsx'
export type { ConfigurablePluginsTabProps } from './ConfigurablePluginsTab.tsx'
export type { ConfigurablePluginsTabFace, ConfigurablePluginsTabState } from './tab-store.ts'
export type { PluginCardProps } from './PluginCard.tsx'
export type { SettingsPluginItemOwnerProps } from './slot-contract.ts'
export type { FieldProps } from './fields.tsx'
export type {
  CardActions, CardFieldSpec, CardFieldState, CardSecretSpec, CardShell,
} from './card-form.ts'
export type { AgentLoopCardFace, AgentLoopCardState } from './agent-loop-card-controller.ts'
export type { BashCardFace, BashCardState } from './bash-card-controller.ts'
export type { BrowserCardFace, BrowserCardState } from './browser-card-controller.ts'
export type { ComputerUseCardFace, ComputerUseCardState } from './computer-use-card-controller.ts'
export type { CronCardFace, CronCardState } from './cron-card-controller.ts'
export type { CuratedMemoryCardFace, CuratedMemoryCardState } from './curated-memory-card-controller.ts'
export type { ExternalAgentCardFace, ExternalAgentCardState } from './external-agent-card-controller.ts'
export type { ImageGenCardFace, ImageGenCardState } from './image-gen-card-controller.ts'
export type { SandboxCardFace, SandboxCardState } from './sandbox-card-controller.ts'
export type { TelemetryCardFace, TelemetryCardState } from './telemetry-card-controller.ts'
export type { SshRemoteCardFace, SshRemoteCardState } from './ssh-remote-card-controller.ts'
export type { AutoReviewCardFace, AutoReviewCardState } from './auto-review-card-controller.ts'
export type { MemoryEmbedCardFace, MemoryEmbedCardState } from './memory-embed-card-controller.ts'
export type { AdvancedPluginsTabFace, AdvancedPluginsTabState } from './advanced-tab-store.ts'
export type { SettingsPluginAdvancedItemOwnerProps } from './advanced-slot-contract.ts'
export type { McpCardFace, McpCardState, McpServerDraft, McpConnectedEntry } from './mcp-card-controller.ts'
export type { VideoGenCardFace, VideoGenCardState } from './video-gen-card-controller.ts'
export type { VoiceCardFace, VoiceCardState } from './voice-card-controller.ts'
export type { WebSearchCardFace, WebSearchCardState } from './web-search-card-controller.ts'
export type {
  WorkspaceInjectCardFace,
  WorkspaceInjectCardState,
} from './workspace-inject-card-controller.ts'
export {
  WEB_SEARCH_NS,
  WEB_SEARCH_TAVILY_REF,
  WEB_SEARCH_BRAVE_REF,
} from './web-search-card-controller.ts'
export { WORKSPACE_INJECT_NS } from './workspace-inject-card-controller.ts'
export { SANDBOX_NS } from './sandbox-card-controller.ts'
export { BROWSER_NS } from './browser-card-controller.ts'
export { COMPUTER_USE_NS, COMPUTER_USE_BACKGROUND_REF } from './computer-use-card-controller.ts'
export { CRON_NS } from './cron-card-controller.ts'
export { CURATED_MEMORY_NS } from './curated-memory-card-controller.ts'
export { VOICE_NS, VOICE_OPENAI_REF } from './voice-card-controller.ts'
export { IMAGE_GEN_NS, IMAGE_GEN_OPENAI_REF } from './image-gen-card-controller.ts'
export { VIDEO_GEN_NS, VIDEO_GEN_OPENAI_REF } from './video-gen-card-controller.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.plugins'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Mount the plugin configuration section and the cards this package ships.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugins: section dictionaries')

  const bash = new BashCardController(ctx.settingsScope.bind({ namespace: SHELL_NS }))
  const agentLoop = new AgentLoopCardController(ctx.settingsScope.bind({ namespace: AGENT_LOOP_NS }))
  const workspaceInject = new WorkspaceInjectCardController(
    ctx.settingsScope.bind({ namespace: WORKSPACE_INJECT_NS }),
  )
  const mcp = new McpCardController(ctx.settingsScope.bind({ namespace: MCP_NS }), api)
  const webSearch = new WebSearchCardController(ctx.settingsScope.bind({ namespace: WEB_SEARCH_NS }), api)
  const telemetry = new TelemetryCardController(
    ctx.settingsScope.bind({ namespace: SESSION_TELEMETRY_NS }),
  )
  const sshRemote = new SshRemoteCardController(
    ctx.settingsScope.bind({ namespace: SSH_REMOTE_NS }),
  )
  const sandbox = new SandboxCardController(
    ctx.settingsScope.bind({ namespace: SANDBOX_NS }),
  )
  const computerUse = new ComputerUseCardController(
    ctx.settingsScope.bind({ namespace: COMPUTER_USE_NS }),
    api,
  )
  const cron = new CronCardController(
    ctx.settingsScope.bind({ namespace: CRON_NS }),
  )
  const curatedMemory = new CuratedMemoryCardController(
    ctx.settingsScope.bind({ namespace: CURATED_MEMORY_NS }),
  )
  const externalAgent = new ExternalAgentCardController(
    ctx.settingsScope.bind({ namespace: EXTERNAL_AGENT_NS }),
  )
  const browser = new BrowserCardController(
    ctx.settingsScope.bind({ namespace: BROWSER_NS }),
  )
  const voice = new VoiceCardController(
    ctx.settingsScope.bind({ namespace: VOICE_NS }),
    api,
  )
  const imageGen = new ImageGenCardController(
    ctx.settingsScope.bind({ namespace: IMAGE_GEN_NS }),
    api,
  )
  const videoGen = new VideoGenCardController(
    ctx.settingsScope.bind({ namespace: VIDEO_GEN_NS }),
    api,
  )
  const autoReview = new AutoReviewCardController(
    ctx.settingsScope.bind({ namespace: AUTO_REVIEW_NS }),
    api,
  )
  const memoryEmbed = new MemoryEmbedCardController(
    ctx.settingsScope.bind({ namespace: MEMORY_EMBED_NS }),
    api,
  )

  // Which namespaces the Host serves is a registration fact the wire does not
  // announce, so the directory re-reads on the two signals that can carry a
  // changed composition: a settings document commit and a reconnect.
  const configurable = new ConfigurablePluginsTabController(
    api, () => ctx.slots.entries('settings.plugin.item'))
  const advanced = new AdvancedPluginsTabController(
    api, () => ctx.slots.entries('settings.plugin.advanced.item'))
  ctx.effect(() => () => {
    configurable.dispose()
    advanced.dispose()
  }, 'ui-settings-plugins: tab directory')
  ctx.effect(
    () => ctx.remote.$on('settings/document-updated', () => {
      void configurable.load()
      void advanced.load()
    }),
    'ui-settings-plugins: served-namespace invalidations',
  )
  ctx.effect(
    () => ctx.on('connection/reset', () => {
      void configurable.load()
      void advanced.load()
    }),
    'ui-settings-plugins: served-namespace reconnect',
  )
  // Keys may be written from Credentials (or Models); settings ns does not move.
  ctx.effect(
    () => ctx.remote.$on('credentials/updated', (ref: string) => {
      if (ref === WEB_SEARCH_TAVILY_REF || ref === WEB_SEARCH_BRAVE_REF) {
        webSearch.refreshCredential(ref)
      }
      if (ref === COMPUTER_USE_BACKGROUND_REF) {
        computerUse.refreshCredential(ref)
      }
      if (ref === VOICE_OPENAI_REF) voice.refreshCredential(ref)
      if (ref === IMAGE_GEN_OPENAI_REF) imageGen.refreshCredential(ref)
      if (ref === VIDEO_GEN_OPENAI_REF) videoGen.refreshCredential(ref)
      if (ref === AUTO_REVIEW_CLASSIFIER_TOKEN_REF) autoReview.refreshCredential(ref)
      if (ref === MEMORY_EMBED_TOKEN_REF) memoryEmbed.refreshCredential(ref)
    }),
    'ui-settings-plugins: credential invalidations',
  )
  // A card registered after the first read joins the list without a wire call.
  ctx.effect(
    () => ctx.slots.subscribe('settings.plugin.item', () => { configurable.refresh() }),
    'ui-settings-plugins: card ledger',
  )
  ctx.effect(
    () => ctx.slots.subscribe('settings.plugin.advanced.item', () => { advanced.refresh() }),
    'ui-settings-plugins: advanced card ledger',
  )
  void configurable.load()
  void advanced.load()

  let tabsVersion = -1
  let tabsRevision = -1
  let tabs: readonly PluginsSettingsTabEntry[] = []
  const sectionInjected = (): PluginsSettingsSectionInjected => ({
    hooks: {
      tabs: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.plugins.tab')
          const revision = ctx.locale.getSnapshot().revision
          if (version !== tabsVersion || revision !== tabsRevision) {
            tabsVersion = version
            tabsRevision = revision
            tabs = ctx.slots.entries('settings.plugins.tab')
              .map(entry => ({
                /* v8 ignore next -- list-slot registration requires id */
                id: entry.options.id ?? '',
                order: entry.options.order ?? 0,
                label: resolveSlotLabel(entry.options.label) ?? '',
              }))
              .sort((a, b) => a.order - b.order)
          }
          return tabs
        },
        subscribe: (listener) => {
          const offLedger = ctx.slots.subscribe('settings.plugins.tab', listener)
          const offLocale = ctx.locale.subscribe(listener)
          return () => {
            offLedger()
            offLocale()
          }
        },
      },
    },
  })

  // This package owns the one Plugins navigation entry and the tab chrome;
  // feature plugins contribute pages without competing for Settings nav rows.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'plugins',
    order: 15,
    label: () => t('nav'),
    locale: NS,
    inject: sectionInjected,
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  }, PluginsSettingsSection))

  // The existing configuration page is one ordinary tab. It keeps ownership
  // of the card slot and the shipped card contributions below.
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'configurable',
    order: 0,
    label: () => t('configurableTab'),
    locale: NS,
    inject: () => configurable.inject(),
    children: { 'settings.plugin.item': { kind: 'keyed', scope: 'root' } },
  }, ConfigurablePluginsTab))

  // Advanced: classifier / memory-embed / low-traffic Host knobs (not the everyday plugin cards).
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'advanced',
    order: 10,
    label: () => t('advancedTab'),
    locale: NS,
    inject: () => asAdvancedPluginsTabFace(advanced.inject()),
    children: { 'settings.plugin.advanced.item': { kind: 'keyed', scope: 'root' } },
  }, AdvancedPluginsTab))

  ctx.slots.inject('settings.plugin.advanced.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.advanced.item',
      key: AUTO_REVIEW_NS,
      locale: NS,
      inject: () => autoReview.inject(),
    }, AutoReviewCard)
    yield ctx.slots.register({
      name: 'settings.plugin.advanced.item',
      key: MEMORY_EMBED_NS,
      locale: NS,
      inject: () => memoryEmbed.inject(),
    }, MemoryEmbedCard)
  })

  // SSH remote on General 「远程」 — world is fixed at Host spawn (restart).
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'ssh-remote',
    order: 30,
    locale: NS,
    inject: () => sshRemote.inject(),
  }, SshRemoteCard))

  // MCP first: Trae/Cursor users open Plugins looking for servers, not bash knobs.
  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: MCP_NS,
      locale: NS,
      inject: () => mcp.inject(),
    }, McpCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: WEB_SEARCH_NS,
      locale: NS,
      inject: () => webSearch.inject(),
    }, WebSearchCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: SHELL_NS,
      locale: NS,
      inject: () => bash.inject(),
    }, BashCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: AGENT_LOOP_NS,
      locale: NS,
      inject: () => agentLoop.inject(),
    }, AgentLoopCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: WORKSPACE_INJECT_NS,
      locale: NS,
      inject: () => workspaceInject.inject(),
    }, WorkspaceInjectCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: SESSION_TELEMETRY_NS,
      locale: NS,
      inject: () => telemetry.inject(),
    }, TelemetryCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: SANDBOX_NS,
      locale: NS,
      inject: () => sandbox.inject(),
    }, SandboxCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: COMPUTER_USE_NS,
      locale: NS,
      inject: () => computerUse.inject(),
    }, ComputerUseCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: BROWSER_NS,
      locale: NS,
      inject: () => browser.inject(),
    }, BrowserCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: VOICE_NS,
      locale: NS,
      inject: () => voice.inject(),
    }, VoiceCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: IMAGE_GEN_NS,
      locale: NS,
      inject: () => imageGen.inject(),
    }, ImageGenCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: VIDEO_GEN_NS,
      locale: NS,
      inject: () => videoGen.inject(),
    }, VideoGenCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: CURATED_MEMORY_NS,
      locale: NS,
      inject: () => curatedMemory.inject(),
    }, CuratedMemoryCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: EXTERNAL_AGENT_NS,
      locale: NS,
      inject: () => externalAgent.inject(),
    }, ExternalAgentCard)
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: CRON_NS,
      locale: NS,
      inject: () => cron.inject(),
    }, CronCard)
  })
}
