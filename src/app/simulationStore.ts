import { create } from 'zustand'
import {
  createEngine,
  validateArchitecture,
  type ComponentId,
  type Engine,
  type Intervention,
  type Movement,
  type Problem,
  type Snapshot,
} from '../engine'
import * as edits from './design'
import { starterDesign, toScenario, type ComponentKind, type Design } from './design'

/** How long, in simulated seconds, a dot takes to cross a Connection. Purely cosmetic. */
export const DOT_TRAVEL_TIME = 0.6
/** Most dots drawn at once across the whole canvas. */
const MAX_DOTS = 150
/** Longest real time a single frame may advance, so a backgrounded tab does not jump. */
const MAX_FRAME_SECONDS = 0.1
/** Time constant, in simulated seconds, of the smoothing applied to Utilisation for status colours. */
const UTILISATION_SMOOTHING = 1

export interface Dot {
  key: string
  from: ComponentId
  to: ComponentId
  direction: Movement['direction']
  /** True for a response carrying a Rejected or Failed Outcome. */
  bad: boolean
  startedAt: number
}

/** What is selected on the canvas, if anything. */
export type Selection = { kind: 'component'; id: ComponentId } | { kind: 'connection'; from: ComponentId; to: ComponentId } | null

interface SimulationState {
  /** The architecture being edited, with its layout. */
  design: Design
  /** Why the design cannot be played; empty when it can. */
  problems: Problem[]
  /** Increases each time a whole design is loaded, so the canvas knows to refit its view. */
  loadCount: number
  selection: Selection

  engine: Engine
  playing: boolean
  snapshot: Snapshot
  dots: Dot[]
  /**
   * Per Server and Database: Utilisation averaged over roughly the last
   * second of simulated time, so status colours do not flicker.
   */
  recentUtilisation: Record<ComponentId, number>

  /** Replace the whole design, for example with an example architecture. */
  loadDesign(design: Design): void
  addComponent(kind: ComponentKind, position: { x: number; y: number }): void
  removeComponent(id: ComponentId): void
  moveComponent(id: ComponentId, position: { x: number; y: number }): void
  renameComponent(id: ComponentId, label: string): void
  updateSetting(id: ComponentId, key: string, value: number): void
  addConnection(from: ComponentId, to: ComponentId): void
  removeConnection(from: ComponentId, to: ComponentId): void
  select(selection: Selection): void

  togglePlaying(): void
  /** Apply a change at the current simulated time, playing or paused. */
  applyIntervention(intervention: Intervention): void
  /** Advance the Run by `realSeconds` of wall-clock time at 1x speed. */
  tick(realSeconds: number): void
}

/** A fresh, paused Run of `design`, starting at simulated time zero. */
function freshRun(design: Design) {
  const engine = createEngine(toScenario(design), { movementCap: MAX_DOTS })
  return {
    engine,
    playing: false,
    snapshot: engine.snapshot(),
    dots: [] as Dot[],
    recentUtilisation: {} as Record<ComponentId, number>,
  }
}

/** Blend each worker's average Utilisation over the last frame into its smoothed value. */
function smoothUtilisation(previous: Snapshot, next: Snapshot, smoothed: Record<ComponentId, number>) {
  const elapsed = next.time - previous.time
  if (elapsed <= 0) return smoothed
  const weight = 1 - Math.exp(-elapsed / UTILISATION_SMOOTHING)
  const result: Record<ComponentId, number> = {}
  for (const [id, component] of Object.entries(next.components)) {
    if (component.kind !== 'server' && component.kind !== 'database') continue
    const before = previous.components[id]
    if (before?.kind !== component.kind) continue
    const frameAverage = (component.occupiedTime - before.occupiedTime) / (elapsed * component.concurrency)
    const prior = smoothed[id] ?? frameAverage
    result[id] = prior + weight * (frameAverage - prior)
  }
  return result
}

export const useSimulation = create<SimulationState>()((set, get) => {
  /**
   * Apply an edit to the architecture. Until live editing arrives (ticket 07),
   * any change to what the engine simulates resets the Run to time zero and pauses it.
   */
  const editArchitecture = (change: (design: Design) => Design, selection?: Selection) => {
    const design = change(get().design)
    if (design === get().design) return
    set({
      design,
      problems: validateArchitecture(design.architecture),
      ...freshRun(design),
      ...(selection === undefined ? {} : { selection }),
    })
  }

  /** Apply an edit that only changes the layout or names: the Run carries on. */
  const editLayout = (change: (design: Design) => Design) => set({ design: change(get().design) })

  return {
    design: starterDesign,
    problems: validateArchitecture(starterDesign.architecture),
    selection: null,
    loadCount: 0,
    ...freshRun(starterDesign),

    loadDesign(design) {
      editArchitecture(() => design, null)
      set({ loadCount: get().loadCount + 1 })
    },

    addComponent(kind, position) {
      const { design, id } = edits.addComponent(get().design, kind, position)
      editArchitecture(() => design, { kind: 'component', id })
    },

    removeComponent(id) {
      const selection = get().selection
      const wasSelected = selection?.kind === 'component' && selection.id === id
      editArchitecture((design) => edits.removeComponent(design, id), wasSelected ? null : undefined)
    },

    moveComponent(id, position) {
      editLayout((design) => edits.moveComponent(design, id, position))
    },

    renameComponent(id, label) {
      editLayout((design) => edits.renameComponent(design, id, label))
    },

    updateSetting(id, key, value) {
      editArchitecture((design) => edits.updateSetting(design, id, key, value))
    },

    addConnection(from, to) {
      editArchitecture((design) => edits.addConnection(design, from, to))
    },

    removeConnection(from, to) {
      const selection = get().selection
      const wasSelected = selection?.kind === 'connection' && selection.from === from && selection.to === to
      editArchitecture((design) => edits.removeConnection(design, from, to), wasSelected ? null : undefined)
    },

    select(selection) {
      set({ selection })
    },

    togglePlaying() {
      const { playing, problems } = get()
      if (!playing && problems.length > 0) return
      set({ playing: !playing })
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
  }
})
