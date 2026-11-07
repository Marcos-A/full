# TODO

Concrete next steps. The [roadmap](ROADMAP.md) has the goals, order and reasons. This file only details the current milestone, so tasks for M3 onward get added when M2 is nearly done. Delete tasks once they're done and their result is recorded.

## Where things stand

Last updated 7 November 2026.

- **Done:** M1 is live on the website. The M0 spike is finished, and the [audit](docs/desktop/repository-audit.md#m0-spike-results) has its results.
- **Next:** M2, the committed shell.

If you're picking this up in a new chat:

1. Read this file, then the [roadmap](ROADMAP.md). The [audit](docs/desktop/repository-audit.md) overrides the [report](docs/desktop/implementation-report.md) where they disagree.
2. Other sessions may be editing `/srv/apps/full` at the same time. Run `git status` first and leave changes you didn't make alone. For anything larger than a small edit, work in a sibling `git worktree` and rebase onto `origin/main` before merging.

## Decisions

The remaining decisions, and when each is needed, are in the [roadmap](ROADMAP.md#decisions). None is needed for M2. The app's name is `full`.

## M2 Committed shell

The M4 has no Rust or Xcode tools, and this server can't build Mac apps, so builds run on GitHub Actions. The [Desktop spike workflow](.github/workflows/desktop-spike.yml) generates a throwaway shell with a native event logger. Run it from the Actions page if another spike build is needed, and replace it in this milestone.

- [ ] Add `src-tauri/` with the real identifier, a real version number and minimal capabilities. Devtools stay off in release builds.
- [ ] Use the CSP from the spike workflow, including the `style-src` exclusion, which M0 showed works.
- [ ] Add `src-tauri/` to `.dockerignore` and `src-tauri/target/` to `.gitignore`.
- [ ] Add the `desktop:*` scripts, the desktop entry point, build info in the status bar and safe external links.
- [ ] Replace the spike workflow with one that builds a DMG from the committed shell.
- [ ] Check that the app starts with the network off and shows no CSP violations, and that a search of `dist/` finds no Tauri code.
- [ ] Decide whether the WebdriverIO route is worth keeping.

## Not desktop

Already open, and tracked in the [README](README.md#tests-and-manual-checks). All of these need a real browser:

- [ ] Overwrite after permission, in Chrome or Edge. Do this one first: M1 moved this code, and so far only tests with stubbed file pickers have covered the move.
- [ ] Drop keeps its handle, in Chrome or Edge.
- [ ] Paste into and from Excel, Google Sheets and Word.
- [ ] The main flow in real Safari.

And one to consider:

- [ ] Add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
