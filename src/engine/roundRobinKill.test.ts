import { describe, expect, it } from 'vitest'
import { createEngine, type Engine, type Scenario, type SourceSnapshot, type WorkerSnapshot } from './index'

interface WorkerNumbers {
  concurrency: number
  workTime: number
  backlogCapacity: number
}

const servers = ['s1', 's2', 's3'] as const

/** Source to three identical Servers to one Database. */
function threeServers(options: {
  seed?: number
  rate: number
  timeLimit?: number
  server: WorkerNumbers
  database: WorkerNumbers
}): Scenario {
  return {
    seed: options.seed ?? 4,
    architecture: {
      components: [
        { kind: 'source', id: 'source', rate: options.rate, timeLimit: options.timeLimit ?? Infinity },
        ...servers.map((id) => ({ kind: 'server' as const, id, ...options.server })),
        { kind: 'database', id: 'db', ...options.database },
      ],
      connections: [
        ...servers.map((id) => ({ from: 'source', to: id })),
        ...servers.map((id) => ({ from: id, to: 'db' })),
      ],
    },
  }
}

function source(engine: Engine): SourceSnapshot {
  return engine.snapshot().components.source as SourceSnapshot
}

function worker(engine: Engine, id: string): WorkerSnapshot {
  return engine.snapshot().components[id] as WorkerSnapshot
}

function expectEveryRequestAccountedFor(snapshot: SourceSnapshot): void {
  const { completed, rejected, failed, timedOut } = snapshot.outcomes
  expect(snapshot.inProgress).toBeGreaterThanOrEqual(0)
  expect(completed + rejected + failed + timedOut + snapshot.inProgress).toBe(snapshot.created)
}

const roomy = {
  rate: 30,
  server: { concurrency: 4, workTime: 0.05, backlogCapacity: 1000 },
  database: { concurrency: 20, workTime: 0.02, backlogCapacity: 1000 },
}

describe('round-robin', () => {
  it('gives each of three live Servers exactly a third of the Requests', () => {
    const engine = createEngine(threeServers(roomy))
    engine.advanceTo(100)
    const created = source(engine).created
    const received = servers.map((id) => worker(engine, id).received)
    expect(received.reduce((a, b) => a + b, 0)).toBe(created)
    // In order s1, s2, s3, s1, ...: counts differ by at most one, earliest first.
    expect(received[0]! - received[2]!).toBeLessThanOrEqual(1)
    expect(received[0]).toBeGreaterThanOrEqual(received[1]!)
    expect(received[1]).toBeGreaterThanOrEqual(received[2]!)
  })

  it('skips a Killed Server and splits everything between the other two', () => {
    const engine = createEngine(threeServers(roomy))
    engine.advanceTo(20)
    engine.applyIntervention({ kind: 'kill', componentId: 's2' })
    const createdBefore = source(engine).created
    const [s1Before, s2Before, s3Before] = servers.map((id) => worker(engine, id).received)

    engine.advanceTo(80)
    const createdSince = source(engine).created - createdBefore
    const s1Since = worker(engine, 's1').received - s1Before!
    const s3Since = worker(engine, 's3').received - s3Before!

    expect(worker(engine, 's2').received).toBe(s2Before)
    expect(s1Since + s3Since).toBe(createdSince)
    expect(Math.abs(s1Since - s3Since)).toBeLessThanOrEqual(1)
  })
})

