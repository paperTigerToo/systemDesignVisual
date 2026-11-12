import { describe, expect, it } from 'vitest'
import { createEngine, playTimeline, validateArchitecture, type MetricSample, type WorkerMetrics } from '../engine'
import { builtInScenarios, moreServersDidNotFixIt, oneServerDown, queueAbsorbsABurst } from './builtInScenarios'
import { parseScenario, scenarioFromJson, scenarioFromUrlParam, scenarioToJson, scenarioToUrlParam, type ScenarioDocument } from './scenario'

/** Play a Scenario's recorded Interventions on a fresh engine up to `until` and return its metric samples. */
function run(scenario: ScenarioDocument, until: number) {
  const engine = createEngine({ seed: scenario.seed, architecture: scenario.architecture }, { metricsWindow: 60 })
  playTimeline(engine, scenario.interventions).advanceTo(until)
  return { engine, samples: engine.metrics() }
}

function between(samples: MetricSample[], from: number, to: number) {
  return samples.filter((s) => s.time > from && s.time <= to)
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length

describe('Scenario format', () => {
  it('survives JSON and back without loss', () => {
    for (const scenario of builtInScenarios) {
      const result = scenarioFromJson(scenarioToJson(scenario))
      expect(result).toEqual({ ok: true, scenario })
    }
  })

  it('survives a share URL and back without loss', async () => {
    for (const scenario of builtInScenarios) {
      const param = await scenarioToUrlParam(scenario)
      expect(param).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(await scenarioFromUrlParam(param)).toEqual({ ok: true, scenario })
    }
  })

  it('refuses damaged links and files with a reason', async () => {
    expect((await scenarioFromUrlParam('not-a-scenario')).ok).toBe(false)
    expect(scenarioFromJson('{ nope')).toEqual({ ok: false, error: 'The file is not valid JSON.' })
    expect(scenarioFromJson('{"format":"something else"}')).toEqual({ ok: false, error: 'This is not a Scenario file.' })
  })

  it('refuses Scenarios that would misbehave', () => {
    const broken = (change: (s: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(moreServersDidNotFixIt)) as Record<string, unknown>
      change(copy)
      return parseScenario(copy)
    }
    const architecture = (s: Record<string, unknown>) => s.architecture as { components: Record<string, unknown>[]; connections: unknown[] }

    expect(broken((s) => (s.version = 99))).toMatchObject({ ok: false, error: expect.stringContaining('version 99') })
    expect(broken((s) => (architecture(s).components[0]!.rate = -5))).toMatchObject({ ok: false, error: expect.stringContaining('rate') })
    expect(broken((s) => (architecture(s).components[1]!.kind = 'cache'))).toMatchObject({ ok: false, error: expect.stringContaining('unknown kind') })
    expect(broken((s) => architecture(s).components.push({ ...architecture(s).components[0]! }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('share the id'),
    })
    expect(broken((s) => architecture(s).connections.push({ from: 'traffic', to: 'nowhere' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('does not exist'),
    })
    expect(broken((s) => ((s.interventions as { time: number }[])[0]!.time = 20))).toMatchObject({
      ok: false,
      error: expect.stringContaining('before'),
    })
    expect(broken((s) => delete (s.layout as Record<string, unknown>)['web-2'])).toMatchObject({
      ok: false,
      error: expect.stringContaining('web-2'),
    })
  })
})

describe('built-in Scenarios', () => {
  it('pass validation', () => {
    for (const scenario of builtInScenarios) {
      expect(parseScenario(scenario).ok).toBe(true)
      expect(validateArchitecture(scenario.architecture)).toEqual([])
    }
  })

  it('"More servers didn\'t fix it": Completed per second does not rise after the Server is added', () => {
    const { samples } = run(moreServersDidNotFixIt, 20)
    const addedAt = moreServersDidNotFixIt.interventions[0]!.time
    const before = mean(between(samples, 3, addedAt).map((s) => s.overall.completedPerSecond))
    const after = mean(between(samples, addedAt + 2, 20).map((s) => s.overall.completedPerSecond))
    expect(after).toBeLessThanOrEqual(before * 1.05)
    // The Database is the limit all along.
    const database = between(samples, 3, 20).map((s) => (s.components.database as WorkerMetrics).utilisation)
    expect(mean(database)).toBeGreaterThan(0.95)
  })

  it('"Queue absorbs a burst": the direct lane Rejects, the Queue lane does not and then drains', () => {
    const { engine, samples } = run(queueAbsorbsABurst, 16)
    const snapshot = engine.snapshot().components
    const direct = snapshot['direct-traffic']
    const queued = snapshot['queued-traffic']
    if (direct?.kind !== 'source' || queued?.kind !== 'source') throw new Error('expected Sources')
    expect(direct.outcomes.rejected).toBeGreaterThan(20)
    expect(queued.outcomes.rejected).toBe(0)
    const depths = samples.map((s) => (s.components.queue?.kind === 'queue' ? s.components.queue.depth : 0))
    expect(Math.max(...depths)).toBeGreaterThan(40)
    expect(depths.at(-1)).toBeLessThan(5)
  })

  it('"One server down": the survivors are pushed past their limit', () => {
    const { engine, samples } = run(oneServerDown, 16)
    const killedAt = oneServerDown.interventions[0]!.time
    const rejectedBefore = between(samples, 0, killedAt).reduce((sum, s) => sum + s.overall.outcomesPerSecond.rejected, 0)
    expect(rejectedBefore).toBe(0)
    const traffic = engine.snapshot().components.traffic
    if (traffic?.kind !== 'source') throw new Error('expected a Source')
    expect(traffic.outcomes.rejected).toBeGreaterThan(30)
    for (const survivor of ['web-1', 'web-3']) {
      const before = mean(between(samples, 1, killedAt).map((s) => (s.components[survivor] as WorkerMetrics).utilisation))
      const after = mean(between(samples, killedAt + 2, 16).map((s) => (s.components[survivor] as WorkerMetrics).utilisation))
      expect(before).toBeLessThan(0.92)
      expect(after).toBeGreaterThan(0.97)
    }
  })
})
