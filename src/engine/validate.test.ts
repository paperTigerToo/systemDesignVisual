import { describe, expect, it } from 'vitest'
import { validateArchitecture, type Architecture, type ComponentSpec, type Problem } from './index'

const source = (id = 'source'): ComponentSpec => ({ kind: 'source', id, rate: 5, timeLimit: 2 })
const server = (id: string): ComponentSpec => ({ kind: 'server', id, concurrency: 2, workTime: 0.1, backlogCapacity: 10 })
const database = (id = 'db'): ComponentSpec => ({ kind: 'database', id, concurrency: 2, workTime: 0.1, backlogCapacity: 10 })
const queue = (id = 'queue'): ComponentSpec => ({ kind: 'queue', id, capacity: 50 })
const link = (from: string, to: string) => ({ from, to })

function codes(architecture: Architecture): Problem['code'][] {
  return validateArchitecture(architecture).map((p) => p.code)
}

/** Source to Server to Database: valid. */
const valid: Architecture = {
  components: [source(), server('web'), database()],
  connections: [link('source', 'web'), link('web', 'db')],
}

describe('validateArchitecture', () => {
  it('accepts a simple valid architecture', () => {
    expect(validateArchitecture(valid)).toEqual([])
  })

  it('accepts Source to two Servers to a Database, and a Queue feeding a worker', () => {
    expect(
      codes({
        components: [source(), server('a'), server('b'), database()],
        connections: [link('source', 'a'), link('source', 'b'), link('a', 'db'), link('b', 'db')],
      }),
    ).toEqual([])
    expect(
      codes({
        components: [source(), server('api'), queue(), server('worker')],
        connections: [link('source', 'api'), link('api', 'queue'), link('queue', 'worker')],
      }),
    ).toEqual([])
  })

  it('requires at least one Source', () => {
    expect(codes({ components: [server('web'), database()], connections: [link('web', 'db')] })).toContain('no-source')
    expect(codes(valid)).not.toContain('no-source')
  })

  it('refuses Connections into a Source', () => {
    const problems = validateArchitecture({ ...valid, connections: [...valid.connections, link('web', 'source')] })
    const into = problems.find((p) => p.code === 'into-source')
    expect(into?.connection).toEqual(link('web', 'source'))
    expect(codes(valid)).not.toContain('into-source')
  })

  it('refuses outgoing Connections from a Database', () => {
    const architecture = {
      components: [source(), database(), server('web')],
      connections: [link('source', 'db'), link('db', 'web')],
    }
    expect(codes(architecture)).toContain('database-calls-out')
    expect(codes(valid)).not.toContain('database-calls-out')
  })

  it('requires a Queue to have an outgoing Connection to a Server or Database', () => {
    const noOutgoing = { components: [source(), queue()], connections: [link('source', 'queue')] }
    expect(codes(noOutgoing)).toContain('queue-no-outgoing')

    const intoQueue = {
      components: [source(), queue('q1'), queue('q2'), server('worker')],
      connections: [link('source', 'q1'), link('q1', 'q2'), link('q2', 'worker')],
    }
    expect(codes(intoQueue)).toContain('queue-target')

    const fine = { components: [source(), queue(), database()], connections: [link('source', 'queue'), link('queue', 'db')] }
    expect(codes(fine)).toEqual([])
  })

  it('requires every Component to be reachable from a Source', () => {
    const orphan = { ...valid, components: [...valid.components, server('lonely')] }
    const problems = validateArchitecture(orphan)
    expect(problems).toContainEqual(expect.objectContaining({ code: 'unreachable', componentId: 'lonely' }))
    expect(codes(valid)).not.toContain('unreachable')
  })

  it('flags a Source that is connected to nothing', () => {
    expect(codes({ components: [source()], connections: [] })).toContain('source-no-outgoing')
    expect(codes(valid)).not.toContain('source-no-outgoing')
  })

  it('refuses a cycle through three Components', () => {
    const loop = {
      components: [source(), server('a'), server('b'), server('c')],
      connections: [link('source', 'a'), link('a', 'b'), link('b', 'c'), link('c', 'a')],
    }
    const cycles = validateArchitecture(loop).filter((p) => p.code === 'cycle')
    expect(cycles).toHaveLength(1)
    expect(cycles[0]!.connection).toEqual(link('c', 'a'))
    // A diamond (two paths meeting again) is not a cycle.
    expect(
      codes({
        components: [source(), server('a'), server('b'), database()],
        connections: [link('source', 'a'), link('source', 'b'), link('a', 'db'), link('b', 'db')],
      }),
    ).not.toContain('cycle')
  })

  it('refuses a Component connected to itself', () => {
    expect(codes({ ...valid, connections: [...valid.connections, link('web', 'web')] })).toContain('self-connection')
    expect(codes(valid)).not.toContain('self-connection')
  })

  it('refuses duplicate Connections', () => {
    expect(codes({ ...valid, connections: [...valid.connections, link('web', 'db')] })).toEqual(['duplicate-connection'])
  })

  it('refuses Connections to missing Components and duplicate ids', () => {
    expect(codes({ ...valid, connections: [...valid.connections, link('web', 'ghost')] })).toContain('unknown-component')
    expect(codes({ ...valid, components: [...valid.components, server('web')] })).toContain('duplicate-id')
  })

  it('refuses settings the engine cannot run', () => {
    const broken: Architecture = {
      components: [
        { kind: 'source', id: 'source', rate: -1, timeLimit: 0 },
        { kind: 'server', id: 'web', concurrency: 0, workTime: 0, backlogCapacity: 1.5 },
        { kind: 'database', id: 'db', concurrency: 2.5, workTime: 0.1, backlogCapacity: 10 },
      ],
      connections: valid.connections,
    }
    const problems = validateArchitecture(broken).filter((p) => p.code === 'bad-setting')
    expect(problems.map((p) => p.componentId)).toEqual(['source', 'source', 'web', 'web', 'web', 'db'])
  })
})
