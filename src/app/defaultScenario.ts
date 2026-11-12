import type { ComponentId, Scenario } from '../engine'

/**
 * Hard-coded until the editor exists (ticket 06).
 *
 * Capacities (Concurrency / Work time): Server 4 / 0.02 = 200 per second on its
 * own, Database 2 / 0.2 = 10 per second. Raise `rate` above 10 to watch the
 * Database become the limit and the Server's slots fill up waiting on it.
 */
export const defaultScenario: Scenario = {
  seed: 1,
  architecture: {
    components: [
      { kind: 'source', id: 'source', rate: 8 },
      { kind: 'server', id: 'server', concurrency: 4, workTime: 0.02 },
      { kind: 'database', id: 'database', concurrency: 2, workTime: 0.2 },
    ],
    connections: [
      { from: 'source', to: 'server' },
      { from: 'server', to: 'database' },
    ],
  },
}

/** Canvas positions and names, kept apart from the engine's Scenario. */
export const defaultLayout: Record<ComponentId, { x: number; y: number; label: string }> = {
  source: { x: 0, y: 0, label: 'Traffic' },
  server: { x: 340, y: 0, label: 'Web server' },
  database: { x: 680, y: 0, label: 'Database' },
}
