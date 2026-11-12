import type { ComponentId, Scenario } from '../engine'

const webServer = { kind: 'server', concurrency: 2, workTime: 0.2, backlogCapacity: 20 } as const

/**
 * Hard-coded until the editor exists (ticket 06).
 *
 * Each Server holds a slot for its own 0.2 s of work plus the Database call
 * (about 0.05 s), so it manages about 8 Requests per second. Three of them
 * handle the Rate of 18 at about 75% Utilisation; Kill one and the other two
 * (about 16 per second together) are pushed past their limit.
 */
export const defaultScenario: Scenario = {
  seed: 1,
  architecture: {
    components: [
      { kind: 'source', id: 'source', rate: 18, timeLimit: 2 },
      { ...webServer, id: 'web-1' },
      { ...webServer, id: 'web-2' },
      { ...webServer, id: 'web-3' },
      { kind: 'database', id: 'database', concurrency: 8, workTime: 0.05, backlogCapacity: 40 },
    ],
    connections: [
      { from: 'source', to: 'web-1' },
      { from: 'source', to: 'web-2' },
      { from: 'source', to: 'web-3' },
      { from: 'web-1', to: 'database' },
      { from: 'web-2', to: 'database' },
      { from: 'web-3', to: 'database' },
    ],
  },
}

/** Canvas positions and names, kept apart from the engine's Scenario. */
export const defaultLayout: Record<ComponentId, { x: number; y: number; label: string }> = {
  source: { x: 0, y: 300, label: 'Traffic' },
  'web-1': { x: 340, y: 0, label: 'Web server 1' },
  'web-2': { x: 340, y: 300, label: 'Web server 2' },
  'web-3': { x: 340, y: 600, label: 'Web server 3' },
  database: { x: 680, y: 300, label: 'Database' },
}
