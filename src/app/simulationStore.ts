import { create } from 'zustand'
import {
  createEngine,
  isHazard,
  validateArchitecture,
  type ComponentId,
  type Engine,
  type Intervention,
  type MetricSample,
  type Movement,
  type Problem,
  type SettingKey,
  type Snapshot,
  type TimedIntervention,
} from '../engine'
import { builtInScenarios } from './builtInScenarios'
import * as edits from './design'
import { applyInterventionToDesign, toScenario, type ComponentKind, type Design, type Placement } from './design'
import { SCENARIO_FORMAT, SCENARIO_VERSION, startingDesign, type ScenarioDocument } from './scenario'

/** How long, in simulated seconds, a dot takes to cross a Connection. Purely cosmetic. */
export const DOT_TRAVEL_TIME = 0.6
/** Most dots drawn at once across the whole canvas. */
const MAX_DOTS = 150
/** Longest real time a single frame may cover, so a backgrounded tab does not jump ahead. */
const MAX_FRAME_SECONDS = 0.1
/** Most wall-clock milliseconds the engine may use per frame before the Run falls behind. */
const FRAME_BUDGET_MS = 10
/** Simulated seconds advanced between checks of the frame budget. */
const BUDGET_CHUNK = 0.02
/** Time constant, in simulated seconds, of the smoothing applied to Utilisation for status colours. */
const UTILISATION_SMOOTHING = 1

export const SPEEDS = [0.5, 1, 2, 4] as const
export type Speed = (typeof SPEEDS)[number]

export interface Dot {
  key: string
  from: ComponentId
  to: ComponentId
  direction: Movement['direction']
  /** True for a response carrying a Rejected or Failed Outcome. */
  bad: boolean
  startedAt: number
}

/** A message along the top: why something was refused, or confirmation that something worked. */
export interface Notice {
  text: string
  tone: 'error' | 'info'
}

/** What is selected on the canvas, if anything. */
export type Selection = { kind: 'component'; id: ComponentId } | { kind: 'connection'; from: ComponentId; to: ComponentId } | null

interface SimulationState {
  /** The architecture as it is now, including changes made during the Run. */
  design: Design
  /** The architecture at simulated time zero; reset returns to it. */
  startDesign: Design
  /** Why the design cannot be played, or what is unfinished; empty when all is well. */
  problems: Problem[]
  selection: Selection
  /** Increases each time a whole design is loaded, so the canvas knows to refit its view. */
  loadCount: number
  /** Every change made since time zero, in order, stamped with its simulated time. */
  interventions: TimedIntervention[]
  /** Ids used at any point in this Run, so a removed Component's id is never handed out again. */
  knownIds: ReadonlySet<ComponentId>
  notice: Notice | null
  /** The name of the open Scenario. */
  scenarioName: string
  /** The open Scenario's recorded Interventions, as opened; a reset replays them again. */
  script: TimedIntervention[]
  /**
   * Recorded Interventions still to be replayed, in order. Empty once the
   * replay finishes, or as soon as the user changes anything, after which the
   * Run is live.
   */
  pending: TimedIntervention[]
  /**
   * Position and name of every Component in this Run, including those removed
   * and those a pending Intervention will add, so a saved Scenario can place them.
   */
  placements: Record<ComponentId, Placement>

  engine: Engine
  playing: boolean
  speed: Speed
  /** True when the last frame ran out of time budget before catching up with the clock. */
  behind: boolean
  snapshot: Snapshot
  dots: Dot[]
  /**
   * Per Server and Database: Utilisation averaged over roughly the last
   * second of simulated time, so status colours do not flicker.
   */
  recentUtilisation: Record<ComponentId, number>
  /** Metric samples over roughly the last 30 simulated seconds, oldest first. */
  metrics: MetricSample[]

