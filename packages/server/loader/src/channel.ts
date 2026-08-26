import type { PluginChannelDescriptor, RegisteredPlugin } from "./types.js";

export interface AppliedPluginChannel {
  readonly pluginId: string;
  readonly channelId: string;
}

/** One registered channel row with owning plugin id (Face discover / Settings). */
export interface PluginChannelRegistration extends PluginChannelDescriptor {
  readonly pluginId: string;
}

export function isChannelPlugin(
  plugin: RegisteredPlugin,
): plugin is RegisteredPlugin & { readonly kind: "channel" } {
  return plugin.kind === "channel";
}

/** Collect channel descriptors from registered plugins (inventory / future IM wire). */
export function collectChannelPlugins(
  plugins: readonly RegisteredPlugin[],
): readonly PluginChannelDescriptor[] {
  return collectChannelPluginRegistrations(plugins).map(
    ({ pluginId: _pluginId, ...channel }) => channel,
  );
}

/** Collect channel rows with plugin ownership for Face / Settings discover. */
export function collectChannelPluginRegistrations(
  plugins: readonly RegisteredPlugin[],
): readonly PluginChannelRegistration[] {
  const channels: PluginChannelRegistration[] = [];
  for (const plugin of plugins) {
    if (!isChannelPlugin(plugin)) continue;
    for (const channel of plugin.channels ?? []) {
      channels.push({ pluginId: plugin.id, ...channel });
    }
  }
  return channels;
}

/**
 * Reserved kind inventory hook. Host IM connectors are not wired on the Face
 * main path yet — returns collected descriptors for Settings / inventory.
 */
export function wireCompositionChannels(
  options: {
    readonly plugins?: readonly RegisteredPlugin[];
  } = {},
): { readonly applied: readonly AppliedPluginChannel[] } {
  const applied: AppliedPluginChannel[] = [];
  for (const plugin of options.plugins ?? []) {
    if (!isChannelPlugin(plugin)) continue;
    for (const channel of plugin.channels ?? []) {
      applied.push({ pluginId: plugin.id, channelId: channel.channelId });
    }
  }
  return { applied };
}
