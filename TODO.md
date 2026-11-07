# TODO

Concrete next steps. The [roadmap](ROADMAP.md) has the goals, order and reasons. This file only details the current milestone, so tasks for M3 onward get added when M2 is nearly done. Delete tasks once they're done and their result is recorded.

## Where things stand

Last updated 7 November 2026.

- **Done:** M1 is live on the website. The M0 spike is finished, and the [audit](docs/desktop/repository-audit.md#m0-spike-results) has its results. M2, the committed shell, is on `main`, with its [results](docs/desktop/repository-audit.md#m2-shell-results) in the audit too.
- **Next:** M3, open.

If you're picking this up in a new chat:

1. Read this file, then the [roadmap](ROADMAP.md). The [audit](docs/desktop/repository-audit.md) overrides the [report](docs/desktop/implementation-report.md) where they disagree.
2. Other sessions may be editing `/srv/apps/full` at the same time. Run `git status` first and leave changes you didn't make alone. For anything larger than a small edit, work in a sibling `git worktree` and rebase onto `origin/main` before merging.

## Decisions

The remaining decisions, and when each is needed, are in the [roadmap](ROADMAP.md#decisions). None is needed for M3. The app's name is `full`.

## M3 Open

The M4 has no Rust or Xcode tools, and this server can't build Mac apps, so builds run on GitHub Actions, in the [Desktop build workflow](.github/workflows/desktop.yml). Pushing to a `desktop-*` branch runs it, and the DMG names end with the commit. Until M3, dropping a file from Finder does nothing in the app.

- [ ] Add a Rust grant registry: paths come only from native dialogs and native events, and the webview gets opaque IDs. Rust tests prove a path the user never offered can't be read.
- [ ] Open through the native picker, and transfer bytes with `tauri::ipc::Response`, not JSON.
- [ ] Open files dropped from Finder from `WindowEvent::DragDrop`.
- [ ] Handle Finder cold and warm opens through `RunEvent::Opened`, with cold-start paths held in Rust until the webview asks.
- [ ] Check that mixed drops, duplicates and unsupported files behave as on the web.

## Not desktop

Already open, and tracked in the [README](README.md#tests-and-manual-checks). All of these need a real browser:

- [ ] Overwrite after permission, in Chrome or Edge. Do this one first: M1 moved this code, and so far only tests with stubbed file pickers have covered the move.
- [ ] Drop keeps its handle, in Chrome or Edge.
- [ ] Paste into and from Excel, Google Sheets and Word.
- [ ] The main flow in real Safari.

And one to consider:

- [ ] Add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
