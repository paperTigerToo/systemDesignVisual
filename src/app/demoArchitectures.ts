import type { ComponentId, Scenario } from '../engine'

/**
 * Hard-coded architectures, switchable from the toolbar until the editor
 * (ticket 06) and the Scenario menu (ticket 09) replace them.
 */
export interface DemoArchitecture {
  name: string
  scenario: Scenario
  /** Canvas positions and names, kept apart from the engine's Scenario. */
  layout: Record<ComponentId, { x: number; y: number; label: string }>
}

const webServer = { kind: 'server', concurrency: 2, workTime: 0.2, backlogCapacity: 20 } as const

/**
 * Each Server holds a slot for its own 0.2 s of work plus the Database call
 * (about 0.05 s), so it manages about 8 Requests per second. Three of them
 * handle the Rate of 18 at about 75% Utilisation; Kill one and the other two
 * (about 16 per second together) are pushed past their limit.
 */
const threeServers: DemoArchitecture = {
  name: 'Three Servers, one Database',
  scenario: {
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
  },
  layout: {
    source: { x: 0, y: 300, label: 'Traffic' },
    'web-1': { x: 340, y: 0, label: 'Web server 1' },
    'web-2': { x: 340, y: 300, label: 'Web server 2' },
    'web-3': { x: 340, y: 600, label: 'Web server 3' },
    database: { x: 680, y: 300, label: 'Database' },
  },
}

/**
 * The API Server answers in about 20 ms by handing slow work to a Queue. The
 * worker manages 2 / 0.3 = about 6.7 Requests per second against a Rate of 10,
 * so the Queue fills at about 3 per second while the Source stays fast.
 */
const queueBehindApi: DemoArchitecture = {
  name: 'Queue in front of slow work',
  scenario: {
    seed: 1,
    architecture: {
      components: [
        { kind: 'source', id: 'source', rate: 10, timeLimit: 2 },
        { kind: 'server', id: 'api', concurrency: 4, workTime: 0.02, backlogCapacity: 40 },
        { kind: 'queue', id: 'queue', capacity: 200 },
        { kind: 'server', id: 'worker', concurrency: 2, workTime: 0.3, backlogCapacity: 10 },
      ],
      connections: [
        { from: 'source', to: 'api' },
        { from: 'api', to: 'queue' },
        { from: 'queue', to: 'worker' },
      ],
    },
  },
  layout: {
    source: { x: 0, y: 0, label: 'Traffic' },
    api: { x: 300, y: 0, label: 'API server' },
    queue: { x: 600, y: 0, label: 'Job queue' },
    worker: { x: 900, y: 0, label: 'Worker' },
  },
}

export const demoArchitectures: DemoArchitecture[] = [threeServers, queueBehindApi]
