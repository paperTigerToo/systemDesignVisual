# 12: Deploy to GitHub Pages and README

Status: open
Type: task
Blocked by: 11

Before starting: read `GLOSSARY.md`, `.scratch/simulator-v1/spec.md` (especially "Standing rules" and "The simulation model") and `docs/adr/`. Use the glossary terms everywhere.

## Goal

Put it online with a README that sells the engineering.

## In scope

- GitHub Actions workflow: on push to the main branch, run tests, build, deploy to GitHub Pages. Set the Vite base path for the repository name.
- README: one-paragraph pitch, a screenshot or short recording, the live link, the headline demo explained in three or four sentences, how the engine works (discrete-event, call-and-wait, seeded and reproducible, verified against queueing formulas), the assumptions, how to run locally.
- **The repository owner creates the GitHub repository and enables Pages themselves.** Stop and ask them for the repository URL; do not create accounts or repositories on their behalf, and do not push without their say-so.

## Out of scope

Custom domain, analytics.

## Acceptance checks

- The live URL loads the default Scenario already playing.
- A share link generated on the live site opens correctly on the live site.
- The workflow fails the deploy when tests fail.

## See it working

Open the live link in a private window on a different machine.

## Comments
