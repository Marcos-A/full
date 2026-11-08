# TODO

Concrete next steps. The [roadmap](ROADMAP.md) has the goals, order and reasons. This file only details the current milestone, so tasks for each milestone get added when the one before is nearly done. Delete tasks once they're done and their result is recorded.

## Where things stand

Last updated 8 November 2026.

- **Done:** M1 is live on the website. The M0 spike is finished, and the [audit](docs/desktop/repository-audit.md#m0-spike-results) has its results. M2, the committed shell, is on `main`, with its [results](docs/desktop/repository-audit.md#m2-shell-results) in the audit too. M3, open, is finished, with its [results](docs/desktop/repository-audit.md#m3-open-results) there as well.
- **Next:** M4, save.

If you're picking this up in a new chat:

1. Read this file, then the [roadmap](ROADMAP.md). The [audit](docs/desktop/repository-audit.md) overrides the [report](docs/desktop/implementation-report.md) where they disagree.
2. Other sessions may be editing `/srv/apps/full` at the same time. Run `git status` first and leave changes you didn't make alone. For anything larger than a small edit, work in a sibling `git worktree` and rebase onto `origin/main` before merging.

## Decisions

The remaining decisions, and when each is needed, are in the [roadmap](ROADMAP.md#decisions). None is needed for M4. The app's name is `full`.

## M4 Save

The M4 has no Rust or Xcode tools, and this server can't build Mac apps, so builds run on GitHub Actions, in the [Desktop build workflow](.github/workflows/desktop.yml). Pushing to a `desktop-*` branch runs it, and the DMG names end with the commit. Until M4, saving makes a copy in Downloads, and the app shows the "can't overwrite files" notice.

- [ ] Save and Save As through Rust, by grant. The Save panel's destination is granted in Rust, like an opened file. A binding with no grant, restored from a recovery record, can't be written until M5 adds the native re-grant.
- [ ] Replace atomically, keeping mode, Finder tags, extended attributes and creation date. See [correction 3](docs/desktop/repository-audit.md#security-and-data), and don't describe it as a true compare-and-swap.
- [ ] Add the expected revision to `write`, and a conflict dialog with Reload on desktop.
- [ ] Give `exportCopy` a native route instead of Downloads, including the failed-save escape and "Download copy" in recovery.
- [ ] Rust tests for failures in real temp directories.
- [ ] On the Mac: scenarios 1, 4 and 5 of the [report's section 11](docs/desktop/implementation-report.md#11-tests-and-acceptance-matrix), and check that mode, tags and creation date survive a save, including in iCloud and Dropbox folders.

## Not desktop

Already open, and tracked in the [README](README.md#tests-and-manual-checks). All of these need a real browser:

- [ ] Overwrite after permission, in Chrome or Edge. Do this one first: M1 moved this code, and so far only tests with stubbed file pickers have covered the move.
- [ ] Drop keeps its handle, in Chrome or Edge.
- [ ] Paste into and from Excel, Google Sheets and Word.
- [ ] The main flow in real Safari.

And one to consider:

- [ ] Add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
