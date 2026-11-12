/**
 * Closed-form results from queueing theory, for checking the engine against.
 * Notation: arrivals at rate `lambda` (Poisson), exponential service at rate
 * `mu` per slot (mu = 1 / mean Work time), `c` slots (Concurrency), and room
 * for `K` Requests in total (c working plus K - c in the Backlog).
 */

function factorial(n: number): number {
  let result = 1
  for (let i = 2; i <= n; i++) result *= i
  return result
}

/** M/M/1: one slot, unlimited Backlog. Requires lambda < mu. */
export function mm1(lambda: number, mu: number) {
  const rho = lambda / mu
  return {
    utilisation: rho,
    /** Mean time from arrival to the end of work. */
    timeInSystem: 1 / (mu - lambda),
    /** Mean time waiting in the Backlog before work starts. */
    timeInBacklog: rho / (mu - lambda),
  }
}

/** M/M/c (Erlang C): c slots, unlimited Backlog. Requires lambda < c * mu. */
export function erlangC(lambda: number, mu: number, c: number) {
  const a = lambda / mu
  const rho = a / c
  let sum = 0
  for (let k = 0; k < c; k++) sum += a ** k / factorial(k)
  const top = (a ** c / factorial(c)) * (1 / (1 - rho))
  const probabilityOfWaiting = top / (sum + top)
  return {
    utilisation: rho,
    probabilityOfWaiting,
    timeInBacklog: probabilityOfWaiting / (c * mu - lambda),
  }
}

/** M/M/c/K: c slots and room for K Requests in all; arrivals that find it full are Rejected. */
export function mmck(lambda: number, mu: number, c: number, K: number) {
  const a = lambda / mu
  const rho = a / c
  // Unnormalised probability of n Requests present.
  const weight = (n: number) => (n <= c ? a ** n / factorial(n) : (a ** c / factorial(c)) * rho ** (n - c))
  let total = 0
  for (let n = 0; n <= K; n++) total += weight(n)
  const rejectedShare = weight(K) / total
  return {
    /** Arrivals see time averages (Poisson arrivals), so this is also the share of Requests Rejected. */
    rejectedShare,
    utilisation: (lambda * (1 - rejectedShare)) / (c * mu),
  }
}
