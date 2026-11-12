# Engine verification against queueing formulas

The simulator's engine is checked against closed-form results from queueing theory, not just against itself. If the engine gets arrivals, Work time, slots, the Backlog or Rejection wrong, these numbers stop matching.

The tests are in [`tests/verification.test.ts`](../tests/verification.test.ts) and the formulas in [`tests/queueing.ts`](../tests/queueing.ts). They run as part of the normal `npm test` and take about two seconds.

## Method

Every case is the same small architecture: one Source sending to one Server with no outgoing Connections. That maps onto the textbook models as follows.

| Model term | In the simulator |
| --- | --- |
| Poisson arrivals at rate λ | The Source's Rate (exponential gaps) |
| Exponential service at rate μ per server | Work time with mean 1/μ (exponentially distributed) |
| c servers | Concurrency |
| Waiting room of K − c | Backlog capacity |
| Customers who never give up | Source time limit set to infinity |

Under call-and-wait (ADR 0001), a Server with nothing downstream holds a slot only for its own Work time, so this Server behaves exactly like the textbook queue.

**Each Run:**
- runs with a fixed seed for thousands of simulated seconds;
- discards the first 200 simulated seconds, so the empty starting state does not bias the averages;
- compares what happened after that point with the formula.

**Every measurement comes from the engine's public interface (`snapshot()`), with no test-only hooks:**
- **Utilisation:** the change in the Server's `occupiedTime`, divided by elapsed time × Concurrency.
- **Time in system:** the Source's mean latency over Completed Requests. It is accumulated from `averageLatency × completed`, so the warm-up can be subtracted.
- **Time in Backlog:** time in system minus the mean Work time.
- **Probability of waiting:** the share of time every slot is busy. It is sampled every 0.05 simulated seconds (76,000 samples). Arrivals are Poisson, so the share of arrivals that find every slot busy equals this share of time (Poisson arrivals see time averages).
- **Share Rejected:** the Server's `rejected / received`.

Each comparison runs on seeds 1, 2 and 3. Seeds are fixed, so the results below are exactly what the tests see every time.

## Results

### M/M/1: Concurrency 1, unlimited Backlog

λ = 7 per second, μ = 10 per second (Work time 0.1 s), so ρ = 0.7. 12,000 simulated seconds, about 82,000 Requests per seed.

| | Formula | Seed 1 | Seed 2 | Seed 3 | Tolerance |
| --- | --- | --- | --- | --- | --- |
| Utilisation ρ | 0.7000 | 0.6964 | 0.7042 | 0.6971 | ± 0.01 |
| Time in system 1/(μ − λ) | 0.3333 s | 0.3317 s | 0.3319 s | 0.3403 s | ± 6% |
| Time in Backlog ρ/(μ − λ) | 0.2333 s | 0.2317 s | 0.2319 s | 0.2403 s | ± 8% |

### M/M/c (Erlang C): Concurrency 4, unlimited Backlog

λ = 30 per second, μ = 10 per second, c = 4, so ρ = 0.75. The probability of waiting is sampled over 3,800 simulated seconds. Time in Backlog uses 8,000 simulated seconds, about 234,000 Requests per seed.

| | Formula | Seed 1 | Seed 2 | Seed 3 | Tolerance |
| --- | --- | --- | --- | --- | --- |
| Probability of waiting C(c, λ/μ) | 0.5094 | 0.5032 | 0.5183 | 0.5062 | ± 0.02 |
| Utilisation | 0.7500 | 0.7498 | 0.7520 | 0.7472 | ± 0.01 |
| Time in Backlog C / (cμ − λ) | 0.0509 s | 0.0504 s | 0.0536 s | 0.0497 s | ± 10% |

### M/M/c/K: small Backlog capacity, so some Requests are Rejected

μ = 10 per second, c = 2, Backlog capacity 3 (so K = 5). 6,000 simulated seconds per seed. The case is run twice: overloaded and lightly loaded.

| | Formula | Seed 1 | Seed 2 | Seed 3 | Tolerance |
| --- | --- | --- | --- | --- | --- |
| Share Rejected, λ = 25 (overloaded) | 0.2837 | 0.2809 | 0.2863 | 0.2853 | ± 0.01 |
| Utilisation, λ = 25 | 0.8954 | 0.8938 | 0.8949 | 0.8972 | ± 0.01 |
| Share Rejected, λ = 12 (light) | 0.0413 | 0.0412 | 0.0406 | 0.0420 | ± 0.01 |

The Rejected share is p_K, the probability of K Requests present. Poisson arrivals see time averages, so it is also the share of arrivals turned away.

## Choosing the tolerances

The tolerances are a few times the run-to-run spread seen across seeds, which comes from finite run lengths. They are still far tighter than the error a plausible bug would cause.

- **Deterministic Work time** (M/D/1 instead of M/M/1) would halve the M/M/1 time in Backlog to 0.117 s, a 50% error against an 8% tolerance.
- **Arrivals at the wrong rate**, or **slots counted wrongly**, would shift Utilisation by far more than 0.01.
- **Serving Requests that should be Rejected** (Backlog capacity ignored, say) would move the Rejected share from 0.28 to 0.

Waiting times are the noisiest measure, because consecutive Requests' waits are strongly correlated near high Utilisation. That is why they have the widest tolerances, and why ρ is kept at or below 0.75 in those cases.

## Findings

The engine passed every comparison when the tests were first run. No engine defects were found, and no engine code changed for this check.

## What this does not cover

These cases verify a single Server in isolation. Calls between Components (call-and-wait across a Server and Database), Queues, Kill and Time limits are checked by the behaviour tests under `src/engine/`, not against formulas. Networks of call-and-wait Servers have no simple closed form. Verifying multi-Component architectures analytically is out of scope (ticket 10).
