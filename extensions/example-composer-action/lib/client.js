/**
 * Native client gold sample — composer tool-row action.
 *
 * Reads the session standard kit (`useModelSelection`, `useInput`,
 * `inputActions`). Clicking the button prefixes the draft with a short note
 * that names the current model route.
 */
window.__ModuleLoader__.load({
  id: "example-composer-action",
  factory: (require) => {
    const React = require("react");

    function ComposerDemoButton(props) {
      const useModelSelection = props.useModelSelection;
      const useInput = props.useInput;
      const inputActions = props.inputActions;
      const modelSelectionActions = props.modelSelectionActions;
      const current = useModelSelection
        ? useModelSelection((state) => state.current)
        : null;
      const draft = useInput ? useInput((state) => state.draft) : "";
      const route =
        current && current.provider && current.model
          ? `${current.provider}/${current.model}`
          : "(no model)";
      const canSwitch =
        modelSelectionActions && modelSelectionActions.available === true;

      const onClick = () => {
        if (!inputActions || typeof inputActions.setDraft !== "function") return;
        const marker = `[optimize via ${route}] `;
        const next = draft.startsWith(marker) ? draft : `${marker}${draft}`;
        inputActions.setDraft(next);
      };

      return React.createElement(
        "button",
        {
          type: "button",
          title: canSwitch
            ? `Demo: read model + rewrite draft (${route}); modelSelectionActions.select available`
            : `Demo: read model + rewrite draft (${route}); model switch locked`,
          onClick,
          style: {
            height: 28,
            padding: "0 8px",
            borderRadius: 6,
            border: "1px solid var(--dsw-alias-border-l3, #ccc)",
            background: "var(--dsw-alias-bg-layer-1, transparent)",
            color: "var(--dsw-alias-label-primary, inherit)",
            fontSize: 12,
            cursor: "pointer",
            whiteSpace: "nowrap",
          },
        },
        "Optimize",
      );
    }

    return {
      name: "example-composer-action",
      inject: ["slots"],
      apply(ctx) {
        ctx.effect(
          () =>
            ctx.slots.register(
              {
                name: "conversation.input.right",
                id: "example-composer-action",
                order: 40,
              },
              ComposerDemoButton,
            ),
          "example-composer-action: input.right",
        );
      },
    };
  },
});
