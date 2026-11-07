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

The build has passed on a hosted Apple Silicon Mac, but the app hasn't been opened yet, so expect to adjust things.

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

- [ ] Is `window.isSecureContext` true? Are `crypto.randomUUID`, `navigator.locks`, `navigator.clipboard` and `navigator.storage.persist` available?
- [ ] Does the app start at all? `navigator.locks` isn't guarded at startup.
- [ ] Does the CSP work with `style-src` excluded from Tauri's changes, and what breaks without it?
- [ ] Does the module worker load, opening a CSV over 5 MB under the CSP?

### Recovery

- [ ] Does IndexedDB survive a normal quit, a Force Quit and `kill -9`, within and after the 500 ms debounce? This is the stop-and-rethink question.
- [ ] Does it survive replacing the app with a rebuilt one using the same identifier?
- [ ] After a Force Quit, are records offered for recovery? This checks that the Web Lock is released.
- [ ] What happens if the web content process dies while the app stays open?

### Input

- [ ] With the default menu: do Cmd+C, X, V and A work in the source editor, rendered side and grid?
- [ ] Do Cmd+Z and Cmd+Shift+Z reach the app's handler rather than the native undo? Do Cmd+S, Cmd+K and Alt+W work? Does each fire once?
- [ ] Do dead keys work when typing `à` in a selected grid cell?
- [ ] Do row, column and split-pane drags work with `dragDropEnabled` on?
- [ ] Does a drop from Finder arrive natively, and does the HTML5 drop handler stay out of the way?

### Close and quit

- [ ] Which events do closing the window, Cmd+Q, Dock quit and logout each fire? Can each be held back while a dialog is open?

### Measure

- [ ] Cold and warm launch to interactive, against the report's budgets.
- [ ] Open a 1 MB Markdown file and a 100,000-row CSV. Type in the Markdown file. Compare with the [Linux baseline](docs/desktop/repository-audit.md#6-baseline-quality-gate).
- [ ] Open a 50 MB file and type, watching for pauses from `refreshRecovery` and persisting.

### Wrap up

- [ ] Guard the startup use of `navigator.locks` in shared code, if the answers call for it. M1 is done and left this open.
- [ ] Update the audit and revise the effort estimates from the answers. Throw away the shell.

## Not desktop

Already open, and tracked in the [README](README.md#tests-and-manual-checks). All of these need a real browser:

- [ ] Overwrite after permission, in Chrome or Edge. Do this one first: M1 moved this code, and so far only tests with stubbed file pickers have covered the move.
- [ ] Drop keeps its handle, in Chrome or Edge.
- [ ] Paste into and from Excel, Google Sheets and Word.
- [ ] Dead keys on a Spanish or Catalan keyboard.
- [ ] The main flow in real Safari. It also covers much of what M0 needs, so do it on the same Mac.

And one to consider:

- [ ] Add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
