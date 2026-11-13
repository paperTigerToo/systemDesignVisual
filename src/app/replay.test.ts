import { beforeEach, describe, expect, it } from 'vitest'
import { emptyScenario, moreServersDidNotFixIt, queueAbsorbsABurst } from './builtInScenarios'
import { scenarioFromJson, scenarioToJson, type ScenarioDocument } from './scenario'
import { useSimulation } from './simulationStore'

const store = () => useSimulation.getState()

/** Play for `count` frames of 1/20 s each, the same frames every time so Runs line up. */
function frames(count: number) {
  for (let i = 0; i < count; i++) store().tick(0.05)
}

const starting: ScenarioDocument = {
  ...emptyScenario,
  name: 'Recorded by hand',
  seed: 9,
  architecture: {
    components: [
      { kind: 'source', id: 'source-1', rate: 20, timeLimit: 2 },
      { kind: 'server', id: 'server-1', concurrency: 2, workTime: 0.08, backlogCapacity: 20 },
      { kind: 'database', id: 'database-1', concurrency: 2, workTime: 0.05, backlogCapacity: 20 },
    ],
    connections: [
      { from: 'source-1', to: 'server-1' },
      { from: 'server-1', to: 'database-1' },
    ],
  },
  layout: {
    'source-1': { x: 0, y: 0, label: 'Traffic' },
    'server-1': { x: 300, y: 0, label: 'Web server' },
    'database-1': { x: 600, y: 0, label: 'Database' },
  },
}

beforeEach(() => {
  store().setSpeed(1)
})

describe('replay', () => {
  it('reproduces the recorded Run exactly: snapshots and metric series', () => {
    store().openScenario(starting, { play: true })
    frames(60)
    store().updateSetting('source-1', 'rate', 35)
    frames(60)
    store().addComponent('server', { x: 300, y: 250 })
    store().addConnection('source-1', 'server-2')
    store().addConnection('server-2', 'database-1')
    frames(60)
    store().applyIntervention({ kind: 'kill', componentId: 'server-1' })
    frames(80)
    const recorded = { time: store().snapshot.time, snapshot: store().snapshot, metrics: store().metrics }
    expect(store().interventions).toHaveLength(5)

    const saved = scenarioFromJson(scenarioToJson(store().currentScenario()))
    if (!saved.ok) throw new Error(saved.error)
    store().openScenario(saved.scenario, { play: true })
    expect(store().pending).toHaveLength(5)
    frames(260)

    expect(store().pending).toHaveLength(0)
    expect(store().snapshot.time).toBe(recorded.time)
    expect(store().snapshot).toEqual(recorded.snapshot)
    expect(store().metrics).toEqual(recorded.metrics)
    expect(store().design.layout['server-2']).toEqual({ x: 300, y: 250, label: 'Server 2' })
  })

  it('stops when the user changes anything, discarding the rest of the recording', () => {
    store().openScenario(queueAbsorbsABurst, { play: true })
    frames(80) // 4 s: the two burst changes at 3 s have been replayed, the two at 6 s have not.
    expect(store().interventions).toHaveLength(2)
    expect(store().pending).toHaveLength(2)

    store().applyIntervention({ kind: 'kill', componentId: 'direct-worker' })
    expect(store().pending).toEqual([])
    expect(store().interventions.map((i) => i.intervention.kind)).toEqual(['setSetting', 'setSetting', 'kill'])

    frames(80)
    expect(store().interventions).toHaveLength(3)
    // Saving now captures the user's own Run: the replayed part plus their change.
    expect(store().currentScenario().interventions).toHaveLength(3)
  })

  it('a settings change also stops the replay', () => {
    store().openScenario(moreServersDidNotFixIt, { play: true })
    frames(40)
    store().updateSetting('database', 'concurrency', 8)
    expect(store().pending).toEqual([])
    frames(200)
    expect(store().design.architecture.components.map((c) => c.id)).not.toContain('web-2')
  })

  it('reset replays the Scenario as it was opened', () => {
    store().openScenario(queueAbsorbsABurst, { play: true })
    frames(80)
    store().applyIntervention({ kind: 'kill', componentId: 'direct-worker' })
    store().reset()
    expect(store().snapshot.time).toBe(0)
    expect(store().interventions).toEqual([])
    expect(store().pending).toEqual(queueAbsorbsABurst.interventions)
  })

  it('a saved Scenario places Components that a pending Intervention will add', () => {
    store().openScenario(moreServersDidNotFixIt)
    expect(store().currentScenario()).toEqual(moreServersDidNotFixIt)
  })

  it('a live edit leaves the Design exactly as replaying its recording does', () => {
    store().openScenario(starting, { play: true })
    frames(40)
    store().addComponent('queue', { x: 300, y: 250 })
    store().addConnection('source-1', 'queue-1')
    store().addConnection('queue-1', 'database-1')
    store().updateSetting('database-1', 'workTime', 0.02)
    frames(20)
    store().removeComponent('server-1')
    frames(20)
    const live = store().design
    expect(live.architecture.components.map((c) => c.id)).toEqual(['source-1', 'database-1', 'queue-1'])

    store().openScenario(store().currentScenario(), { play: true })
    frames(80)
    expect(store().pending).toEqual([])
    expect(store().design).toEqual(live)
  })

  it('pausing brings the numbers on the Components up to the moment the Run stopped', () => {
    store().openScenario(starting, { play: true })
    frames(30)
    store().togglePlaying()
    expect(store().playing).toBe(false)
    expect(store().readout.snapshot).toBe(store().snapshot)
  })

  it('a new seed restarts the Run with the same recording', () => {
    store().openScenario(moreServersDidNotFixIt, { play: true })
    frames(20)
    store().setSeed(1234)
    expect(store().snapshot.time).toBe(0)
    expect(store().currentScenario()).toEqual({ ...moreServersDidNotFixIt, seed: 1234 })
    expect(store().playing).toBe(true)
  })
})
