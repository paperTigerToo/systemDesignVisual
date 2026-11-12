import { describe, expect, it } from 'vitest'
import { createEngine, type Scenario, type WorkerSnapshot } from './index'

function sourceToServer(options: { seed?: number; rate: number; concurrency: number; workTime: number }): Scenario {
  return {
    seed: options.seed ?? 1,
    architecture: {
      components: [
        { kind: 'source', id: 'source', rate: options.rate },
        { kind: 'server', id: 'server', concurrency: options.concurrency, workTime: options.workTime },
      ],
      connections: [{ from: 'source', to: 'server' }],
    },
  }
}

function serverAt(scenario: Scenario, t: number): WorkerSnapshot {
  const engine = createEngine(scenario)
  engine.advanceTo(t)
  const server = engine.snapshot().components.server
  if (server?.kind !== 'server') throw new Error('expected a Server')
  return server
}

describe('determinism', () => {
  it('produces identical snapshots for the same Scenario', () => {
    const scenario = sourceToServer({ seed: 42, rate: 12, concurrency: 2, workTime: 0.2 })
    const a = createEngine(scenario)
    const b = createEngine(scenario)
    a.advanceTo(60)
    b.advanceTo(60)
    expect(a.snapshot()).toEqual(b.snapshot())
    expect(a.takeMovements()).toEqual(b.takeMovements())
  })

  it('gives the same result whether time is advanced in one step or many', () => {
    const scenario = sourceToServer({ seed: 7, rate: 12, concurrency: 2, workTime: 0.2 })
    const oneStep = createEngine(scenario)
    oneStep.advanceTo(30)
    const manySteps = createEngine(scenario)
    for (let t = 0; t <= 30; t += 1 / 60) manySteps.advanceTo(t)
    manySteps.advanceTo(30)
    expect(manySteps.snapshot()).toEqual(oneStep.snapshot())
  })

  it('produces a different Run for a different seed', () => {
    const a = createEngine(sourceToServer({ seed: 1, rate: 12, concurrency: 2, workTime: 0.2 }))
    const b = createEngine(sourceToServer({ seed: 2, rate: 12, concurrency: 2, workTime: 0.2 }))
    a.advanceTo(60)
    b.advanceTo(60)
    expect(a.snapshot()).not.toEqual(b.snapshot())
  })
})

describe('Source and Server', () => {
  it('keeps the Backlog near empty when the Rate is well below capacity', () => {
    // Capacity is Concurrency / Work time = 1 / 0.1 = 10 Requests per second.
    const scenario = sourceToServer({ rate: 5, concurrency: 1, workTime: 0.1 })
    for (const t of [100, 200, 300]) {
      expect(serverAt(scenario, t).backlog).toBeLessThan(15)
    }
  })

  it('grows the Backlog steadily when the Rate is above capacity', () => {
    // 20 Requests per second arrive, at most 10 per second finish: about 10 per second pile up.
    const scenario = sourceToServer({ rate: 20, concurrency: 1, workTime: 0.1 })
    const at100 = serverAt(scenario, 100).backlog
    const at200 = serverAt(scenario, 200).backlog
    expect(at100).toBeGreaterThan(700)
    expect(at200).toBeGreaterThan(at100 + 700)
  })

  it('never works on more Requests than its Concurrency', () => {
    const engine = createEngine(sourceToServer({ rate: 50, concurrency: 3, workTime: 0.2 }))
    for (let t = 0; t < 20; t += 0.05) {
      engine.advanceTo(t)
      const server = engine.snapshot().components.server as WorkerSnapshot
      expect(server.occupied).toBeLessThanOrEqual(3)
    }
  })

  it('accounts for every Request created', () => {
    const engine = createEngine(sourceToServer({ rate: 30, concurrency: 2, workTime: 0.1 }))
    engine.advanceTo(50)
    const { source, server } = engine.snapshot().components
    if (source?.kind !== 'source' || server?.kind !== 'server') throw new Error('unexpected shape')
    expect(source.created).toBe(server.completed + server.occupied + server.backlog)
    expect(source.completed).toBe(server.completed)
  })

  it('records a movement for each Request sent, up to the cap', () => {
    const engine = createEngine(sourceToServer({ rate: 10, concurrency: 1, workTime: 0.05 }), { movementCap: 5 })
    engine.advanceTo(10)
    const movements = engine.takeMovements()
    expect(movements).toHaveLength(5)
    expect(movements[0]).toMatchObject({ from: 'source', to: 'server', direction: 'call' })
    expect(engine.takeMovements()).toHaveLength(0)
  })
})
