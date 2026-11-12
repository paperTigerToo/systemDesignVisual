# 06: Editor: palette, Connections, settings panel, validation

Status: open
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
