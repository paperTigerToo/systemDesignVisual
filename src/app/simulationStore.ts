import { create } from 'zustand'
import {
  createEngine,
  type ComponentId,
  type Engine,
  type Intervention,
  type Movement,
  type Scenario,
  type Snapshot,
} from '../engine'
import { defaultScenario } from './defaultScenario'

/** How long, in simulated seconds, a dot takes to cross a Connection. Purely cosmetic. */
export const DOT_TRAVEL_TIME = 0.6
/** Most dots drawn at once across the whole canvas. */
const MAX_DOTS = 150
/** Longest real time a single frame may advance, so a backgrounded tab does not jump. */
const MAX_FRAME_SECONDS = 0.1

export interface Dot {
  key: string
  from: ComponentId
  to: ComponentId
  direction: Movement['direction']
  /** True for a response carrying a Rejected or Failed Outcome. */
  bad: boolean
  startedAt: number
}

/** Time constant, in simulated seconds, of the smoothing applied to Utilisation for status colours. */
const UTILISATION_SMOOTHING = 1

interface SimulationState {
  engine: Engine
  playing: boolean
  snapshot: Snapshot
  dots: Dot[]
  /**
   * Per Server and Database: Utilisation averaged over roughly the last
   * second of simulated time, so status colours do not flicker.
   */
  recentUtilisation: Record<ComponentId, number>
  togglePlaying(): void
  /** Apply a change at the current simulated time, playing or paused. */
  applyIntervention(intervention: Intervention): void
  /** Advance the Run by `realSeconds` of wall-clock time at 1x speed. */
  tick(realSeconds: number): void
}

function freshEngine(scenario: Scenario) {
  const engine = createEngine(scenario, { movementCap: MAX_DOTS })
  return { engine, snapshot: engine.snapshot(), dots: [] as Dot[], recentUtilisation: {} }
}

/** Blend each worker's average Utilisation over the last frame into its smoothed value. */
function smoothUtilisation(previous: Snapshot, next: Snapshot, smoothed: Record<ComponentId, number>) {
  const elapsed = next.time - previous.time
  if (elapsed <= 0) return smoothed
  const weight = 1 - Math.exp(-elapsed / UTILISATION_SMOOTHING)
  const result: Record<ComponentId, number> = {}
  for (const [id, component] of Object.entries(next.components)) {
    const before = previous.components[id]
    if (component.kind === 'source' || before?.kind !== component.kind) continue
    const frameAverage = (component.occupiedTime - before.occupiedTime) / (elapsed * component.concurrency)
    const prior = smoothed[id] ?? frameAverage
    result[id] = prior + weight * (frameAverage - prior)
  }
  return result
}

export const useSimulation = create<SimulationState>()((set, get) => ({
  ...freshEngine(defaultScenario),
  playing: false,

  togglePlaying() {
    set({ playing: !get().playing })
  },

  applyIntervention(intervention) {
    const { engine } = get()
    engine.applyIntervention(intervention)
    set({ snapshot: engine.snapshot() })
  },

  tick(realSeconds) {
    const { engine, playing, dots, snapshot: previous, recentUtilisation } = get()
    if (!playing) return
    engine.advanceTo(engine.time + Math.min(realSeconds, MAX_FRAME_SECONDS))

    const now = engine.time
    const live = dots.filter((dot) => now - dot.startedAt < DOT_TRAVEL_TIME)
    for (const movement of engine.takeMovements()) {
      live.push({
        key: `${movement.requestId}:${movement.direction}:${movement.from}`,
        from: movement.from,
        to: movement.to,
        direction: movement.direction,
        bad: movement.direction === 'response' && (movement.outcome === 'rejected' || movement.outcome === 'failed'),
        startedAt: movement.time,
      })
    }
    const snapshot = engine.snapshot()
    set({
      snapshot,
      dots: live.slice(-MAX_DOTS),
      recentUtilisation: smoothUtilisation(previous, snapshot, recentUtilisation),
    })
  },
}))
