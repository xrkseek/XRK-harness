/**
 * Look used while Face `companionBall` has not landed yet.
 * Must never fall through to Settings `ui-presence` (老板装扮), or the header /
 * Overview 被委派方 seat flashes Boss on every session switch.
 */
export const PENDING_MEMBER_LOOK = Object.freeze({
  shape: 'blob',
  color: 'cream',
  kitHat: 'none',
  kitGlasses: 'none',
  kitHeld: 'none',
  overlayHat: '',
  overlayGlasses: '',
  overlayHeld: '',
})
