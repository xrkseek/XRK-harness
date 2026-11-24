/**
 * Gold sample: tiny chip on conversation.session.header.utilities.
 */
window.__ModuleLoader__.load({
  id: 'example-shell-pet',
  factory: (require) => {
    const React = require('react')

    // header.utilities is data-slot-layout=row (host nowrap baseline), but
    // controls still self-defend: flex:none / nowrap / max-width.
    function PetChip() {
      return React.createElement(
        'button',
        {
          type: 'button',
          'data-xrkh-shell-pet': '',
          title: 'XRK Plug sample pet',
          style: {
            flex: 'none',
            height: 28,
            minWidth: 28,
            maxWidth: 120,
            padding: '0 6px',
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l3, #ccc)',
            background: 'var(--dsw-alias-bg-layer-1, transparent)',
            color: 'var(--dsw-alias-label-primary, inherit)',
            fontSize: 14,
            lineHeight: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
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
