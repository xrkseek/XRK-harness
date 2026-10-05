import type { PresenceHeldKit, PresenceKit } from '../presence-settings.ts'

/** Named overlay kit (not a shop). Face sticker stays separate. */
export function PresenceKitMark({
  kit,
  className,
}: {
  readonly kit: PresenceKit | PresenceHeldKit | string
  readonly className?: string
}) {
  if (kit === 'bow') {
    return (
      <svg className={className} viewBox="0 0 36 36" aria-hidden>
        <path fill="#E07090" d="M7 16c0-4 4-7 7.5-4.5 2 1.5 3 3.5 4.5 5.5 1.5-2 2.5-4 4.5-5.5C27 9 31 12 31 16c0 3-2.2 4.8-5 4.8-2.2 0-4-1.1-5.5-2.8C19 19.7 17.2 20.8 15 20.8 12.2 20.8 7 19 7 16z" />
        <circle cx="18" cy="16.5" r="2.4" fill="#C44868" />
      </svg>
    )
  }
  if (kit === 'cap') {
    return (
      <svg className={className} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="18" cy="22" rx="13" ry="2.6" fill="#2A446C" />
        <path fill="#3A5A8C" d="M9 21c0-8 4-13 9-13s9 5 9 13H9z" />
      </svg>
    )
  }
  if (kit === 'beanie') {
    return (
      <svg className={className} viewBox="0 0 36 36" aria-hidden>
        <path fill="#3A5A8C" d="M9 22c0-8 4-14 9-14s9 6 9 14H9z" />
        <rect x="8" y="20" width="20" height="4" rx="1.4" fill="#2A446C" />
        <circle cx="18" cy="9.5" r="1.8" fill="#C44868" />
      </svg>
    )
  }
  if (kit === 'visor') {
    return (
      <svg className={className} viewBox="0 0 36 36" aria-hidden>
        <rect x="9" y="14" width="18" height="3" rx="1.2" fill="#3A5A8C" />
        <ellipse cx="18" cy="20" rx="12" ry="3" fill="#2A446C" />
      </svg>
    )
  }
  if (kit === 'specs-rect') {
    return (
      <svg className={className} viewBox="0 0 36 36" aria-hidden>
        <rect x="7" y="14" width="9" height="8" rx="1.6" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.7" />
        <rect x="20" y="14" width="9" height="8" rx="1.6" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.7" />
        <path d="M16 18h4" fill="none" stroke="#2A2A30" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (kit === 'specs-cat') {
    return (
      <svg className={className} viewBox="0 0 36 36" aria-hidden>
        <path d="M8 19c0-4 3-7 7-5 1.2-3 4-3 5 0 4-2 7 1 7 5-2 4-5 4-7 2-2 2-5 2-7-2-2 2-5 2-5-2z" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.5" />
      </svg>
    )
  }
  if (kit === 'specs-sun') {
    return (
      <svg className={className} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="13" cy="18" rx="5.4" ry="4.4" fill="rgba(28,28,32,0.55)" stroke="#4A241C" strokeWidth="1.8" />
        <ellipse cx="23" cy="18" rx="5.4" ry="4.4" fill="rgba(28,28,32,0.55)" stroke="#4A241C" strokeWidth="1.8" />
        <path d="M18 17.6h0.1" stroke="#4A241C" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }
  if (kit === 'specs') {
    return (
      <svg className={className} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="13" cy="18" rx="5.6" ry="4.6" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.8" />
        <ellipse cx="23" cy="18" rx="5.6" ry="4.6" fill="rgba(255,255,255,0.14)" stroke="#2A2A30" strokeWidth="1.8" />
        <path d="M17.2 18H18.8" fill="none" stroke="#2A2A30" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (kit === 'halo') {
    return (
      <svg className={className} viewBox="0 0 36 36" aria-hidden>
        <ellipse cx="18" cy="10" rx="11" ry="3.2" fill="none" stroke="#E8C46A" strokeWidth="1.8" />
      </svg>
    )
  }
  if (kit === 'flower') {
    return (
      <svg className={className} viewBox="0 0 36 36" aria-hidden>
        <circle cx="18" cy="14" r="3.2" fill="#F4A0B4" />
        <circle cx="12.5" cy="17.5" r="3.2" fill="#E07090" />
        <circle cx="23.5" cy="17.5" r="3.2" fill="#E07090" />
        <circle cx="15" cy="23" r="3.2" fill="#E07090" />
        <circle cx="21" cy="23" r="3.2" fill="#E07090" />
        <circle cx="18" cy="19" r="2.4" fill="#E8C46A" />
        <path d="M18 22 v8" fill="none" stroke="#6A9A68" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  if (kit === 'tea') {
    return (
      <svg className={className} viewBox="0 0 36 36" aria-hidden>
        <path d="M10 16h14l-1.4 10.5c-.2 1.4-1.4 2.5-2.8 2.5H14.2c-1.4 0-2.6-1.1-2.8-2.5Z" fill="#E8D8C8" stroke="#8A7058" strokeWidth="1.4" />
        <path d="M24 18.5c3 .4 5 2.2 5 4.2s-2 3.6-5 4" fill="none" stroke="#8A7058" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M14 13c.6-2 2.2-3 4-3 1.6 0 3 .8 3.6 2" fill="none" stroke="#9AB8C0" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  if (kit === 'flag') {
    return (
      <svg className={className} viewBox="0 0 36 36" aria-hidden>
        <path d="M12 8 v20" fill="none" stroke="#5A6068" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M13 9 l14 5-14 5Z" fill="#C44868" />
      </svg>
    )
  }
  if (kit === 'spark') {
    return (
      <svg className={className} viewBox="0 0 36 36" aria-hidden>
        <path fill="#E8C46A" d="M18 7 20.2 15l8 .8-6.2 5.2 1.8 7.8L18 24.4 12.2 28.8l1.8-7.8-6.2-5.2 8-.8z" />
      </svg>
    )
  }
  return (
    <svg className={className} viewBox="0 0 36 36" aria-hidden>
      <circle cx="18" cy="18" r="9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 2" />
    </svg>
  )
}
