import { describe, expect, it } from 'vitest'
import { createEngine, type Scenario, type Snapshot, type SourceSnapshot, type WorkerSnapshot } from './index'

interface WorkerNumbers {
  concurrency: number
  workTime: number
  backlogCapacity: number
}

function sourceServerDatabase(options: {
  seed?: number
  rate: number
  timeLimit: number
  server: WorkerNumbers
  database: WorkerNumbers
}): Scenario {
  return {
    seed: options.seed ?? 5,
    architecture: {
      components: [
        { kind: 'source', id: 'source', rate: options.rate, timeLimit: options.timeLimit },
        { kind: 'server', id: 'server', ...options.server },
        { kind: 'database', id: 'database', ...options.database },
      ],
      connections: [
        { from: 'source', to: 'server' },
        { from: 'server', to: 'database' },
      ],
    },
  }
}

function parts(snapshot: Snapshot) {
  const { source, server, database } = snapshot.components
  if (source?.kind !== 'source' || server?.kind !== 'server' || database?.kind !== 'database') {
    throw new Error('unexpected snapshot shape')
  }
  return { source: source as SourceSnapshot, server: server as WorkerSnapshot, database: database as WorkerSnapshot }
}

function expectEveryRequestAccountedFor(source: SourceSnapshot): void {
  const { completed, rejected, timedOut } = source.outcomes
  expect(source.inProgress).toBeGreaterThanOrEqual(0)
  expect(completed + rejected + timedOut + source.inProgress).toBe(source.created)
}

describe('Backlog capacity', () => {
  it('never lets a Backlog exceed its capacity and Rejects the overflow', () => {
    const engine = createEngine(
      sourceServerDatabase({
        rate: 40,
        timeLimit: Infinity,
        server: { concurrency: 2, workTime: 0.1, backlogCapacity: 5 },
        database: { concurrency: 4, workTime: 0.01, backlogCapacity: 50 },
      }),
    )
    for (let t = 0; t <= 30; t += 0.02) {
      engine.advanceTo(t)
      const { server, database } = parts(engine.snapshot())
      expect(server.backlog).toBeLessThanOrEqual(5)
      expect(database.backlog).toBeLessThanOrEqual(50)
    }
    const { source, server } = parts(engine.snapshot())
    expect(server.rejected).toBeGreaterThan(100)
    expect(source.outcomes.rejected).toBe(server.rejected)
    expect(server.lastRejectedAt).not.toBeNull()
    expectEveryRequestAccountedFor(source)
  })

  it('sends a Rejected response from the Database back to the Source and frees the Server slot', () => {
    // The Database holds one very slow Request and has no Backlog: everything else is Rejected.
    const engine = createEngine(
      sourceServerDatabase({
        rate: 20,
        timeLimit: Infinity,
        server: { concurrency: 2, workTime: 0.0001, backlogCapacity: 10 },
        database: { concurrency: 1, workTime: 1000, backlogCapacity: 0 },
      }),
    )
    engine.advanceTo(30)
    const { source, server, database } = parts(engine.snapshot())

    expect(database.rejected).toBeGreaterThan(400)
    expect(source.outcomes.rejected).toBe(database.rejected)
    expect(server.rejected).toBe(0)
    // Only the call stuck in the Database still holds a Server slot; Rejected calls released theirs.
    expect(server.waitingOnCall).toBe(1)
    expect(server.backlog).toBe(0)
    expect(server.completed).toBe(0)
    expectEveryRequestAccountedFor(source)
  })
})

describe('time limit', () => {
  it('times out slow Requests exactly once while the Components finish the wasted work', () => {
    // Database Work time averages 5 s against a 0.5 s time limit: about 90% time out.
    const engine = createEngine(
      sourceServerDatabase({
        rate: 2,
        timeLimit: 0.5,
        server: { concurrency: 100, workTime: 0.001, backlogCapacity: 100 },
        database: { concurrency: 100, workTime: 5, backlogCapacity: 100 },
      }),
    )
    engine.advanceTo(200)
    const { source, server, database } = parts(engine.snapshot())

    expect(source.outcomes.timedOut).toBeGreaterThan(source.created * 0.8)
    expect(source.outcomes.completed).toBeGreaterThan(0)
    expect(source.outcomes.rejected).toBe(0)
    expectEveryRequestAccountedFor(source)
    // Nothing was Rejected, so every Request created reached the Database and is finished or still being worked on.
    expect(database.completed + database.occupied + database.backlog).toBe(source.created)
    // Every response the Server passed back, including late ones, was counted by the Server.
    expect(server.completed).toBe(database.completed)
    // Completed Requests all beat the time limit.
    expect(source.averageLatency!).toBeLessThanOrEqual(0.5)
  })

  it('counts a Request that responds after its time limit only as Timed out', () => {
    const engine = createEngine(
      sourceServerDatabase({
        rate: 1,
        timeLimit: 0.05,
        server: { concurrency: 50, workTime: 0.5, backlogCapacity: 50 },
        database: { concurrency: 50, workTime: 0.5, backlogCapacity: 50 },
      }),
    )
    engine.advanceTo(100)
    const { source } = parts(engine.snapshot())
    expectEveryRequestAccountedFor(source)
    // Two 0.5 s average Work times almost never fit in 0.05 s, so nearly every finished Request timed out,
    // and the late Completed responses that followed did not add to the count.
    const finished = source.created - source.inProgress
    expect(source.outcomes.timedOut).toBeGreaterThanOrEqual(finished * 0.95)
    expect(source.outcomes.completed).toBeLessThanOrEqual(finished * 0.05)
  })
})

describe('Utilisation', () => {
  it('reports occupied slots as a share of Concurrency', () => {
    const engine = createEngine(
      sourceServerDatabase({
        rate: 50,
        timeLimit: Infinity,
        server: { concurrency: 4, workTime: 0.001, backlogCapacity: 1000 },
        database: { concurrency: 2, workTime: 0.2, backlogCapacity: 1000 },
      }),
    )
    engine.advanceTo(20)
    const { server, database } = parts(engine.snapshot())
    expect(server.utilisation).toBe(server.occupied / 4)
    expect(database.utilisation).toBe(1)
  })

  it('accumulates occupied slot-seconds whose average matches the offered load', () => {
    // Database alone sees 4 Requests per second at 0.1 s each on 1 slot: 40% busy on average.
    const engine = createEngine(
      sourceServerDatabase({
        seed: 9,
        rate: 4,
        timeLimit: Infinity,
        server: { concurrency: 50, workTime: 0.000001, backlogCapacity: 1000 },
        database: { concurrency: 1, workTime: 0.1, backlogCapacity: 1000 },
      }),
    )
    engine.advanceTo(1000)
    const first = parts(engine.snapshot()).database.occupiedTime
    engine.advanceTo(3000)
    const second = parts(engine.snapshot()).database.occupiedTime
    expect(first / 1000).toBeCloseTo(0.4, 1)
    expect((second - first) / 2000).toBeCloseTo(0.4, 1)
  })
})

describe('determinism', () => {
  it('is unchanged by Rejections and time limits', () => {
    const scenario = sourceServerDatabase({
      seed: 21,
      rate: 30,
      timeLimit: 0.3,
      server: { concurrency: 2, workTime: 0.05, backlogCapacity: 3 },
      database: { concurrency: 1, workTime: 0.06, backlogCapacity: 2 },
    })
    const a = createEngine(scenario)
    const b = createEngine(scenario)
    a.advanceTo(40)
    b.advanceTo(40)
    expect(a.snapshot()).toEqual(b.snapshot())
    expect(a.takeMovements()).toEqual(b.takeMovements())
  })
})
