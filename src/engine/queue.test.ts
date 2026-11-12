import { describe, expect, it } from 'vitest'
import {
  createEngine,
  type Engine,
  type Movement,
  type QueueSnapshot,
  type Scenario,
  type SourceSnapshot,
  type WorkerSnapshot,
} from './index'

interface WorkerNumbers {
  concurrency: number
  workTime: number
  backlogCapacity: number
}

/** Source to an API Server that hands work to a Queue, drained by a worker Server. */
function apiQueueWorker(options: {
  seed?: number
  rate: number
  api?: WorkerNumbers
  capacity: number
  worker: WorkerNumbers
}): Scenario {
  return {
    seed: options.seed ?? 8,
    architecture: {
      components: [
        { kind: 'source', id: 'source', rate: options.rate, timeLimit: 2 },
        { kind: 'server', id: 'api', ...(options.api ?? { concurrency: 4, workTime: 0.01, backlogCapacity: 100 }) },
        { kind: 'queue', id: 'queue', capacity: options.capacity },
        { kind: 'server', id: 'worker', ...options.worker },
      ],
      connections: [
        { from: 'source', to: 'api' },
        { from: 'api', to: 'queue' },
        { from: 'queue', to: 'worker' },
      ],
    },
  }
}

/** Source straight into a Queue drained by one or more workers. */
function sourceQueue(options: { seed?: number; rate: number; capacity: number; workers: Record<string, WorkerNumbers> }): Scenario {
  return {
    seed: options.seed ?? 8,
    architecture: {
      components: [
        { kind: 'source', id: 'source', rate: options.rate, timeLimit: 2 },
        { kind: 'queue', id: 'queue', capacity: options.capacity },
        ...Object.entries(options.workers).map(([id, numbers]) => ({ kind: 'server' as const, id, ...numbers })),
      ],
      connections: [
        { from: 'source', to: 'queue' },
        ...Object.keys(options.workers).map((id) => ({ from: 'queue', to: id })),
      ],
    },
  }
}

const get = {
  source: (engine: Engine) => engine.snapshot().components.source as SourceSnapshot,
  queue: (engine: Engine) => engine.snapshot().components.queue as QueueSnapshot,
  worker: (engine: Engine, id = 'worker') => engine.snapshot().components[id] as WorkerSnapshot,
}

/** Every Request a Queue received is Rejected, held, dispatched, or lost when it was Killed. */
function expectQueueAccountedFor(queue: QueueSnapshot): void {
  expect(queue.received).toBe(queue.rejected + queue.depth + queue.dispatched + queue.failed)
  expect(queue.processed + queue.lost).toBeLessThanOrEqual(queue.dispatched)
}

const slowWorker = { concurrency: 2, workTime: 1, backlogCapacity: 50 }

