import { create } from 'zustand'
import { createEngine, type ComponentId, type Engine, type Scenario, type Snapshot } from '../engine'
import { defaultScenario } from './defaultScenario'

/** How long, in simulated seconds, a dot takes to cross a Connection. Purely cosmetic. */
export const DOT_TRAVEL_TIME = 0.6
/** Most dots drawn at once across the whole canvas. */
const MAX_DOTS = 150
/** Longest real time a single frame may advance, so a backgrounded tab does not jump. */
const MAX_FRAME_SECONDS = 0.1

export interface Dot {
  key: number
  from: ComponentId
  to: ComponentId
  startedAt: number
}

interface SimulationState {
  engine: Engine
  playing: boolean
  snapshot: Snapshot
  dots: Dot[]
  togglePlaying(): void
  /** Advance the Run by `realSeconds` of wall-clock time at 1x speed. */
  tick(realSeconds: number): void
}

function freshEngine(scenario: Scenario) {
  const engine = createEngine(scenario, { movementCap: MAX_DOTS })
  return { engine, snapshot: engine.snapshot(), dots: [] as Dot[] }
}

export const useSimulation = create<SimulationState>()((set, get) => ({
  ...freshEngine(defaultScenario),
  playing: false,

  togglePlaying() {
    set({ playing: !get().playing })
  },

  tick(realSeconds) {
    const { engine, playing, dots } = get()
    if (!playing) return
    engine.advanceTo(engine.time + Math.min(realSeconds, MAX_FRAME_SECONDS))

    const now = engine.time
    const live = dots.filter((dot) => now - dot.startedAt < DOT_TRAVEL_TIME)
    for (const movement of engine.takeMovements()) {
      live.push({ key: movement.requestId, from: movement.from, to: movement.to, startedAt: movement.time })
    }
    set({ snapshot: engine.snapshot(), dots: live.slice(-MAX_DOTS) })
  },
}))
