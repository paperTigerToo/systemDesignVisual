/**
 * Seeded pseudo-random generator (mulberry32). Every source of randomness in
 * a Run must come from one of these so that the same seed gives the same Run.
 */
export interface Random {
  /** Uniform number in [0, 1). */
  next(): number
  /** Exponentially distributed number with the given mean. */
  exponential(mean: number): number
}

export function createRandom(seed: number): Random {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    exponential(mean) {
      // 1 - next() is in (0, 1], so the log is always finite.
      return -mean * Math.log(1 - next())
    },
  }
}
