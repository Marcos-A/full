# TODO

Concrete next steps. The [roadmap](ROADMAP.md) has the goals, order and reasons. This file only details the current milestone, so tasks for M3 onward get added when M2 is nearly done. Delete tasks once they're done and their result is recorded.

## Where things stand

Last updated 7 November 2026.

- **Done:** M1 is live on the website. The M0 spike is finished, and the [audit](docs/desktop/repository-audit.md#m0-spike-results) has its results.
- **In progress:** M2, the committed shell, on the `desktop-m2` branch. It's built and waiting on checks on the Mac.

If you're picking this up in a new chat:

1. Read this file, then the [roadmap](ROADMAP.md). The [audit](docs/desktop/repository-audit.md) overrides the [report](docs/desktop/implementation-report.md) where they disagree.
2. Other sessions may be editing `/srv/apps/full` at the same time. Run `git status` first and leave changes you didn't make alone. For anything larger than a small edit, work in a sibling `git worktree` and rebase onto `origin/main` before merging.

## Decisions

The remaining decisions, and when each is needed, are in the [roadmap](ROADMAP.md#decisions). None is needed for M2. The app's name is `full`.

## M2 Committed shell

The M4 has no Rust or Xcode tools, and this server can't build Mac apps, so builds run on GitHub Actions, in the [Desktop build workflow](.github/workflows/desktop.yml). Pushing to a `desktop-*` branch runs it.

- [ ] On the Mac, with the DMGs from that workflow: the app starts with the network off, the inspector DMG shows no CSP violations, the release DMG has no Web Inspector, the status bar shows the build, and external links open in the default browser and can't replace the app.
- [ ] Merge `desktop-m2` once Marcos has approved it.

## Not desktop

Already open, and tracked in the [README](README.md#tests-and-manual-checks). All of these need a real browser:

- [ ] Overwrite after permission, in Chrome or Edge. Do this one first: M1 moved this code, and so far only tests with stubbed file pickers have covered the move.
- [ ] Drop keeps its handle, in Chrome or Edge.
- [ ] Paste into and from Excel, Google Sheets and Word.
- [ ] The main flow in real Safari.

And one to consider:

- [ ] Add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
