import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react'
import { useShallow } from 'zustand/react/shallow'
import { DOT_TRAVEL_TIME, useSimulation } from './simulationStore'

/**
 * A Connection drawn as a straight line with sampled Requests moving along it:
 * calls travel from caller to callee, responses travel back the other way.
 */
export function ConnectionEdge({ id, source, target, sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  const time = useSimulation((state) => state.snapshot.time)
  const dots = useSimulation(
    useShallow((state) =>
      state.dots.filter(
        (dot) =>
          (dot.direction === 'call' && dot.from === source && dot.to === target) ||
          (dot.direction === 'response' && dot.from === target && dot.to === source),
      ),
    ),
  )

  return (
    <>
      <BaseEdge id={id} path={path} className="connection" />
      {dots.map((dot) => {
        const travelled = Math.min(Math.max((time - dot.startedAt) / DOT_TRAVEL_TIME, 0), 1)
        const progress = dot.direction === 'call' ? travelled : 1 - travelled
        const x = sourceX + (targetX - sourceX) * progress
        // Responses ride slightly below the line so the two directions stay readable.
        const y = sourceY + (targetY - sourceY) * progress + (dot.direction === 'response' ? 6 : -6)
        const className = `request-dot request-dot--${dot.direction}${dot.bad ? ' request-dot--bad' : ''}`
        return <circle key={dot.key} className={className} r={3.5} cx={x} cy={y} />
      })}
    </>
  )
}

export const edgeTypes = { connection: ConnectionEdge }
