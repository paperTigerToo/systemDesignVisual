# 12: Deploy to GitHub Pages and README

Status: claimed
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

### Progress (2026-11-12): everything except the live deploy

- `vite.config.ts` reads the base path from `BASE_PATH` and defaults to `/` locally. The workflow sets it to `/<repository name>/` from `github.event.repository.name`, so no repository name is hard-coded.
- `.github/workflows/deploy.yml` runs on push to `main` or `master`, or manually. Its steps are `npm ci`, then `npm test`, then `npm run build`, then upload the Pages artifact. A separate `deploy` job runs `actions/deploy-pages` and `needs: build`, so a failing test fails the build job and the deploy never runs.
- `README.md` has the pitch, two screenshots (`docs/images/`, captured from the production build in headless Edge), the headline demo, how the engine works, the assumptions, local setup and deployment. The live link is a `LIVE_URL` placeholder until the repository exists.
- Checked locally against the production build served under `/system-design-simulator/` (`vite preview`, launch config `pages-preview`):
  - The default Scenario loads already playing.
  - A share link made after a Kill keeps the base path.
  - Opened in a fresh tab, that link replays the recorded Kill.
- 120 tests pass, and `npm run build` is clean.

**Waiting on the owner.** Create the GitHub repository, set Settings → Pages → Source to "GitHub Actions", and send the repository URL. Then: add the remote, push (only with the owner's go-ahead), fill in `LIVE_URL`, and run the acceptance checks against the live site.
