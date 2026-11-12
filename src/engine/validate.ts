import type { Architecture, ComponentId, ComponentSpec, ConnectionSpec } from './types'

/** One reason an architecture cannot be played, tied to what caused it where possible. */
export interface Problem {
  code:
    | 'no-source'
    | 'duplicate-id'
    | 'bad-setting'
    | 'unknown-component'
    | 'self-connection'
    | 'duplicate-connection'
    | 'into-source'
    | 'database-calls-out'
    | 'queue-target'
    | 'queue-no-outgoing'
    | 'source-no-outgoing'
    | 'unreachable'
    | 'cycle'
  message: string
  componentId?: ComponentId
  connection?: ConnectionSpec
}

const isWhole = (n: number) => Number.isInteger(n)

/** Settings that would make the engine misbehave, such as a Concurrency of zero. */
function settingProblems(component: ComponentSpec): Problem[] {
  const problems: Problem[] = []
  const bad = (message: string) =>
    problems.push({ code: 'bad-setting', message, componentId: component.id })
  switch (component.kind) {
    case 'source':
      if (!(component.rate >= 0)) bad('Rate cannot be negative.')
      if (!(component.timeLimit > 0)) bad('Time limit must be greater than zero.')
      break
    case 'server':
    case 'database':
      if (!(component.concurrency >= 1) || !isWhole(component.concurrency)) bad('Concurrency must be a whole number of at least 1.')
      if (!(component.workTime > 0)) bad('Work time must be greater than zero.')
      if (!(component.backlogCapacity >= 0) || !isWhole(component.backlogCapacity)) {
        bad('Backlog capacity must be a whole number of at least 0.')
      }
      break
    case 'queue':
      if (!(component.capacity >= 1) || !isWhole(component.capacity)) bad('Capacity must be a whole number of at least 1.')
      break
  }
  return problems
}

/**
 * Every rule an architecture must meet before it can be played. Pure: no
 * engine or UI state, so the editor and Scenario import can share it.
 */
export function validateArchitecture(architecture: Architecture): Problem[] {
  const problems: Problem[] = []
  const byId = new Map<ComponentId, ComponentSpec>()

  for (const component of architecture.components) {
    if (byId.has(component.id)) {
      problems.push({ code: 'duplicate-id', message: `Two Components share the id "${component.id}".`, componentId: component.id })
    }
    byId.set(component.id, component)
    problems.push(...settingProblems(component))
  }

  if (![...byId.values()].some((c) => c.kind === 'source')) {
    problems.push({ code: 'no-source', message: 'Add a Source: nothing generates traffic yet.' })
  }

  // Connections that are well-formed enough to reason about as a graph.
  const usable: ConnectionSpec[] = []
  const seen = new Set<string>()
  for (const connection of architecture.connections) {
    const from = byId.get(connection.from)
    const to = byId.get(connection.to)
    if (!from || !to) {
      problems.push({ code: 'unknown-component', message: 'This Connection refers to a missing Component.', connection })
      continue
    }
    if (connection.from === connection.to) {
      problems.push({ code: 'self-connection', message: 'A Component cannot connect to itself.', connection })
      continue
    }
    const key = `${connection.from}\u0000${connection.to}`
    if (seen.has(key)) {
      problems.push({ code: 'duplicate-connection', message: 'These two Components are already connected.', connection })
      continue
    }
    seen.add(key)
    usable.push(connection)

    if (to.kind === 'source') {
      problems.push({ code: 'into-source', message: 'Nothing can send Requests into a Source.', connection })
    }
    if (from.kind === 'database') {
      problems.push({ code: 'database-calls-out', message: 'A Database does its work itself; it cannot call other Components.', connection })
    }
    if (from.kind === 'queue' && to.kind !== 'server' && to.kind !== 'database') {
      problems.push({ code: 'queue-target', message: 'A Queue can only hand work to a Server or a Database.', connection })
    }
  }

  const outgoing = new Map<ComponentId, ComponentId[]>()
  for (const { from, to } of usable) outgoing.set(from, [...(outgoing.get(from) ?? []), to])

  for (const component of byId.values()) {
    const out = outgoing.get(component.id)?.length ?? 0
    if (component.kind === 'queue' && out === 0) {
      problems.push({ code: 'queue-no-outgoing', message: 'This Queue has nowhere to send its Requests.', componentId: component.id })
    }
    if (component.kind === 'source' && out === 0) {
      problems.push({ code: 'source-no-outgoing', message: 'This Source is not connected to anything.', componentId: component.id })
    }
  }

  // Reachability from every Source.
  const reached = new Set<ComponentId>()
  const stack = [...byId.values()].filter((c) => c.kind === 'source').map((c) => c.id)
  while (stack.length > 0) {
    const id = stack.pop()!
    if (reached.has(id)) continue
    reached.add(id)
    stack.push(...(outgoing.get(id) ?? []))
  }
  for (const component of byId.values()) {
    if (!reached.has(component.id)) {
      problems.push({ code: 'unreachable', message: 'No Source sends traffic here.', componentId: component.id })
    }
  }

  // Cycles: any Connection that leads back to a Component still on the depth-first path.
  const state = new Map<ComponentId, 'visiting' | 'done'>()
  const visit = (id: ComponentId): void => {
    state.set(id, 'visiting')
    for (const to of outgoing.get(id) ?? []) {
      const status = state.get(to)
      if (status === 'visiting') {
        problems.push({
          code: 'cycle',
          message: 'This Connection closes a loop, so Requests could circle forever.',
          connection: { from: id, to },
        })
      } else if (status === undefined) {
        visit(to)
      }
    }
    state.set(id, 'done')
  }
  for (const id of byId.keys()) if (!state.has(id)) visit(id)

  return problems
}
