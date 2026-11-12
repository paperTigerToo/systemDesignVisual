import type { Engine } from './engine'
import type { TimedIntervention } from './types'

/**
 * Drives an engine through a list of timed Interventions: advancing to each
 * one's time, applying it, and carrying on. Equivalent to a person making the
 * same changes at the same simulated times, so a recorded Run replays exactly.
 */
export interface TimelinePlayer {
  /** Advance to simulated time `t`, applying every Intervention due on the way. */
  advanceTo(t: number): void
  /** Interventions not yet applied. */
  readonly remaining: number
}

export function playTimeline(engine: Engine, timeline: readonly TimedIntervention[]): TimelinePlayer {
  const sorted = [...timeline].sort((a, b) => a.time - b.time)
  let next = 0
  return {
    advanceTo(t) {
      while (next < sorted.length && sorted[next]!.time <= t) {
        const { time, intervention } = sorted[next]!
        engine.advanceTo(time)
        engine.applyIntervention(intervention)
        next++
      }
      engine.advanceTo(t)
    },
    get remaining() {
      return sorted.length - next
    },
  }
}
