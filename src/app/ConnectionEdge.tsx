import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react'
import { useShallow } from 'zustand/react/shallow'
import { DOT_TRAVEL_TIME, useSimulation } from './simulationStore'

/** A Connection drawn as a straight line with sampled Requests moving along it. */
export function ConnectionEdge({ id, source, target, sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  const time = useSimulation((state) => state.snapshot.time)
  const dots = useSimulation(
    useShallow((state) => state.dots.filter((dot) => dot.from === source && dot.to === target)),
  )

  return (
    <>
      <BaseEdge id={id} path={path} className="connection" />
      {dots.map((dot) => {
        const progress = Math.min(Math.max((time - dot.startedAt) / DOT_TRAVEL_TIME, 0), 1)
        return (
          <circle
            key={dot.key}
            className="request-dot"
            r={4}
            cx={sourceX + (targetX - sourceX) * progress}
            cy={sourceY + (targetY - sourceY) * progress}
          />
        )
      })}
    </>
  )
}

export const edgeTypes = { connection: ConnectionEdge }
