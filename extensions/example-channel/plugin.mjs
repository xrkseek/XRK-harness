/** Example `kind: channel` process plugin — discover via Face `processChannels/list`. */
export function createPlugin() {
  return {
    id: "example-channel",
    kind: "channel",
    channels: [
      {
        channelId: "example-webhook",
        displayName: "Example Webhook",
      },
    ],
  };
}