  /** Open a Scenario at time zero, ready to replay its recorded Interventions. */
  openScenario(scenario: ScenarioDocument, options?: { play?: boolean }): void
  /** The open Scenario as it stands: starting architecture, seed and every recorded Intervention. */
  currentScenario(): ScenarioDocument
  setScenarioName(name: string): void
  /** Restart the Scenario from time zero with a different seed. */
  setSeed(seed: number): void
  showNotice(text: string, tone?: Notice['tone']): void
  addComponent(kind: ComponentKind, position: { x: number; y: number }): void
  removeComponent(id: ComponentId): void
  moveComponent(id: ComponentId, position: { x: number; y: number }): void
  renameComponent(id: ComponentId, label: string): void
  updateSetting(id: ComponentId, key: string, value: number): void
  addConnection(from: ComponentId, to: ComponentId): void
  removeConnection(from: ComponentId, to: ComponentId): void
  select(selection: Selection): void
  dismissNotice(): void

  togglePlaying(): void
  setSpeed(speed: Speed): void
  /**
   * Back to time zero and the starting architecture, keeping where Components
   * sit on the canvas, ready to replay the Scenario's recorded Interventions again.
   */
  reset(): void
  /** Kill or revive, at the current simulated time, playing or paused. */
  applyIntervention(intervention: Intervention): void
  /** Advance the Run by `realSeconds` of wall-clock time at the chosen speed. */
  tick(realSeconds: number): void
}

/** True once the Run has moved past time zero or recorded a change; from then on edits apply live. */
export function hasStarted(state: Pick<SimulationState, 'engine' | 'interventions'>): boolean {
  return state.engine.time > 0 || state.interventions.length > 0
}

/** True when Play should be refused: anything wrong before the Run starts, or a hazard after. */
export function playBlocked(state: Pick<SimulationState, 'engine' | 'interventions' | 'problems'>): boolean {
  return hasStarted(state) ? state.problems.some(isHazard) : state.problems.length > 0
}

/** A fresh, paused Run of `design`, starting at simulated time zero. */
function freshRun(design: Design, script: TimedIntervention[] = [], placements: Record<ComponentId, Placement> = {}) {
  const engine = createEngine(toScenario(design), { movementCap: MAX_DOTS })
  return {
    script,
    pending: script,
    placements: { ...placements, ...design.layout },
    design,
    startDesign: design,
    problems: validateArchitecture(design.architecture),
    interventions: [] as TimedIntervention[],
    knownIds: new Set(design.architecture.components.map((c) => c.id)) as ReadonlySet<ComponentId>,
    notice: null as Notice | null,
    engine,
    playing: false,
    behind: false,
    snapshot: engine.snapshot(),
    dots: [] as Dot[],
    recentUtilisation: {} as Record<ComponentId, number>,
    metrics: [] as MetricSample[],
  }
}

