import { useEffect, useState } from 'react'

/**
 * Wall clock for live job duration rows. Ticks once per second while `active`
 * is true; stays frozen otherwise so settled-only lists do not spin a timer.
 * @param active - Whether any visible row still needs a moving clock.
 * @returns Epoch ms used as `now` for elapsed math.
 */
export function useJobClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [active])

  return now
}
