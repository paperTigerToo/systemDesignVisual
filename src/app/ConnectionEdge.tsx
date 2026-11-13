import { BaseEdge, getStraightPath, type Edge, type EdgeProps } from '@xyflow/react'
import { memo, useLayoutEffect } from 'react'
import { clearConnectionGeometry, setConnectionGeometry } from './DotLayer'

export type ConnectionEdgeType = Edge<{ problem: boolean }, 'connection'>

/**
 * A Connection drawn as a straight arrow. It re-renders only when it moves or its
 * state changes; the Requests travelling along it are drawn by the DotLayer, which
 * reads where this line is from the geometry registered here.
 */
export const ConnectionEdge = memo(function ConnectionEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
  data,
  markerEnd,
}: EdgeProps<ConnectionEdgeType>) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY })

  useLayoutEffect(() => {
    setConnectionGeometry(source, target, { sourceX, sourceY, targetX, targetY })
  }, [source, target, sourceX, sourceY, targetX, targetY])
  useLayoutEffect(() => () => clearConnectionGeometry(source, target), [source, target])

  const className = [
    'connection',
    data?.problem ? 'connection--problem' : '',
    selected ? 'connection--selected' : '',
  ].join(' ')

  return <BaseEdge id={id} path={path} className={className} markerEnd={markerEnd} interactionWidth={16} />
})

export const edgeTypes = { connection: ConnectionEdge }
