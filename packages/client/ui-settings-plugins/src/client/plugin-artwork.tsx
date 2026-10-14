/**
 * Per-plugin header artwork (DSH itemArtwork posture, thicker coverage).
 * Unknown title keys fall back to the default plugin glyph.
 */

import type { ReactNode } from 'react'
import {
  IconApiOutline14,
  IconBellOutline16,
  IconBrowseOutline16,
  IconChecklistOutline14,
  IconCodeOutline16,
  IconCordisPluginOutline14,
  IconDatabaseOutline16,
  IconFolderOpenOutline16,
  IconGaugeOutline16,
  IconGlobeOutline14,
  IconGoalOutline16,
  IconLinkOutline16,
  IconPersonalizationOutline16,
  IconPlayOutline16,
  IconQueueOutline14,
  IconSearchOutline16,
  IconSettingsOutline14,
  IconSkillOutline16,
  IconSparkle16,
  IconThinkOutline14,
  IconWarningOutline16,
  type IconProps,
} from '@xrkseek/client-ui-primitives'
import type { PluginsSettingsLocaleKey } from './locales.ts'

type Artwork = (props: IconProps) => ReactNode

const ARTWORK: Partial<Record<PluginsSettingsLocaleKey, Artwork>> = {
  mcpTitle: IconApiOutline14,
  webSearchTitle: IconSearchOutline16,
  bashTitle: IconCodeOutline16,
  agentLoopTitle: IconThinkOutline14,
  workspaceInjectTitle: IconFolderOpenOutline16,
  telemetryTitle: IconGaugeOutline16,
  sandboxTitle: IconSettingsOutline14,
  computerUseTitle: IconGoalOutline16,
  browserTitle: IconBrowseOutline16,
  voiceTitle: IconBellOutline16,
  imageGenTitle: IconSparkle16,
  videoGenTitle: IconPlayOutline16,
  videoAnalyzeTitle: IconBrowseOutline16,
  curatedMemoryTitle: IconDatabaseOutline16,
  a2aInboundTitle: IconQueueOutline14,
  externalAgentTitle: IconSkillOutline16,
  cronTitle: IconChecklistOutline14,
  autoReviewTitle: IconWarningOutline16,
  memoryEmbedTitle: IconPersonalizationOutline16,
  hostTitle: IconGlobeOutline14,
  channelsTitle: IconQueueOutline14,
  sshRemoteTitle: IconLinkOutline16,
}

/**
 * Resolve header artwork for a plugin card title key.
 * @param titleKey - locale key passed to {@link PluginCard}.
 * @returns a 16px glyph.
 */
export function pluginArtwork(titleKey: PluginsSettingsLocaleKey): ReactNode {
  const Artwork = ARTWORK[titleKey] ?? IconCordisPluginOutline14
  return <Artwork size={16} />
}