describe('Queue', () => {
  it("releases the caller at once, so Source latency excludes the worker's Work time", () => {
    const engine = createEngine(apiQueueWorker({ rate: 1, capacity: 1000, worker: slowWorker }))
    engine.advanceTo(200)
    const source = get.source(engine)
    expect(get.worker(engine).completed).toBeGreaterThan(100)
    // The API Server's Work time averages 10 ms; the worker's averages 1 s.
    expect(source.averageLatency!).toBeLessThan(0.05)
    expect(source.outcomes.completed).toBe(source.created - source.inProgress)
  })

  it('piles up in the Queue while the worker Backlog stays empty', () => {
    // 5 Requests per second against a worker that manages 2 per second.
    const engine = createEngine(apiQueueWorker({ rate: 5, capacity: 100_000, worker: slowWorker }))
    engine.advanceTo(50)
    const at50 = get.queue(engine).depth
    for (let t = 50; t <= 100; t += 0.5) {
      engine.advanceTo(t)
      expect(get.worker(engine).backlog).toBe(0)
      expect(get.worker(engine).occupied).toBeLessThanOrEqual(2)
    }
    const queue = get.queue(engine)
    expect(at50).toBeGreaterThan(100)
    expect(queue.depth).toBeGreaterThan(at50 + 100)
    expect(queue.averageTimeHeld).not.toBeNull()
    expect(queue.processed).toBeGreaterThan(150)
    expectQueueAccountedFor(queue)
  })

  it('Rejects the caller when full', () => {
    const engine = createEngine(apiQueueWorker({ rate: 10, capacity: 10, worker: slowWorker }))
    engine.advanceTo(60)
    const queue = get.queue(engine)
    const source = get.source(engine)
    expect(queue.depth).toBeLessThanOrEqual(10)
    expect(queue.rejected).toBeGreaterThan(300)
    expect(source.outcomes.rejected).toBe(queue.rejected)
    expect(queue.lastRejectedAt).not.toBeNull()
    expectQueueAccountedFor(queue)
  })

  it('holds while its worker is Killed and drains in arrival order after revive', () => {
    const engine = createEngine(
      sourceQueue({ rate: 4, capacity: 1000, workers: { worker: { concurrency: 1, workTime: 0.05, backlogCapacity: 0 } } }),
    )
    engine.advanceTo(5)
    engine.applyIntervention({ kind: 'kill', componentId: 'worker' })
    const receivedWhenKilled = get.worker(engine).received
    engine.takeMovements()

    engine.advanceTo(20)
    expect(get.worker(engine).received).toBe(receivedWhenKilled)
    const heldWhileKilled = get.queue(engine).depth
    expect(heldWhileKilled).toBeGreaterThan(40)

    const arrivals = engine.takeMovements().filter((m) => m.direction === 'call' && m.to === 'queue')
    engine.applyIntervention({ kind: 'revive', componentId: 'worker' })
    engine.advanceTo(60)
    const dispatched = engine
      .takeMovements()
      .filter((m): m is Movement => m.direction === 'call' && m.from === 'queue')
      .map((m) => m.requestId)

    // Everything that arrived while the worker was Killed goes out first, in the order it arrived.
    expect(dispatched.slice(0, arrivals.length)).toEqual(arrivals.map((m) => m.requestId))
    expect(get.queue(engine).depth).toBeLessThan(5)
  })

  it('hands work only to workers with a free slot, round-robin between them', () => {
    const engine = createEngine(
      sourceQueue({
        rate: 20,
        capacity: 1000,
        workers: {
          a: { concurrency: 1, workTime: 0.05, backlogCapacity: 10 },
          b: { concurrency: 1, workTime: 0.05, backlogCapacity: 10 },
        },
      }),
    )
    for (let t = 0; t <= 30; t += 0.1) {
      engine.advanceTo(t)
      expect(get.worker(engine, 'a').backlog).toBe(0)
      expect(get.worker(engine, 'b').backlog).toBe(0)
    }
    const a = get.worker(engine, 'a').received
    const b = get.worker(engine, 'b').received
    expect(a + b).toBe(get.queue(engine).dispatched)
    expect(Math.abs(a - b) / (a + b)).toBeLessThan(0.1)
  })

  it('counts downstream Failures as lost, without redelivery', () => {
    const engine = createEngine(
      sourceQueue({ rate: 10, capacity: 1000, workers: { worker: { concurrency: 4, workTime: 1, backlogCapacity: 0 } } }),
    )
    engine.advanceTo(10)
    const inWorker = get.worker(engine).occupied
    engine.applyIntervention({ kind: 'kill', componentId: 'worker' })
    const queue = get.queue(engine)
    expect(queue.lost).toBe(inWorker)
    expectQueueAccountedFor(queue)
  })

  it('loses what it holds when Killed and comes back empty', () => {
    const engine = createEngine(apiQueueWorker({ rate: 5, capacity: 1000, worker: slowWorker }))
    engine.advanceTo(30)
    const held = get.queue(engine).depth
    expect(held).toBeGreaterThan(20)

    engine.applyIntervention({ kind: 'kill', componentId: 'queue' })
    expect(get.queue(engine)).toMatchObject({ killed: true, depth: 0, failed: held })

    // While the Queue is Killed, the API Server has nowhere live to call: Requests fail.
    const failedBefore = get.source(engine).outcomes.failed
    engine.advanceTo(40)
    expect(get.source(engine).outcomes.failed).toBeGreaterThan(failedBefore + 30)

    engine.applyIntervention({ kind: 'revive', componentId: 'queue' })
    expect(get.queue(engine)).toMatchObject({ killed: false, depth: 0 })
    engine.advanceTo(50)
    expect(get.queue(engine).depth).toBeGreaterThan(0)
    expectQueueAccountedFor(get.queue(engine))
  })

  it('is deterministic', () => {
    const run = () => {
      const engine = createEngine(apiQueueWorker({ seed: 31, rate: 6, capacity: 40, worker: slowWorker }))
      engine.advanceTo(20)
      engine.applyIntervention({ kind: 'kill', componentId: 'worker' })
      engine.advanceTo(25)
      engine.applyIntervention({ kind: 'revive', componentId: 'worker' })
      engine.advanceTo(40)
      return { snapshot: engine.snapshot(), movements: engine.takeMovements() }
    }
    expect(run()).toEqual(run())
  })
})
