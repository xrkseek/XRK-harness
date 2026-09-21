/** Shared IM vendor channel ids (dsh-im nine-pack). */

export const IM_CHANNEL_NAMES = [
  "dingtalk",
  "feishu",
  "wecom",
  "qq",
  "telegram",
  "discord",
  "whatsapp",
  "slack",
  "weixin",
] as const;

export type ImChannelName = (typeof IM_CHANNEL_NAMES)[number];
