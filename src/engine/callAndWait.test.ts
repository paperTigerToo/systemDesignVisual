import { describe, expect, it } from 'vitest'
import { createEngine, type Movement, type Scenario, type SourceSnapshot, type WorkerSnapshot } from './index'

interface Numbers {
  seed?: number
  rate: number
  server: { concurrency: number; workTime: number }
  database: { concurrency: number; workTime: number }
}

function sourceServerDatabase({ seed = 1, rate, server, database }: Numbers): Scenario {
  return {
    seed,
    architecture: {
      components: [
        { kind: 'source', id: 'source', rate },
        { kind: 'server', id: 'server', ...server },
        { kind: 'database', id: 'database', ...database },
      ],
      connections: [
        { from: 'source', to: 'server' },
        { from: 'server', to: 'database' },
      ],
    },
  }
}

function parts(snapshot: ReturnType<ReturnType<typeof createEngine>['snapshot']>) {
  const { source, server, database } = snapshot.components
  if (source?.kind !== 'source' || server?.kind !== 'server' || database?.kind !== 'database') {
    throw new Error('unexpected snapshot shape')
  }
  return { source: source as SourceSnapshot, server: server as WorkerSnapshot, database: database as WorkerSnapshot }
}

describe('call-and-wait', () => {
  it('saturates a fast Server when the Database behind it is the bottleneck', () => {
    // Server could handle 1000 per second on its own; the Database only 10 per second.
    const scenario = sourceServerDatabase({
      rate: 20,
      server: { concurrency: 4, workTime: 0.001 },
      database: { concurrency: 1, workTime: 0.1 },
    })
    const engine = createEngine(scenario)

    engine.advanceTo(50)
    const at50 = parts(engine.snapshot())
    engine.advanceTo(100)
    const at100 = parts(engine.snapshot())

    expect(at100.server.occupied).toBe(4)
    expect(at100.server.waitingOnCall).toBeGreaterThanOrEqual(3)
    expect(at50.server.backlog).toBeGreaterThan(300)
    expect(at100.server.backlog).toBeGreaterThan(at50.server.backlog + 300)
    // The pile-up is in front of the Server: the Database never holds more than the Server can send it.
    expect(at100.database.occupied + at100.database.backlog).toBeLessThanOrEqual(4)
  })

  it('measures latency as the sum of the Server and Database Work times when both are idle', () => {
    const scenario = sourceServerDatabase({
      seed: 3,
      rate: 0.01,
      server: { concurrency: 1, workTime: 0.2 },
      database: { concurrency: 1, workTime: 0.5 },
    })

    // Step until the first Request has completed, collecting its movements.
    const engine = createEngine(scenario)
    const movements: Movement[] = []
    let t = 0
    while (parts(engine.snapshot()).source.completed === 0) {
      t += 0.05
      engine.advanceTo(t)
      movements.push(...engine.takeMovements())
    }
    const hop = (from: string, to: string) => movements.find((m) => m.from === from && m.to === to)!.time
    const created = hop('source', 'server')
    const serverDone = hop('server', 'database')
    const databaseDone = hop('database', 'server')

    expect(hop('server', 'source')).toBe(databaseDone)
    expect(serverDone).toBeGreaterThan(created)
    expect(databaseDone).toBeGreaterThan(serverDone)
    const serverWork = serverDone - created
    const databaseWork = databaseDone - serverDone
    expect(parts(engine.snapshot()).source.averageLatency).toBeCloseTo(serverWork + databaseWork, 9)

    // Replay to the middle of the Database's work: the Server's slot is held while it waits.
    const replay = createEngine(scenario)
    replay.advanceTo((serverDone + databaseDone) / 2)
    const middle = parts(replay.snapshot())
    expect(middle.server).toMatchObject({ occupied: 1, waitingOnCall: 1, completed: 0 })
    expect(middle.database).toMatchObject({ occupied: 1, completed: 0 })
  })

  it('accounts for every Request across both Components', () => {
    const engine = createEngine(
      sourceServerDatabase({
        rate: 30,
        server: { concurrency: 3, workTime: 0.02 },
        database: { concurrency: 2, workTime: 0.08 },
      }),
    )
    engine.advanceTo(60)
    const { source, server, database } = parts(engine.snapshot())
    // Every Request in the Database is also holding a Server slot.
    expect(source.created).toBe(source.completed + server.occupied + server.backlog)
    expect(server.completed).toBe(source.completed)
    expect(database.completed).toBeGreaterThanOrEqual(server.completed)
    expect(database.occupied).toBeLessThanOrEqual(server.waitingOnCall)
  })

  it('is deterministic with a Database in the path', () => {
    const scenario = sourceServerDatabase({
      seed: 11,
      rate: 15,
      server: { concurrency: 2, workTime: 0.05 },
      database: { concurrency: 1, workTime: 0.08 },
    })
    const a = createEngine(scenario)
    const b = createEngine(scenario)
    a.advanceTo(40)
    b.advanceTo(40)
    expect(a.snapshot()).toEqual(b.snapshot())
    expect(a.takeMovements()).toEqual(b.takeMovements())
  })
})
