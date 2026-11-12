import { describe, expect, it } from 'vitest'
import {
  createEngine,
  playTimeline,
  type Engine,
  type QueueSnapshot,
  type Scenario,
  type SourceSnapshot,
  type TimedIntervention,
  type WorkerSnapshot,
} from './index'

const web = { kind: 'server' as const, concurrency: 2, workTime: 0.2, backlogCapacity: 20 }

/** Source to two Servers to a Database that is slow enough to matter. */
function twoServers(seed = 12): Scenario {
  return {
    seed,
    architecture: {
      components: [
        { kind: 'source', id: 'source', rate: 15, timeLimit: 2 },
        { ...web, id: 'web-1' },
        { ...web, id: 'web-2' },
        { kind: 'database', id: 'db', concurrency: 4, workTime: 0.1, backlogCapacity: 40 },
      ],
      connections: [
        { from: 'source', to: 'web-1' },
        { from: 'source', to: 'web-2' },
        { from: 'web-1', to: 'db' },
        { from: 'web-2', to: 'db' },
      ],
    },
  }
}

const get = {
  source: (engine: Engine, id = 'source') => engine.snapshot().components[id] as SourceSnapshot,
  worker: (engine: Engine, id: string) => engine.snapshot().components[id] as WorkerSnapshot,
  queue: (engine: Engine, id: string) => engine.snapshot().components[id] as QueueSnapshot,
}

function expectEveryRequestAccountedFor(source: SourceSnapshot): void {
  const { completed, rejected, failed, timedOut } = source.outcomes
  expect(source.inProgress).toBeGreaterThanOrEqual(0)
  expect(completed + rejected + failed + timedOut + source.inProgress).toBe(source.created)
}

const timeline: TimedIntervention[] = [
  { time: 4, intervention: { kind: 'addComponent', component: { ...web, id: 'web-3' } } },
  { time: 4, intervention: { kind: 'addConnection', from: 'source', to: 'web-3' } },
  { time: 4, intervention: { kind: 'addConnection', from: 'web-3', to: 'db' } },
  { time: 9, intervention: { kind: 'setSetting', componentId: 'db', key: 'concurrency', value: 8 } },
  { time: 12, intervention: { kind: 'kill', componentId: 'web-1' } },
  { time: 15, intervention: { kind: 'removeConnection', from: 'source', to: 'web-2' } },
  { time: 18, intervention: { kind: 'setSetting', componentId: 'source', key: 'rate', value: 30 } },
  { time: 20, intervention: { kind: 'removeComponent', componentId: 'web-2' } },
]

describe('Interventions on a timeline', () => {
  it('produces an identical Run on every execution', () => {
    const run = () => {
      const engine = createEngine(twoServers())
      playTimeline(engine, timeline).advanceTo(30)
      return { snapshot: engine.snapshot(), movements: engine.takeMovements() }
    }
    expect(run()).toEqual(run())
  })

  it('matches applying the same Interventions by hand at the same times', () => {
    const byPlayer = createEngine(twoServers())
    const player = playTimeline(byPlayer, timeline)
    // Advance in uneven frames, as the playback loop would.
    for (let t = 0; t < 30; t += 0.37) player.advanceTo(t)
    player.advanceTo(30)
    expect(player.remaining).toBe(0)

    const byHand = createEngine(twoServers())
    for (const { time, intervention } of timeline) {
      byHand.advanceTo(time)
      byHand.applyIntervention(intervention)
    }
    byHand.advanceTo(30)

    expect(byPlayer.snapshot()).toEqual(byHand.snapshot())
    expectEveryRequestAccountedFor(get.source(byHand))
  })
})

