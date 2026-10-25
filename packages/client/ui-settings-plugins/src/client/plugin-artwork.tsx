/**
 * Per-plugin header artwork (DSH itemArtwork posture, thicker coverage).
 * Unknown title keys fall back to the default plugin glyph.
 */

import type { ReactNode } from 'react'
import {
  IconApiOutlineRegular,
  IconBellOutlineRegular,
  IconBrowseOutlineRegular,
  IconChecklistOutlineRegular,
  IconCodeOutlineRegular,
  IconCordisPluginOutlineRegular,
  IconDatabaseOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconGaugeOutlineRegular,
  IconGlobeOutlineRegular,
  IconGoalOutlineRegular,
  IconLinkOutlineRegular,
  IconPersonalizationOutlineRegular,
  IconPlayOutlineRegular,
  IconQueueOutlineRegular,
  IconSearchOutlineRegular,
  IconSettingsOutlineRegular,
  IconSkillOutlineRegular,
  IconSparkleRegular,
  IconThinkOutlineRegular,
  IconWarningOutlineRegular,
  type IconProps,
} from '@xrkseek/client-ui-primitives'
import type { PluginsSettingsLocaleKey } from './locales.ts'

type Artwork = (props: IconProps) => ReactNode

const ARTWORK: Partial<Record<PluginsSettingsLocaleKey, Artwork>> = {
  mcpTitle: IconApiOutlineRegular,
  webSearchTitle: IconSearchOutlineRegular,
  bashTitle: IconCodeOutlineRegular,
  agentLoopTitle: IconThinkOutlineRegular,
  workspaceInjectTitle: IconFolderOpenOutlineRegular,
  telemetryTitle: IconGaugeOutlineRegular,
  sandboxTitle: IconSettingsOutlineRegular,
  computerUseTitle: IconGoalOutlineRegular,
  browserTitle: IconBrowseOutlineRegular,
  voiceTitle: IconBellOutlineRegular,
  imageGenTitle: IconSparkleRegular,
  videoGenTitle: IconPlayOutlineRegular,
  videoAnalyzeTitle: IconBrowseOutlineRegular,
  curatedMemoryTitle: IconDatabaseOutlineRegular,
  a2aInboundTitle: IconQueueOutlineRegular,
  externalAgentTitle: IconSkillOutlineRegular,
  cronTitle: IconChecklistOutlineRegular,
  autoReviewTitle: IconWarningOutlineRegular,
  memoryEmbedTitle: IconPersonalizationOutlineRegular,
  hostTitle: IconGlobeOutlineRegular,
  channelsTitle: IconQueueOutlineRegular,
  sshRemoteTitle: IconLinkOutlineRegular,
}

/**
 * Resolve header artwork for a plugin card title key.
 * @param titleKey - locale key passed to {@link PluginCard}.
 * @returns a 16px glyph.
 */
export function pluginArtwork(titleKey: PluginsSettingsLocaleKey): ReactNode {
  const Artwork = ARTWORK[titleKey] ?? IconCordisPluginOutlineRegular
  return <Artwork size={16} />
}
