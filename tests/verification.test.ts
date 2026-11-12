/**
 * Checks the engine against textbook queueing results, not just against
 * itself. Each case runs one Source into one Server for a long simulated
 * time with a fixed seed, discards a warm-up period, and compares what the
 * engine measured with the closed-form answer. See docs/engine-verification.md.
 */
import { describe, expect, it } from 'vitest'
import { createEngine, type Engine, type Scenario, type SourceSnapshot, type WorkerSnapshot } from '../src/engine'
import { erlangC, mm1, mmck } from './queueing'

const SEEDS = [1, 2, 3]
const WARM_UP = 200

function sourceToServer(seed: number, rate: number, concurrency: number, workTime: number, backlogCapacity: number): Scenario {
  return {
    seed,
    architecture: {
      components: [
        // No time limit: every Request waits as long as it takes, as in the formulas.
        { kind: 'source', id: 'source', rate, timeLimit: Infinity },
        { kind: 'server', id: 'server', concurrency, workTime, backlogCapacity },
      ],
      connections: [{ from: 'source', to: 'server' }],
    },
  }
}

function read(engine: Engine) {
  const { source, server } = engine.snapshot().components as { source: SourceSnapshot; server: WorkerSnapshot }
  return {
    time: engine.time,
    completed: source.outcomes.completed,
    latencySum: (source.averageLatency ?? 0) * source.outcomes.completed,
    occupiedTime: server.occupiedTime,
    received: server.received,
    rejected: server.rejected,
  }
}

/** Measurements over [WARM_UP, until]: averages of what happened after the warm-up only. */
function measure(scenario: Scenario, until: number, concurrency: number) {
  const engine = createEngine(scenario, { movementCap: 0 })
  engine.advanceTo(WARM_UP)
  const start = read(engine)
  engine.advanceTo(until)
  const end = read(engine)
  return {
    utilisation: (end.occupiedTime - start.occupiedTime) / ((end.time - start.time) * concurrency),
    timeInSystem: (end.latencySum - start.latencySum) / (end.completed - start.completed),
    rejectedShare: (end.rejected - start.rejected) / (end.received - start.received),
  }
}

const relativeError = (measured: number, expected: number) => Math.abs(measured - expected) / expected

describe('M/M/1: one Server, Concurrency 1, unlimited Backlog', () => {
  // Arrivals 7 per second, Work time 0.1 s (service rate 10): 70% Utilisation.
  const lambda = 7
  const mu = 10
  const expected = mm1(lambda, mu)

  it.each(SEEDS)('matches Utilisation and time in Backlog (seed %i)', (seed) => {
    const measured = measure(sourceToServer(seed, lambda, 1, 1 / mu, Infinity), 12_000, 1)
    // Under call-and-wait a Server with no downstream holds its slot only for its own Work time,
    // so time in Backlog is latency minus the mean Work time.
    const timeInBacklog = measured.timeInSystem - 1 / mu
    expect(Math.abs(measured.utilisation - expected.utilisation)).toBeLessThan(0.01)
    expect(relativeError(measured.timeInSystem, expected.timeInSystem)).toBeLessThan(0.06)
    expect(relativeError(timeInBacklog, expected.timeInBacklog)).toBeLessThan(0.08)
  })
})

describe('M/M/c (Erlang C): one Server, Concurrency 4, unlimited Backlog', () => {
  // Arrivals 30 per second, Work time 0.1 s on each of 4 slots: 75% Utilisation.
  const lambda = 30
  const mu = 10
  const c = 4
  const expected = erlangC(lambda, mu, c)

  it.each(SEEDS)('matches the probability of waiting (seed %i)', (seed) => {
    const engine = createEngine(sourceToServer(seed, lambda, c, 1 / mu, Infinity), { movementCap: 0 })
    engine.advanceTo(WARM_UP)
    // Arrivals are Poisson, so the share of arrivals that must wait equals the share of time
    // every slot is busy. Sample that on a fine regular grid.
    let samples = 0
    let allBusy = 0
    for (let t = WARM_UP; t < 4_000; t += 0.05) {
      engine.advanceTo(t)
      const server = engine.snapshot().components.server as WorkerSnapshot
      samples++
      if (server.occupied >= c) allBusy++
    }
    expect(Math.abs(allBusy / samples - expected.probabilityOfWaiting)).toBeLessThan(0.02)
  })

  it.each(SEEDS)('matches the mean time in Backlog, which follows from it (seed %i)', (seed) => {
    const measured = measure(sourceToServer(seed, lambda, c, 1 / mu, Infinity), 8_000, c)
    expect(Math.abs(measured.utilisation - expected.utilisation)).toBeLessThan(0.01)
    expect(relativeError(measured.timeInSystem - 1 / mu, expected.timeInBacklog)).toBeLessThan(0.1)
  })
})

describe('M/M/c/K: one Server with a small Backlog capacity', () => {
  // Overloaded on purpose: arrivals 25 per second against 2 slots at 10 per second each,
  // with room for 3 more in the Backlog (K = 5).
  const lambda = 25
  const mu = 10
  const c = 2
  const backlog = 3
  const expected = mmck(lambda, mu, c, c + backlog)

  it.each(SEEDS)('matches the share of Requests Rejected (seed %i)', (seed) => {
    const measured = measure(sourceToServer(seed, lambda, c, 1 / mu, backlog), 6_000, c)
    expect(Math.abs(measured.rejectedShare - expected.rejectedShare)).toBeLessThan(0.01)
    expect(Math.abs(measured.utilisation - expected.utilisation)).toBeLessThan(0.01)
  })

  it.each(SEEDS)('also holds when lightly loaded, where Rejections are rare (seed %i)', (seed) => {
    const light = mmck(12, mu, c, c + backlog)
    const measured = measure(sourceToServer(seed, 12, c, 1 / mu, backlog), 6_000, c)
    expect(Math.abs(measured.rejectedShare - light.rejectedShare)).toBeLessThan(0.01)
  })
})
