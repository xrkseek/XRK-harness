/**
 * Gold sample: tiny chip on conversation.session.header.utilities.
 */
window.__ModuleLoader__.load({
  id: 'example-shell-pet',
  factory: (require) => {
    const React = require('react')

    function PetChip() {
      return React.createElement(
        'button',
        {
          type: 'button',
          'data-xrkh-shell-pet': '',
          title: 'XRK Plug sample pet',
          style: {
            height: 28,
            minWidth: 28,
            padding: '0 6px',
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l3, #ccc)',
            background: 'var(--dsw-alias-bg-layer-1, transparent)',
            color: 'var(--dsw-alias-label-primary, inherit)',
            fontSize: 14,
            lineHeight: 1,
            cursor: 'default',
          },
        },
        '·ᴗ·',
      )
    }

    return {
      name: 'example-shell-pet',
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(
          () =>
            ctx.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: 'example-shell-pet',
                order: 80,
              },
              PetChip,
            ),
          'example-shell-pet: header.utilities',
        )
      },
    }
  },
})
