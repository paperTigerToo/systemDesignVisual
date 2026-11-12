# Requests are call-and-wait, not one-way flow

A request could have been modelled as a token that moves one way through the architecture and vanishes, which is far simpler to simulate. We chose call-and-wait instead: a Server keeps a concurrency slot occupied while the component it called is working, and the request completes back at the Source. This is what makes a slow Database saturate the Servers in front of it (the headline "more servers didn't fix it" demo), and it is what gives the Queue a distinct meaning as the only component that releases its caller early.

## Consequences

- The engine must track in-flight calls and unwind them (response, failure), not just forward tokens.
- Latency is measured at the Source, end to end, for the synchronous part of the path only.
