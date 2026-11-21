/**
 * Gold sample: floating side strip that yields the shell via
 * `ctx.layout.reserveSide` / `reserveBottom` (no private Host patch, no
 * community layout.css). Toggle from the session header utilities row.
 *
 * Docs: docs/open-platform.md · docs/sidebar-workbench.md
 */
window.__ModuleLoader__.load({
  id: 'example-workbench-push',
  factory: (require) => {
    const React = require('react')
    const { useEffect, useState } = React

    const SIDE_PX = 280
    const BOTTOM_PX = 160

    function WorkbenchToggle(props) {
      const layout = props.layout
      const [open, setOpen] = useState(false)

      useEffect(() => {
        if (!layout || typeof layout.reserveSide !== 'function') return undefined
        if (open) {
          layout.reserveSide(SIDE_PX)
          layout.reserveBottom(BOTTOM_PX)
        } else {
          layout.reserveSide(0)
          layout.reserveBottom(0)
        }
        return () => {
          layout.reserveSide(0)
          layout.reserveBottom(0)
        }
      }, [layout, open])

      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'button',
          {
            type: 'button',
            'data-xrkh-example-workbench-toggle': '',
            title: open
              ? 'Release shell yield (reserveSide/Bottom → 0)'
              : 'Push shell (reserveSide + reserveBottom)',
            onClick: () => setOpen((v) => !v),
            style: {
              height: 28,
              padding: '0 8px',
              borderRadius: 8,
              border: '1px solid var(--dsw-alias-border-l3, #ccc)',
              background: open
                ? 'var(--dsw-alias-interactive-bg-hover, #eee)'
                : 'var(--dsw-alias-bg-layer-1, transparent)',
              color: 'var(--dsw-alias-label-primary, inherit)',
              fontSize: 12,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            },
          },
          open ? 'Yield off' : 'Yield on',
        ),
        open
          ? React.createElement(
              'div',
              {
                'data-xrkh-example-workbench-panel': '',
                style: {
                  position: 'fixed',
                  top: 'var(--xrk-desktop-chrome-height, 0px)',
                  right: 0,
                  bottom: 0,
                  width: SIDE_PX,
                  zIndex: 24,
                  boxSizing: 'border-box',
                  padding: 12,
                  borderLeft: '1px solid var(--dsw-alias-border-l2, #ddd)',
                  background: 'var(--dsw-alias-bg-layer-1, #fff)',
                  color: 'var(--dsw-alias-label-primary, inherit)',
                  fontSize: 12,
                  pointerEvents: 'auto',
                },
              },
              React.createElement(
                'div',
                { style: { fontWeight: 600, marginBottom: 8 } },
                'example-workbench-push',
              ),
              React.createElement(
                'p',
                { style: { margin: '0 0 8px', lineHeight: 1.4, opacity: 0.85 } },
                'Shell yields via reserveSide(',
                SIDE_PX,
                ') + reserveBottom(',
                BOTTOM_PX,
                '). Chat should not sit under this strip.',
              ),
              React.createElement(
                'div',
                {
                  style: {
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: BOTTOM_PX,
                    boxSizing: 'border-box',
                    padding: 12,
                    borderTop: '1px solid var(--dsw-alias-border-l2, #ddd)',
                    background: 'var(--dsw-alias-bg-layer-2, #f6f6f6)',
                  },
                },
                'Bottom strip (',
                BOTTOM_PX,
                'px) — conversation column pads the same height.',
              ),
            )
          : null,
      )
    }

    return {
      name: 'example-workbench-push',
      inject: ['slots', 'layout'],
      apply(ctx) {
        const Bound = (slotProps) =>
          React.createElement(WorkbenchToggle, {
            ...slotProps,
            layout: ctx.layout,
          })
        ctx.effect(
          () =>
            ctx.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: 'example-workbench-push',
                order: 85,
              },
              Bound,
            ),
          'example-workbench-push: header.utilities',
        )
        ctx.effect(
          () => () => {
            ctx.layout?.reserveSide?.(0)
            ctx.layout?.reserveBottom?.(0)
          },
          'example-workbench-push: clear yield on unload',
        )
      },
    }
  },
})
