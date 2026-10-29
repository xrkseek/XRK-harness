// Fixture: draws an AbovePrompt band with a counter button so the harness
// can prove ui.render + pressBand without a client.

export function register(on) {
  on("ui.render", { component: "AbovePrompt" }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e);
    const { value: count = 0 } = await $.state.get({
      plugin: "band-plugin",
      key: "count",
    });
    return Box({
      flexDirection: "row",
      gap: 1,
      children: [
        Text({ children: `count ${count}` }),
        Button({
          label: "More",
          onPress: async () => {
            await $.state.set(
              { plugin: "band-plugin", key: "count" },
              count + 1,
            );
          },
        }),
      ],
    });
  });
}
