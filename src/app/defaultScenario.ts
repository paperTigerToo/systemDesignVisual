import type { Scenario } from '../engine'

/**
 * Hard-coded until the editor exists (ticket 06).
 * The Server's capacity is Concurrency / Work time = 2 / 0.2 = 10 Requests per second.
 * Raise `rate` above 10 to watch the Backlog grow.
 */
export const defaultScenario: Scenario = {
  seed: 1,
  architecture: {
    components: [
      { kind: 'source', id: 'source', rate: 8 },
      { kind: 'server', id: 'server', concurrency: 2, workTime: 0.2 },
    ],
    connections: [{ from: 'source', to: 'server' }],
  },
}

/** Canvas positions, kept apart from the engine's Scenario. */
export const defaultPositions: Record<string, { x: number; y: number }> = {
  source: { x: 0, y: 0 },
  server: { x: 360, y: 0 },
}
