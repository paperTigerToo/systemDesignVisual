import { describe, expect, it } from 'vitest'
import { createEngine, percentile, type Scenario } from './index'

function sourceServerDatabase(options: { seed?: number; rate: number }): Scenario {
  return {
    seed: options.seed ?? 1,
    architecture: {
      components: [
        { kind: 'source', id: 'source', rate: options.rate, timeLimit: 2 },
        { kind: 'server', id: 'server', concurrency: 8, workTime: 0.05, backlogCapacity: 100 },
        { kind: 'database', id: 'database', concurrency: 8, workTime: 0.02, backlogCapacity: 100 },
      ],
      connections: [
        { from: 'source', to: 'server' },
        { from: 'server', to: 'database' },
      ],
    },
  }
}

describe('percentile', () => {
  const latencies = [0.9, 0.1, 0.5, 0.3, 0.7, 0.2, 0.4, 0.8, 0.6, 1.0]

  it('interpolates between the nearest ranks', () => {
    expect(percentile(latencies, 0.5)).toBeCloseTo(0.55)
    expect(percentile(latencies, 0.95)).toBeCloseTo(0.955)
    expect(percentile(latencies, 0)).toBe(0.1)
    expect(percentile(latencies, 1)).toBe(1.0)
  })

  it('handles one value and no values', () => {
    expect(percentile([0.25], 0.95)).toBe(0.25)
    expect(percentile([], 0.5)).toBeNull()
  })

  it('does not reorder its input', () => {
    const copy = [...latencies]
    percentile(latencies, 0.5)
    expect(latencies).toEqual(copy)
  })
})

describe('metric series', () => {
  it('are part of the deterministic output', () => {
    const scenario = sourceServerDatabase({ seed: 3, rate: 40 })
    const a = createEngine(scenario)
    a.advanceTo(45)
    const b = createEngine(scenario)
    for (let t = 0; t <= 45; t += 1 / 60) b.advanceTo(t)
    b.advanceTo(45)
    expect(b.metrics()).toEqual(a.metrics())
  })

  it('are sampled at exact multiples of the interval over a rolling window', () => {
    const engine = createEngine(sourceServerDatabase({ rate: 10 }), { metricsInterval: 0.5, metricsWindow: 30 })
    engine.advanceTo(40.2)
    const samples = engine.metrics()
    expect(samples).toHaveLength(60)
    expect(samples[0]!.time).toBe(10.5)
    expect(samples.at(-1)!.time).toBe(40)
  })

  it('reports completed per second close to the Rate when under-loaded', () => {
    const engine = createEngine(sourceServerDatabase({ rate: 50 }))
    engine.advanceTo(60)
    const samples = engine.metrics()
    const mean = samples.reduce((sum, s) => sum + s.overall.completedPerSecond, 0) / samples.length
    expect(mean).toBeGreaterThan(45)
    expect(mean).toBeLessThan(55)
    const source = samples.at(-1)!.components.source
    expect(source?.kind).toBe('source')
  })

  it('reports Utilisation, Backlog and latency percentiles in sensible ranges', () => {
    const engine = createEngine(sourceServerDatabase({ rate: 50 }))
    engine.advanceTo(30)
    for (const sample of engine.metrics()) {
      const server = sample.components.server
      if (server?.kind !== 'server') throw new Error('expected a Server')
      expect(server.utilisation).toBeGreaterThanOrEqual(0)
      expect(server.utilisation).toBeLessThanOrEqual(1)
      const { medianLatency, p95Latency } = sample.overall
      if (medianLatency !== null && p95Latency !== null) expect(p95Latency).toBeGreaterThanOrEqual(medianLatency)
    }
    // Each Server slot is held for about 0.05 s + 0.02 s; 50 req/s over 8 slots is roughly 44% busy.
    const samples = engine.metrics()
    const mean =
      samples.reduce((sum, s) => sum + (s.components.server as { utilisation: number }).utilisation, 0) / samples.length
    expect(mean).toBeGreaterThan(0.3)
    expect(mean).toBeLessThan(0.6)
  })

  it('stops a removed Component series and starts an added one', () => {
    const engine = createEngine(sourceServerDatabase({ rate: 10 }))
    engine.advanceTo(5)
    engine.applyIntervention({ kind: 'addComponent', component: { kind: 'queue', id: 'queue', capacity: 10 } })
    engine.advanceTo(10)
    engine.applyIntervention({ kind: 'removeComponent', componentId: 'queue' })
    engine.advanceTo(15)
    const withQueue = engine.metrics().filter((s) => 'queue' in s.components)
    expect(withQueue[0]!.time).toBe(5.5)
    expect(withQueue.at(-1)!.time).toBe(10)
  })
})
