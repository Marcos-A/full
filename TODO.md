# TODO

Concrete next steps. The [roadmap](ROADMAP.md) has the goals, order and reasons. This file only details the current milestone, so tasks for each milestone get added when the one before is nearly done. Delete tasks once they're done and their result is recorded.

## Where things stand

Last updated 8 November 2026.

- **Done:** M1 is live on the website. The M0 spike is finished, and the [audit](docs/desktop/repository-audit.md#m0-spike-results) has its results. M2, the committed shell, is on `main`, with its [results](docs/desktop/repository-audit.md#m2-shell-results) in the audit too. M3, open, is finished, with its [results](docs/desktop/repository-audit.md#m3-open-results) there as well. M4, save, is finished, with its [results](docs/desktop/repository-audit.md#m4-save-results) there too. M5, close, quit and recovery, is finished, with its [results](docs/desktop/repository-audit.md#m5-close-results) there as well.
- **Next:** M6, Finder and packaging.

If you're picking this up in a new chat:

1. Read this file, then the [roadmap](ROADMAP.md). The [audit](docs/desktop/repository-audit.md) overrides the [report](docs/desktop/implementation-report.md) where they disagree.
2. Other sessions may be editing `/srv/apps/full` at the same time. Run `git status` first and leave changes you didn't make alone. For anything larger than a small edit, work in a sibling `git worktree` and rebase onto `origin/main` before merging.

## Decisions

The remaining decisions, and when each is needed, are in the [roadmap](ROADMAP.md#decisions). Two are needed for M6. The app's name is `full`.

## M6 Finder and packaging

Builds run on GitHub Actions, in the [Desktop build workflow](.github/workflows/desktop.yml), because the M4 has no Rust or Xcode tools and this server can't build Mac apps.

- [ ] Declare the file types, including a real double-click and Open With in Finder, which M3 couldn't check. Decide `.txt` first: see the [roadmap's decisions](ROADMAP.md#decisions).
- [ ] App and document icons.
- [ ] Native menus using the existing commands. M5 only added Quit and Close to the default menu, in English.
- [ ] A universal or Apple Silicon build. Decide Intel first.
- [ ] Run the launch, open, typing and save budgets on a packaged build, including cold launch and opening a 1 MB Markdown file.
- [ ] Choose the oldest supported macOS, and guard `navigator.locks` if that version needs it.
- [ ] Scenarios 2, 3 and 7 for a clean macOS user.

## Not desktop

Already open, and tracked in the [README](README.md#tests-and-manual-checks). All of these need a real browser:

- [ ] Overwrite after permission, in Chrome or Edge. Do this one first: M1 moved this code, and so far only tests with stubbed file pickers have covered the move.
- [ ] Drop keeps its handle, in Chrome or Edge.
- [ ] Paste into and from Excel, Google Sheets and Word.
- [ ] The main flow in real Safari.

And one to consider:

- [ ] Add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
