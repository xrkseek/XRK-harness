/**
 * Gold sample: faint full-bleed wash on shell.overlay (pointer-events: none).
 */
window.__ModuleLoader__.load({
  id: 'example-shell-wallpaper',
  factory: (require) => {
    const React = require('react')

    function WallpaperWash() {
      return React.createElement('div', {
        'data-xrkh-shell-wallpaper': '',
        'aria-hidden': 'true',
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(120% 80% at 10% 0%, color-mix(in srgb, var(--dsw-alias-label-primary, #888) 8%, transparent), transparent 55%)',
        },
      })
    }

    return {
      name: 'example-shell-wallpaper',
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(
          () =>
            ctx.slots.register(
              {
                name: 'shell.overlay',
                id: 'example-shell-wallpaper',
                order: -100,
              },
              WallpaperWash,
            ),
          'example-shell-wallpaper: overlay',
        )
      },
    }
  },
})
