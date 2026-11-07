# TODO

Concrete next steps. The [roadmap](ROADMAP.md) has the goals, order and reasons. This file only details the current milestone, so tasks for M2 onward get added when M0 is nearly done. Delete tasks once they're done and their result is recorded.

## Where things stand

Last updated 7 November 2026.

- **Done:** M1, the shared-code seam, is merged, pushed and live on the website (`ecef218`).
- **Next:** the M0 spike below. Marcos runs it on the M4, using a DMG built on a hosted Mac, because this server has no Rust and can't build Mac apps. Nothing desktop-specific can move until it reports back.
- **After M0:** record the answers in the [audit](docs/desktop/repository-audit.md#m0-spike-results), revise the estimates, then add the M2 tasks here.

If you're picking this up in a new chat:

1. Read this file, then the [roadmap](ROADMAP.md). The [audit](docs/desktop/repository-audit.md) overrides the [report](docs/desktop/implementation-report.md) where they disagree.
2. Other sessions may be editing `/srv/apps/full` at the same time. Run `git status` first and leave changes you didn't make alone. For anything larger than a small edit, work in a sibling `git worktree` and rebase onto `origin/main` before merging.

## Decisions

The remaining decisions, and when each is needed, are in the [roadmap](ROADMAP.md#decisions). None is needed yet. The first is the app's name, for M2.

## M0 Spike on a real Mac

On Marcos's M4, using a DMG built by the [Desktop spike workflow](.github/workflows/desktop-spike.yml). It wraps the unmodified `dist/` in the latest stable Tauri 2, generating the shell on each run so none of it enters the repo. Record each answer in the [audit](docs/desktop/repository-audit.md#m0-spike-results).

### Setup

The Mac needs no toolchain. A push to the `desktop-spike` branch starts a build.

1. Download `full-spike-dmg` from the latest [run](https://github.com/Marcos-A/full/actions/workflows/desktop-spike.yml). Artifacts expire after 14 days.
2. Unzip it, open the DMG and drag `full.app` to Applications.
3. Clear the download block, because the app has only an ad hoc signature:

   ```sh
   xattr -cr /Applications/full.app
   open /Applications/full.app
   ```

To test replacing the app, choose Re-run all jobs on the run's page and repeat these steps with the new DMG.

The app builds, installs and starts on the M4. The answers so far are in the [audit](docs/desktop/repository-audit.md#m0-spike-results).

- **The DMG is not for distribution.** Signing and notarization come in M7.
- **The identifier is deliberately not the real one,** so test data never lands under `com.marcos-a.full`.
- **The CSP is the website's, plus IPC in `connect-src`.** Devtools are on for the spike only.
- **To inspect the app,** right-click and choose Inspect Element. This answers most of the platform questions at once:

  ```js
  ({ secure: isSecureContext, uuid: typeof crypto.randomUUID, locks: !!navigator.locks, clipboard: !!navigator.clipboard, persist: typeof navigator.storage?.persist })
  ```

- **"Build unknown" in the status bar is expected:** the spike has no `build-info.json`. M2 adds it.
- **To finish,** delete `/Applications/full.app` and whatever the spike left in `~/Library` (search for its identifier). Note where the data was: it tells M5 what an update has to preserve.

Bring the answers back to a chat on the server, and it can record them in the audit.

### Platform

- [ ] What breaks if `style-src` isn't excluded from Tauri's changes? It works with the exclusion.

### Input

- [ ] Find out why Alt+W quits the app when the file has unsaved changes. Safari and Chrome ask first, and so does the tab's × in the app. Nothing is lost, because the work is offered for recovery.

### Measure

- [ ] Cold and warm launch to interactive, against the report's budgets. The file and typing results are in the [audit](docs/desktop/repository-audit.md#m0-spike-results).

### Wrap up

- [ ] Guard the startup use of `navigator.locks` in shared code, if the answers call for it. M1 is done and left this open.
- [ ] Update the audit and revise the effort estimates from the answers. Throw away the shell.

## Not desktop

Already open, and tracked in the [README](README.md#tests-and-manual-checks). All of these need a real browser:

- [ ] Overwrite after permission, in Chrome or Edge. Do this one first: M1 moved this code, and so far only tests with stubbed file pickers have covered the move.
- [ ] Drop keeps its handle, in Chrome or Edge.
- [ ] Paste into and from Excel, Google Sheets and Word.
- [ ] The main flow in real Safari. It also covers much of what M0 needs, so do it on the same Mac.

And one to consider:

- [ ] Add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
