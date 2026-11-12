import { SCENARIO_FORMAT, SCENARIO_VERSION, type ScenarioDocument } from './scenario'

const base = { format: SCENARIO_FORMAT, version: SCENARIO_VERSION } as const

/**
 * The Database manages 4 / 0.1 = 40 Requests per second against a Rate of 60,
 * so it is the limit. Under call-and-wait the Web server's slots sit waiting
 * on the Database, so the Web server looks overloaded too. At 8 s a recorded
 * Intervention adds a second Web server: more slots now wait on the same
 * Database, and Completed per second stays where it was.
 */
export const moreServersDidNotFixIt: ScenarioDocument = {
  ...base,
  name: "More servers didn't fix it",
  seed: 1,
  architecture: {
    components: [
      { kind: 'source', id: 'traffic', rate: 66, timeLimit: 2 },
      { kind: 'server', id: 'web-1', concurrency: 8, workTime: 0.04, backlogCapacity: 20 },
      { kind: 'database', id: 'database', concurrency: 4, workTime: 0.1, backlogCapacity: 50 },
    ],
    connections: [
      { from: 'traffic', to: 'web-1' },
      { from: 'web-1', to: 'database' },
    ],
  },
  layout: {
    traffic: { x: 0, y: 120, label: 'Traffic' },
    'web-1': { x: 330, y: 0, label: 'Web server 1' },
    'web-2': { x: 330, y: 280, label: 'Web server 2' },
    database: { x: 660, y: 120, label: 'Database' },
  },
  interventions: [
    {
      time: 8,
      intervention: {
        kind: 'addComponent',
        component: { kind: 'server', id: 'web-2', concurrency: 8, workTime: 0.04, backlogCapacity: 20 },
      },
    },
    { time: 8, intervention: { kind: 'addConnection', from: 'traffic', to: 'web-2' } },
    { time: 8, intervention: { kind: 'addConnection', from: 'web-2', to: 'database' } },
  ],
}

/**
 * Two identical lanes of slow work, each managing 3 / 0.25 = 12 Requests per
 * second. Both Sources burst from 4 to 30 per second between 3 s and 6 s.
 * Called directly, the Worker's Backlog of 10 overflows and Requests are
 * Rejected. Behind a Queue, every Request is accepted and the Queue drains
 * once the burst is over.
 */
export const queueAbsorbsABurst: ScenarioDocument = {
  ...base,
  name: 'Queue absorbs a burst',
  seed: 1,
  architecture: {
    components: [
      { kind: 'source', id: 'direct-traffic', rate: 4, timeLimit: 5 },
      { kind: 'server', id: 'direct-worker', concurrency: 3, workTime: 0.25, backlogCapacity: 10 },
      { kind: 'source', id: 'queued-traffic', rate: 4, timeLimit: 5 },
      { kind: 'queue', id: 'queue', capacity: 500 },
      { kind: 'server', id: 'queued-worker', concurrency: 3, workTime: 0.25, backlogCapacity: 10 },
    ],
    connections: [
      { from: 'direct-traffic', to: 'direct-worker' },
      { from: 'queued-traffic', to: 'queue' },
      { from: 'queue', to: 'queued-worker' },
    ],
  },
  layout: {
    'direct-traffic': { x: 0, y: 0, label: 'Traffic, called directly' },
    'direct-worker': { x: 660, y: 0, label: 'Slow worker' },
    'queued-traffic': { x: 0, y: 300, label: 'Traffic, through a Queue' },
    queue: { x: 330, y: 300, label: 'Queue' },
    'queued-worker': { x: 660, y: 300, label: 'Slow worker' },
  },
  interventions: [
    { time: 3, intervention: { kind: 'setSetting', componentId: 'direct-traffic', key: 'rate', value: 30 } },
    { time: 3, intervention: { kind: 'setSetting', componentId: 'queued-traffic', key: 'rate', value: 30 } },
    { time: 6, intervention: { kind: 'setSetting', componentId: 'direct-traffic', key: 'rate', value: 4 } },
    { time: 6, intervention: { kind: 'setSetting', componentId: 'queued-traffic', key: 'rate', value: 4 } },
  ],
}

/**
 * Three Web servers, each managing about 8 / 0.3 = 27 Requests per second
 * (0.28 s of work plus about 0.02 s on the Database), handle a Rate of 66 at
 * about 83% Utilisation. At 6 s one is Killed: the two survivors manage about
 * 53 per second against 66, so they fill their Backlogs and start Rejecting.
 */
export const oneServerDown: ScenarioDocument = {
  ...base,
  name: 'One server down',
  seed: 1,
  architecture: {
    components: [
      { kind: 'source', id: 'traffic', rate: 66, timeLimit: 2 },
      { kind: 'server', id: 'web-1', concurrency: 8, workTime: 0.28, backlogCapacity: 10 },
      { kind: 'server', id: 'web-2', concurrency: 8, workTime: 0.28, backlogCapacity: 10 },
      { kind: 'server', id: 'web-3', concurrency: 8, workTime: 0.28, backlogCapacity: 10 },
      { kind: 'database', id: 'database', concurrency: 8, workTime: 0.02, backlogCapacity: 50 },
    ],
    connections: [
      { from: 'traffic', to: 'web-1' },
      { from: 'traffic', to: 'web-2' },
      { from: 'traffic', to: 'web-3' },
      { from: 'web-1', to: 'database' },
      { from: 'web-2', to: 'database' },
      { from: 'web-3', to: 'database' },
    ],
  },
  layout: {
    traffic: { x: 0, y: 280, label: 'Traffic' },
    'web-1': { x: 330, y: 0, label: 'Web server 1' },
    'web-2': { x: 330, y: 280, label: 'Web server 2' },
    'web-3': { x: 330, y: 560, label: 'Web server 3' },
    database: { x: 660, y: 280, label: 'Database' },
  },
  interventions: [{ time: 6, intervention: { kind: 'kill', componentId: 'web-2' } }],
}

/** The built-in Scenarios, in menu order; the first opens by default. */
export const builtInScenarios: ScenarioDocument[] = [moreServersDidNotFixIt, queueAbsorbsABurst, oneServerDown]

/** A blank canvas to build on, with nothing recorded. */
export const emptyScenario: ScenarioDocument = {
  ...base,
  name: 'Empty canvas',
  seed: 1,
  architecture: { components: [], connections: [] },
  layout: {},
  interventions: [],
}
