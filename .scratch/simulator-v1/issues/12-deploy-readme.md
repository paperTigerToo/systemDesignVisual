# 12: Deploy to GitHub Pages and README

Status: resolved
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

### Resolved (2026-11-25): live at https://papertigertoo.github.io/systemDesignVisual/

- The owner asked for the repository to be created for them: `paperTigerToo/systemDesignVisual`, public, so the free plan can serve it on Pages. Pages is set to build from GitHub Actions. `master` is pushed and the README has the live link.
- First deploy (run 45726605809): tests, build and deploy all passed.
- Acceptance checks on the live site:
  - **Loads playing.** The live URL opens "More servers didn't fix it" already playing.
  - **Share links.** On the live site, killed the Database and made a share link. It keeps the `/systemDesignVisual/` path. Opened in a fresh tab, it replayed all 4 recorded changes, including the Kill at its recorded time.
  - **Failing tests block the deploy.** Ran the workflow by hand (run 45726857808) on a throwaway branch with one deliberately failing test. `npm test` failed, the build and upload were skipped, and the deploy job was skipped. The branch was deleted afterwards; `master` was never touched.
- Not yet done: the "different machine, private window" check, which is for the owner.
- Follow-up: GitHub warns that `actions/checkout@v4`, `actions/setup-node@v4` and `actions/upload-artifact@v4` target Node 20, which is deprecated. They still run, forced onto Node 24.
