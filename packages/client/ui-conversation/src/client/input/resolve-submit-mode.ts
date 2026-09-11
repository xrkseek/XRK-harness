/** Pure busy-Enter / Send delivery mode resolution (no Host or React). */
import type {
  BusyEnterBehavior, ComposerSubmitGesture, InputSubmitMode,
} from '../contract/composer-submission.ts'

/**
 * Resolve one submission gesture against the busy-Enter preference. Plain
 * Enter and the primary Send button share the `enter` gesture, so the button
 * delivers exactly what Enter would.
 * @param preferred - the live busy-Enter preference.
 * @param running - whether the addressed agent currently reports busy.
 * @param gesture - plain Enter (or the Send button) or the Cmd/Ctrl-accelerated chord.
 * @param steeringAvailable - whether this session transport supports steering.
 * @returns Queue outside steer-capable busy state; otherwise the preferred mode or its opposite.
 */
export function resolveSubmitMode(
  preferred: BusyEnterBehavior,
  running: boolean,
  gesture: ComposerSubmitGesture,
  steeringAvailable: boolean,
): InputSubmitMode {
  if (!running || !steeringAvailable) return 'queue'
  if (gesture === 'enter') return preferred
  return preferred === 'queue' ? 'steer' : 'queue'
}
