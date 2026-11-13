import { useRef } from 'react'

/** Every simplification the simulation model makes, in plain language. Mirrors "The simulation model" in the spec. */
const assumptions: { title: string; detail: string }[] = [
  {
    title: 'Connections are instant',
    detail:
      'A Request crosses a Connection in zero simulated time. There is no network delay, bandwidth or packet loss. The moving dots are only a picture of a sample of the traffic.',
  },
  {
    title: 'Killed Components are skipped instantly',
    detail:
      'The moment a Component is Killed, callers stop choosing it. Real load balancers take a while to notice through health checks; here there is no delay.',
  },
  {
    title: 'No retries',
    detail: 'A Request that is Rejected, Failed or Timed out is never sent again. Real clients often retry, which adds load exactly when things are worst.',
  },
  {
    title: 'Work times are random around a mean',
    detail:
      'Each piece of work takes an exponentially distributed time around the mean Work time you set. Real services have their own, often longer-tailed, distributions.',
  },
  {
    title: 'One downstream call per Request',
    detail:
      'A Server calls exactly one downstream Component per Request, chosen round-robin among its Connections. Real services often fan out to several.',
  },
  {
    title: 'Traffic ignores how the architecture copes',
    detail:
      'A Source sends Requests at its Rate, randomly spaced, whether or not earlier ones succeeded. Real users slow down, give up or pile on retries.',
  },
  {
    title: 'A Queue does not redeliver',
    detail:
      'A Queue releases its caller as soon as it accepts a Request. A Request lost downstream, or held by a Queue that is Killed, is gone for good.',
  },
  {
    title: 'A Server holds its slot while it waits',
    detail:
      'After its own work, a Server keeps its Concurrency slot occupied until its downstream call responds (call-and-wait), so a slow Database ties up Server slots too.',
  },
  {
    title: 'Timed-out work carries on',
    detail:
      'When a Source time limit passes, the Request is Timed out, but Components keep doing the now-wasted work and the late response is ignored.',
  },
  {
    title: 'Changes apply to future work only',
    detail:
      'Changing a setting mid-Run does not interrupt work in progress. Lowering Concurrency lets current work finish. Reviving a Killed Component brings it back empty.',
  },
  {
    title: 'Nothing else is modelled',
    detail:
      'No CPU, memory, disk, garbage collection, caches, autoscaling or cold starts. Utilisation means busy Concurrency slots, nothing more.',
  },
]

/**
 * The permanent marker that this is a model, not a forecast, and the panel that
 * lists what the model leaves out.
 */
export function ModelMarker() {
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button type="button" className="model-marker" onClick={() => dialog.current?.showModal()}>
        <span className="model-marker__flag" aria-hidden="true">
          !
        </span>
        <span className="model-marker__text">Simulated model, not a capacity prediction</span>
        <span className="model-marker__link">Assumptions</span>
      </button>
      <dialog
        ref={dialog}
        className="assumptions"
        aria-labelledby="assumptions-title"
        onClick={(event) => {
          // A click on the backdrop (the dialog element itself, outside its content) closes it.
          if (event.target === dialog.current) dialog.current.close()
        }}
      >
        <div className="assumptions__body">
          <header className="assumptions__header">
            <h2 id="assumptions-title">What this model assumes</h2>
            <button type="button" className="assumptions__close" onClick={() => dialog.current?.close()} aria-label="Close">
              ×
            </button>
          </header>
          <p className="assumptions__intro">
            The simulator shows how queueing, Concurrency and call-and-wait interact. It is deliberately simple, so its
            numbers explain behaviour but do not predict the capacity of a real system. It is checked against textbook
            queueing formulas for a single Server; everything below is simplified on purpose.
          </p>
          <ol className="assumptions__list">
            {assumptions.map(({ title, detail }) => (
              <li key={title}>
                <strong>{title}.</strong> {detail}
              </li>
            ))}
          </ol>
        </div>
      </dialog>
    </>
  )
}