describe('adding and removing mid-Run', () => {
  it('brings an added Server into the round-robin', () => {
    const engine = createEngine(twoServers())
    engine.advanceTo(10)
    engine.applyIntervention({ kind: 'addComponent', component: { ...web, id: 'web-3' } })
    expect(get.worker(engine, 'web-3').received).toBe(0)
    engine.applyIntervention({ kind: 'addConnection', from: 'web-3', to: 'db' })
    engine.applyIntervention({ kind: 'addConnection', from: 'source', to: 'web-3' })

    const before = { created: get.source(engine).created, web1: get.worker(engine, 'web-1').received }
    engine.advanceTo(40)
    const created = get.source(engine).created - before.created
    const web1 = get.worker(engine, 'web-1').received - before.web1
    const web3 = get.worker(engine, 'web-3').received
    expect(Math.abs(web3 - created / 3)).toBeLessThanOrEqual(1)
    expect(Math.abs(web1 - created / 3)).toBeLessThanOrEqual(1)
    expect(get.worker(engine, 'web-3').completed).toBeGreaterThan(0)
  })

  it('fails the Requests inside a removed Component and keeps the accounting balanced', () => {
    const engine = createEngine(twoServers())
    engine.advanceTo(10)
    const inside = get.worker(engine, 'web-1').occupied + get.worker(engine, 'web-1').backlog
    expect(inside).toBeGreaterThan(0)
    const failedBefore = get.source(engine).outcomes.failed

    engine.applyIntervention({ kind: 'removeComponent', componentId: 'web-1' })
    expect(engine.snapshot().components['web-1']).toBeUndefined()
    expect(get.source(engine).outcomes.failed - failedBefore).toBe(inside)

    const createdAtRemoval = get.source(engine).created
    const web2AtRemoval = get.worker(engine, 'web-2').received
    engine.advanceTo(30)
    // Everything created since goes to web-2.
    expect(get.worker(engine, 'web-2').received - web2AtRemoval).toBe(get.source(engine).created - createdAtRemoval)
    expectEveryRequestAccountedFor(get.source(engine))
  })

  it('stops a removed Source and lets its Requests already in flight finish', () => {
    const engine = createEngine(twoServers())
    engine.advanceTo(10)
    engine.applyIntervention({ kind: 'removeComponent', componentId: 'source' })
    const received = get.worker(engine, 'web-1').received + get.worker(engine, 'web-2').received
    engine.advanceTo(30)
    expect(get.worker(engine, 'web-1').received + get.worker(engine, 'web-2').received).toBe(received)
    expect(get.worker(engine, 'web-1').occupied + get.worker(engine, 'web-2').occupied).toBe(0)
  })

  it('refuses to reuse the id of a Component removed earlier in the Run', () => {
    const engine = createEngine(twoServers())
    engine.advanceTo(5)
    engine.applyIntervention({ kind: 'removeComponent', componentId: 'web-2' })
    expect(() => engine.applyIntervention({ kind: 'addComponent', component: { ...web, id: 'web-2' } })).toThrow()
  })

  it('lets calls already on a removed Connection finish', () => {
    const engine = createEngine(twoServers())
    // Step to a moment when web-1 is waiting on the Database.
    let t = 10
    while (get.worker(engine, 'web-1').waitingOnCall === 0) engine.advanceTo((t += 0.01))
    const waiting = get.worker(engine, 'web-1').waitingOnCall
    expect(waiting).toBeGreaterThan(0)
    const completedBefore = get.worker(engine, 'web-1').completed
    engine.applyIntervention({ kind: 'removeConnection', from: 'web-1', to: 'db' })
    expect(get.worker(engine, 'web-1').waitingOnCall).toBe(waiting)
    engine.advanceTo(t + 2)
    // The calls in flight came back Completed; new work on web-1 now completes there without calling the Database.
    expect(get.worker(engine, 'web-1').completed).toBeGreaterThanOrEqual(completedBefore + waiting)
    expect(get.source(engine).outcomes.failed).toBe(0)
  })
})

describe('changing settings mid-Run', () => {
  it('does not interrupt work in progress when Concurrency is lowered', () => {
    const engine = createEngine(twoServers())
    engine.advanceTo(10)
    expect(get.worker(engine, 'web-1').occupied).toBe(2)
    engine.applyIntervention({ kind: 'setSetting', componentId: 'web-1', key: 'concurrency', value: 1 })
    expect(get.worker(engine, 'web-1')).toMatchObject({ occupied: 2, concurrency: 1 })

    engine.advanceTo(12)
    expect(get.worker(engine, 'web-1').occupied).toBeLessThanOrEqual(1)
    expect(get.source(engine).outcomes.failed).toBe(0)
  })

  it('puts waiting work into new slots at once when Concurrency is raised', () => {
    const engine = createEngine(twoServers())
    engine.advanceTo(10)
    const backlog = get.worker(engine, 'web-1').backlog
    expect(backlog).toBeGreaterThan(3)
    engine.applyIntervention({ kind: 'setSetting', componentId: 'web-1', key: 'concurrency', value: 5 })
    expect(get.worker(engine, 'web-1')).toMatchObject({ occupied: 5, backlog: backlog - 3 })
  })

  it('applies a new Rate at once rather than after the old gap', () => {
    const scenario = twoServers()
    const slow: Scenario = {
      ...scenario,
      architecture: {
        ...scenario.architecture,
        components: scenario.architecture.components.map((c) => (c.kind === 'source' ? { ...c, rate: 0.001 } : c)),
      },
    }
    const engine = createEngine(slow)
    engine.advanceTo(5)
    const created = get.source(engine).created
    engine.applyIntervention({ kind: 'setSetting', componentId: 'source', key: 'rate', value: 100 })
    engine.advanceTo(6)
    expect(get.source(engine).created - created).toBeGreaterThan(60)
  })

  it('lets a Queue use a downstream Server connected mid-Run', () => {
    const engine = createEngine({
      seed: 3,
      architecture: {
        components: [
          { kind: 'source', id: 'source', rate: 10, timeLimit: 2 },
          { kind: 'queue', id: 'queue', capacity: 500 },
          { ...web, id: 'worker-1' },
        ],
        connections: [
          { from: 'source', to: 'queue' },
          { from: 'queue', to: 'worker-1' },
        ],
      },
    })
    engine.advanceTo(10)
    engine.applyIntervention({ kind: 'removeConnection', from: 'queue', to: 'worker-1' })
    engine.advanceTo(20)
    const held = get.queue(engine, 'queue').depth
    expect(held).toBeGreaterThan(80)

    engine.applyIntervention({ kind: 'addComponent', component: { ...web, id: 'worker-2', concurrency: 10, workTime: 0.01 } })
    engine.applyIntervention({ kind: 'addConnection', from: 'queue', to: 'worker-2' })
    // The new worker's free slots are filled straight away.
    expect(get.worker(engine, 'worker-2').occupied).toBe(10)
    engine.advanceTo(40)
    expect(get.queue(engine, 'queue').depth).toBeLessThan(5)
  })
})