describe('Kill and revive', () => {
  // Slow Servers so plenty of Requests are inside each one at any moment.
  const busy = {
    rate: 40,
    server: { concurrency: 3, workTime: 0.2, backlogCapacity: 20 },
    database: { concurrency: 6, workTime: 0.1, backlogCapacity: 50 },
  }

  it('fails every Request inside a Killed Server, including its Backlog and calls in the Database', () => {
    const engine = createEngine(threeServers(busy))
    engine.advanceTo(15)
    const s1Before = worker(engine, 's1')
    const inside = s1Before.occupied + s1Before.backlog
    const dbOccupiedBefore = worker(engine, 'db').occupied
    expect(inside).toBeGreaterThan(0)

    engine.applyIntervention({ kind: 'kill', componentId: 's1' })

    const s1 = worker(engine, 's1')
    expect(s1).toMatchObject({ killed: true, occupied: 0, waitingOnCall: 0, backlog: 0, failed: inside })
    expect(source(engine).outcomes.failed).toBe(inside)
    // Work s1 had already handed to the Database carries on as wasted work.
    expect(worker(engine, 'db').occupied).toBe(dbOccupiedBefore)
    expectEveryRequestAccountedFor(source(engine))
  })

  it('fails Requests waiting on a Killed Database and frees the Server slots holding them', () => {
    const engine = createEngine(threeServers(busy))
    engine.advanceTo(15)
    const db = worker(engine, 'db')
    const waiting = servers.reduce((sum, id) => sum + worker(engine, id).waitingOnCall, 0)
    expect(waiting).toBe(db.occupied + db.backlog)
    expect(waiting).toBeGreaterThan(0)

    engine.applyIntervention({ kind: 'kill', componentId: 'db' })

    expect(worker(engine, 'db').failed).toBe(waiting)
    expect(source(engine).outcomes.failed).toBe(waiting)
    for (const id of servers) expect(worker(engine, id).waitingOnCall).toBe(0)

    // With the only Database Killed, every Request that finishes its Server work fails.
    const completedBefore = source(engine).outcomes.completed
    engine.advanceTo(40)
    expect(source(engine).outcomes.completed).toBe(completedBefore)
    expect(source(engine).outcomes.failed).toBeGreaterThan(waiting + 500)
    expectEveryRequestAccountedFor(source(engine))
  })

  it('fails new Requests immediately when every alternative is Killed', () => {
    const engine = createEngine(threeServers(busy))
    engine.advanceTo(10)
    for (const id of servers) engine.applyIntervention({ kind: 'kill', componentId: id })
    const before = source(engine)

    engine.advanceTo(30)
    const after = source(engine)
    expect(after.outcomes.failed - before.outcomes.failed).toBe(after.created - before.created)
    expect(after.inProgress).toBe(0)
  })

  it('brings a revived Server back empty and into the rotation', () => {
    const engine = createEngine(threeServers(busy))
    engine.advanceTo(10)
    engine.applyIntervention({ kind: 'kill', componentId: 's3' })
    engine.advanceTo(20)
    const receivedWhileKilled = worker(engine, 's3').received

    engine.applyIntervention({ kind: 'revive', componentId: 's3' })
    expect(worker(engine, 's3')).toMatchObject({ killed: false, occupied: 0, backlog: 0 })

    engine.advanceTo(30)
    expect(worker(engine, 's3').received).toBeGreaterThan(receivedWhileKilled + 50)
    expectEveryRequestAccountedFor(source(engine))
  })

  it('keeps every Request accounted for across Kills and revivals with a time limit', () => {
    const engine = createEngine(threeServers({ ...busy, timeLimit: 0.5 }))
    const plan: [number, 'kill' | 'revive', string][] = [
      [5, 'kill', 's1'],
      [8, 'kill', 'db'],
      [9, 'revive', 'db'],
      [12, 'kill', 's2'],
      [14, 'revive', 's1'],
      [18, 'revive', 's2'],
    ]
    for (const [t, kind, componentId] of plan) {
      engine.advanceTo(t)
      engine.applyIntervention({ kind, componentId })
      expectEveryRequestAccountedFor(source(engine))
    }
    engine.advanceTo(30)
    expectEveryRequestAccountedFor(source(engine))
  })

  it('treats Killing a Killed Component and reviving a live one as no change', () => {
    const engine = createEngine(threeServers(busy))
    engine.advanceTo(5)
    engine.applyIntervention({ kind: 'revive', componentId: 's1' })
    engine.applyIntervention({ kind: 'kill', componentId: 's1' })
    const failed = worker(engine, 's1').failed
    engine.applyIntervention({ kind: 'kill', componentId: 's1' })
    expect(worker(engine, 's1').failed).toBe(failed)
  })
})

describe('determinism', () => {
  it('produces the same Run with a Kill and revive at fixed simulated times', () => {
    const run = () => {
      const engine = createEngine(threeServers({ ...roomy, seed: 99, timeLimit: 1 }))
      engine.advanceTo(7)
      engine.applyIntervention({ kind: 'kill', componentId: 's2' })
      engine.advanceTo(15)
      engine.applyIntervention({ kind: 'revive', componentId: 's2' })
      engine.advanceTo(25)
      return { snapshot: engine.snapshot(), movements: engine.takeMovements() }
    }
    expect(run()).toEqual(run())
  })
})
