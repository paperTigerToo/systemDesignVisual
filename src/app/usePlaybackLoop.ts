import { useEffect } from 'react'
import { useSimulation } from './simulationStore'

/** Drives the Run from animation frames while the app is mounted. */
export function usePlaybackLoop(): void {
  useEffect(() => {
    let frame = 0
    let last = performance.now()
    const loop = (now: number) => {
      useSimulation.getState().tick((now - last) / 1000)
      last = now
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [])
}
