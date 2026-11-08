# TODO

Concrete next steps. The [roadmap](ROADMAP.md) has the goals, order and reasons. This file only details the current milestone, so tasks for each milestone get added when the one before is nearly done. Delete tasks once they're done and their result is recorded.

## Where things stand

Last updated 8 November 2026.

- **Done:** M1 is live on the website. The M0 spike is finished, and the [audit](docs/desktop/repository-audit.md#m0-spike-results) has its results. M2, the committed shell, is on `main`, with its [results](docs/desktop/repository-audit.md#m2-shell-results) in the audit too. M3, open, is finished, with its [results](docs/desktop/repository-audit.md#m3-open-results) there as well. M4, save, is finished, with its [results](docs/desktop/repository-audit.md#m4-save-results) there too.
- **Next:** M5, close, quit and recovery.

If you're picking this up in a new chat:

1. Read this file, then the [roadmap](ROADMAP.md). The [audit](docs/desktop/repository-audit.md) overrides the [report](docs/desktop/implementation-report.md) where they disagree.
2. Other sessions may be editing `/srv/apps/full` at the same time. Run `git status` first and leave changes you didn't make alone. For anything larger than a small edit, work in a sibling `git worktree` and rebase onto `origin/main` before merging.

## Decisions

The remaining decisions, and when each is needed, are in the [roadmap](ROADMAP.md#decisions). Number 1, whether Cmd+W closes the file, is needed for M5. The app's name is `full`.

## M5 Close, quit and recovery

The M4 has no Rust or Xcode tools, and this server can't build Mac apps, so builds run on GitHub Actions, in the [Desktop build workflow](.github/workflows/desktop.yml). Pushing to a `desktop-*` branch runs it, and the DMG names end with the commit.

- [ ] Hold back closing the window with unsaved work, through `closeAll` in shared code, and await the recovery flush before exit.
- [ ] Try a custom Quit menu item for Cmd+Q, then find out whether Dock Quit and logout can be caught natively at all. Where they can't, make sure recovery covers them and say so in the docs. See the [M0 results](docs/desktop/repository-audit.md#m0-spike-results).
- [ ] Restore with the native path, and add a Rust-owned re-grant on first save of a restored file: a native confirmation naming the path, or the Save panel. See [correction 2](docs/desktop/repository-audit.md#security-and-data). Today `ensureWritable` in `src/desktop/host.ts` sends these files to Save As.
- [ ] Find out why Option+W quit the app in some M0 runs, along with decision 1.
- [ ] Add a maximum wait to `schedulePersist`. It resets on every change, so a long burst of typing with no pause could lose more than the last 500 ms.
- [ ] On the Mac: Cancel, Don't Save, Save and failed Save for closing and for each quit path that can be held back, Force Quit recovery in a packaged build (scenario 6), and data surviving an app update with a real version bump.

## Not desktop

Already open, and tracked in the [README](README.md#tests-and-manual-checks). All of these need a real browser:

- [ ] Overwrite after permission, in Chrome or Edge. Do this one first: M1 moved this code, and so far only tests with stubbed file pickers have covered the move.
- [ ] Drop keeps its handle, in Chrome or Edge.
- [ ] Paste into and from Excel, Google Sheets and Word.
- [ ] The main flow in real Safari.

And one to consider:

- [ ] Add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