/** Every Component id a list of Interventions adds. */
function addedIds(interventions: TimedIntervention[]): ComponentId[] {
  return interventions.flatMap(({ intervention }) => (intervention.kind === 'addComponent' ? [intervention.component.id] : []))
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

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

function toDot(movement: Movement): Dot {
  return {
    key: `${movement.requestId}:${movement.direction}:${movement.from}`,
    from: movement.from,
    to: movement.to,
    direction: movement.direction,
    bad: movement.direction === 'response' && (movement.outcome === 'rejected' || movement.outcome === 'failed'),
    startedAt: movement.time,
  }
}

const defaultScenario = builtInScenarios[0]!

export const useSimulation = create<SimulationState>()((set, get) => {
  /**
   * Apply an edit to the architecture. Before the Run starts this simply
   * rebuilds the engine. Once it has started the edit becomes Interventions
   * applied live at the current simulated time, unless the resulting
   * architecture would have a hazard, in which case it is refused with a reason.
   */
  const editArchitecture = (design: Design, interventions: Intervention[], selection?: Selection) => {
    const state = get()
    if (design === state.design) return
    const selectionPatch = selection === undefined ? {} : { selection }

    if (!hasStarted(state)) {
      // Changing the starting architecture makes this the user's own Scenario: nothing recorded is replayed.
      set({ ...freshRun(design, [], state.placements), loadCount: state.loadCount, ...selectionPatch })
      return
    }

    const problems = validateArchitecture(design.architecture)
    const hazard = problems.find(isHazard)
    if (hazard) {
      set({ notice: { text: `Not applied: ${hazard.message}`, tone: 'error' } })
      return
    }
    const { engine } = state
    const knownIds = new Set(state.knownIds)
    const recorded = [...state.interventions]
    try {
      for (const intervention of interventions) {
        engine.applyIntervention(intervention)
        recorded.push({ time: engine.time, intervention })
        if (intervention.kind === 'addComponent') knownIds.add(intervention.component.id)
      }
    } catch (error) {
      set({ notice: { text: `Not applied: ${errorText(error)}`, tone: 'error' } })
      return
    }
    set({
      design,
      problems,
      interventions: recorded,
      // A change of the user's own ends any replay: the rest of the recording is discarded.
      pending: [],
      knownIds,
      placements: { ...state.placements, ...design.layout },
      notice: null,
      snapshot: engine.snapshot(),
      ...selectionPatch,
    })
  }

  /** Apply an edit that only changes the layout or names: never an Intervention. */
  const editLayout = (change: (design: Design) => Design) => {
    const design = change(get().design)
    // Keep the starting layout in step so a reset does not move things back.
    const startDesign = change(get().startDesign)
    set({ design, startDesign, placements: { ...get().placements, ...design.layout } })
  }

  return {
    ...freshRun(startingDesign(defaultScenario), defaultScenario.interventions, defaultScenario.layout),
    scenarioName: defaultScenario.name,
    // The default Scenario tells its story unaided, so it starts playing on load.
    playing: true,
    selection: null,
    loadCount: 0,
    speed: 1,

    openScenario(scenario, options = {}) {
      set({
        ...freshRun(startingDesign(scenario), scenario.interventions, scenario.layout),
        scenarioName: scenario.name,
        playing: options.play ?? false,
        selection: null,
        loadCount: get().loadCount + 1,
      })
    },

    currentScenario() {
      const { startDesign, design, placements, interventions, pending, scenarioName } = get()
      const all = [...interventions, ...pending]
      const layout: Record<ComponentId, Placement> = {}
      for (const id of [...startDesign.architecture.components.map((c) => c.id), ...addedIds(all)]) {
        const placement = design.layout[id] ?? placements[id] ?? startDesign.layout[id]
        if (placement) layout[id] = placement
      }
      return {
        format: SCENARIO_FORMAT,
        version: SCENARIO_VERSION,
        name: scenarioName,
        seed: startDesign.seed,
        architecture: startDesign.architecture,
        layout,
        interventions: all,
      }
    },

    setScenarioName(name) {
      set({ scenarioName: name })
    },

    setSeed(seed) {
      const { playing } = get()
      get().reset()
      const { startDesign, script, placements, loadCount, selection } = get()
      set({ ...freshRun({ ...startDesign, seed }, script, placements), loadCount, selection, playing })
    },

    showNotice(text, tone = 'info') {
      set({ notice: { text, tone } })
    },

    addComponent(kind, position) {
      const { design, id, spec } = edits.addComponent(get().design, kind, position, get().knownIds)
      editArchitecture(design, [{ kind: 'addComponent', component: spec }], { kind: 'component', id })
    },

    removeComponent(id) {
      const selection = get().selection
      const wasSelected = selection?.kind === 'component' && selection.id === id
      editArchitecture(
        edits.removeComponent(get().design, id),
        [{ kind: 'removeComponent', componentId: id }],
        wasSelected ? null : undefined,
      )
    },

    moveComponent(id, position) {
      editLayout((design) => edits.moveComponent(design, id, position))
    },

    renameComponent(id, label) {
      editLayout((design) => edits.renameComponent(design, id, label))
    },

    updateSetting(id, key, value) {
      editArchitecture(edits.updateSetting(get().design, id, key, value), [
        { kind: 'setSetting', componentId: id, key: key as SettingKey, value },
      ])
    },

    addConnection(from, to) {
      editArchitecture(edits.addConnection(get().design, from, to), [{ kind: 'addConnection', from, to }])
    },

    removeConnection(from, to) {
      const selection = get().selection
      const wasSelected = selection?.kind === 'connection' && selection.from === from && selection.to === to
      editArchitecture(
        edits.removeConnection(get().design, from, to),
        [{ kind: 'removeConnection', from, to }],
        wasSelected ? null : undefined,
      )
    },

    select(selection) {
      set({ selection })
    },

    dismissNotice() {
      set({ notice: null })
    },

    togglePlaying() {
      const state = get()
      if (!state.playing && playBlocked(state)) return
      set({ playing: !state.playing, behind: false })
    },

    setSpeed(speed) {
      set({ speed })
    },

    reset() {
      const { startDesign, design, selection, loadCount, script, placements } = get()
      // Keep current positions and names for Components that exist at time zero.
      const layout = { ...startDesign.layout }
      for (const id of Object.keys(layout)) {
        if (design.layout[id]) layout[id] = design.layout[id]
      }
      const stillThere =
        selection?.kind === 'component'
          ? startDesign.architecture.components.some((c) => c.id === selection.id)
          : selection?.kind === 'connection'
            ? startDesign.architecture.connections.some((c) => c.from === selection.from && c.to === selection.to)
            : true
      set({ ...freshRun({ ...startDesign, layout }, script, placements), selection: stillThere ? selection : null, loadCount })
    },

    applyIntervention(intervention) {
      const { engine, interventions } = get()
      try {
        engine.applyIntervention(intervention)
      } catch (error) {
        set({ notice: { text: `Not applied: ${errorText(error)}`, tone: 'error' } })
        return
      }
      // A change of the user's own ends any replay.
      set({ snapshot: engine.snapshot(), interventions: [...interventions, { time: engine.time, intervention }], pending: [] })
    },

    tick(realSeconds) {
      const { engine, playing, speed, dots, snapshot: previous, recentUtilisation } = get()
      if (!playing) return
      const target = engine.time + Math.min(realSeconds, MAX_FRAME_SECONDS) * speed

      // Replay recorded Interventions that fall due, each at exactly its recorded time,
      // so the Run matches the one that was recorded.
      const state = get()
      let { design, interventions, knownIds, notice } = state
      let pending = state.pending
      const replayDue = (upTo: number) => {
        while (pending.length > 0 && pending[0]!.time <= upTo) {
          const [next, ...rest] = pending as [TimedIntervention, ...TimedIntervention[]]
          engine.advanceTo(next.time)
          try {
            engine.applyIntervention(next.intervention)
          } catch (error) {
            notice = { text: `Replay stopped: ${errorText(error)}`, tone: 'error' }
            pending = []
            return
          }
          pending = rest
          design = applyInterventionToDesign(design, next.intervention, state.placements)
          interventions = [...interventions, { time: engine.time, intervention: next.intervention }]
          if (next.intervention.kind === 'addComponent') knownIds = new Set([...knownIds, next.intervention.component.id])
        }
      }

      // Advance in small chunks until caught up or out of budget; if out of budget the Run
      // simply falls behind the clock rather than freezing the page.
      const started = performance.now()
      while (engine.time < target && performance.now() - started < FRAME_BUDGET_MS) {
        const chunkEnd = Math.min(target, engine.time + BUDGET_CHUNK)
        replayDue(chunkEnd)
        engine.advanceTo(chunkEnd)
      }
      const behind = engine.time < target
      const replayed =
        design === state.design
          ? {}
          : { design, problems: validateArchitecture(design.architecture), placements: { ...state.placements, ...design.layout } }

      const now = engine.time
      const live = dots.filter((dot) => now - dot.startedAt < DOT_TRAVEL_TIME)
      for (const movement of engine.takeMovements()) live.push(toDot(movement))
      const snapshot = engine.snapshot()
      // Only hand the charts a new array when a new sample exists, so they redraw a few times a second, not every frame.
      const sampled = engine.metrics()
      const metrics = sampled.at(-1)?.time === get().metrics.at(-1)?.time ? get().metrics : sampled
      set({
        ...replayed,
        interventions,
        knownIds,
        pending,
        notice,
        metrics,
        snapshot,
        behind,
        dots: live.slice(-MAX_DOTS),
        recentUtilisation: smoothUtilisation(previous, snapshot, recentUtilisation),
      })
    },
  }
})
