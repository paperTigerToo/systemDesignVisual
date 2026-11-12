# 06: Editor: palette, Connections, settings panel, validation

Status: resolved
Type: task
Blocked by: 04

Before starting: read `GLOSSARY.md`, `.scratch/simulator-v1/spec.md` (especially "Standing rules" and "The simulation model") and `docs/adr/`. Use the glossary terms everywhere.

## Goal

Replace the hard-coded architectures with a real editor.

## In scope

- Palette on the left: drag Source, Server, Database and (if ticket 05 is done; otherwise leave a clean extension point) Queue onto the canvas.
- Draw and delete Connections; move, rename and delete Components.
- Settings panel on the right for the selected Component: Rate and time limit for a Source; Concurrency, Work time and Backlog capacity for Server and Database; capacity for a Queue. Sensible defaults and input limits.
- Validation as a pure function (in the engine folder or beside it, no React) implementing every rule in the spec section "Allowed architectures", returning a list of problems tied to Components or Connections.
- Problems shown inline on the offending Component and in a list; play is disabled while any exist.
- In this ticket, editing is done while **stopped**: any edit resets the Run. Live editing is ticket 07.
- The app opens on a small valid starter architecture.

## Out of scope

Editing mid-Run, saving, undo/redo.

## Acceptance checks

- Tests for each validation rule, one passing and one failing case each, including a cycle through three Components.
- Building Source to two Servers to Database by hand in the browser and pressing play behaves like the ticket 04 architecture.
- Engine tests and determinism test still pass.

## See it working

Start from an empty canvas, build an architecture by dragging and connecting, see an error when a Connection goes into a Source, fix it, press play.

## Comments

**2026-11-12, resolved.** Notes for later tickets:

- **Validation** is `validateArchitecture(architecture): Problem[]` in `src/engine/validate.ts`, exported from the engine. A `Problem` is `{ code, message, componentId?, connection? }`. Beyond the spec's rules, it also checks:
  - a Queue may only hand work to a Server or Database (from the ticket 05 notes);
  - a Source must have an outgoing Connection;
  - duplicate Component ids;
  - Connections to missing Components;
  - settings the engine cannot run, such as Concurrency below 1 or not whole, or a Work time of 0.
  Ticket 09's import can reuse it as is.
- **Design model** in `src/app/design.ts`: `Design = { seed, architecture, layout }`, where layout holds the position and name of each Component. It provides pure editing operations (add, remove, move, rename, update a setting, add and remove Connections), default settings, `settingFields` (labels, units, limits, display scale; Work time is shown in ms) and `starterDesign`. Adding a Connection to itself, or one that already exists, is refused outright; the validator still reports both for imported data.
- **Store** (`simulationStore.ts`) holds `design`, `problems`, `selection` and `loadCount`. Any change to what the engine simulates rebuilds the engine from scratch: the Run goes back to t = 0 and pauses. Moving and renaming do not reset the Run. Ticket 07 replaces the rebuild with Interventions. `togglePlaying` refuses to start while there are problems.
- **Canvas** (`Canvas.tsx`) is controlled by the store. Node and edge changes from React Flow are translated into store actions, and the Delete and Backspace keys remove the selection. Every node has handles on both sides, so a disallowed Connection (into a Source, out of a Database) can be drawn and is then explained by validation, as this ticket's check required. The ticket 04 `pointerEvents: 'all'` workaround is gone because nodes are now selectable. Kill clicks stop propagation so they do not select the node.
- Nodes show their problems inline with a dashed red border. Problem Connections are drawn dashed red. The Problems list in the right panel selects the offending Component or Connection when its name is clicked.
- "Load" menu in the toolbar: Starter, the two examples from `demoArchitectures.ts` (now also exported as `examples`), and Empty canvas. Loading bumps `loadCount`, and the canvas refits its view. Fitting never zooms past 100%, and an empty canvas gets a plain 100% view, because fitting to nothing zoomed far in.
- Palette buttons have aria-labels. Clicking a palette button adds the Component at the centre of the view, stepping right past any Components already there.
- Checked in the browser (1400×850): from an empty canvas, added a Source, two Servers and a Database. Drew Server 1 → Source and saw "Nothing can send Requests into a Source". Selected that Connection from the Problems list and deleted it, then connected Source → both Servers → Database. Play became enabled; both Servers shared the load (30 and 29 completed at t = 5 s). Also checked: selecting a Component during a Run leaves it running; changing its Concurrency resets to t = 0 and pauses.
