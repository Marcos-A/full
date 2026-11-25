# TODO

Concrete next steps. The [roadmap](ROADMAP.md) has the goals, order and reasons. This file only details the current milestone, so tasks for each milestone get added when the one before is nearly done. Delete tasks once they're done and their result is recorded.

## Where things stand

Last updated 14 November 2026.

- **Done:** M1 is live on the website. The M0 spike is finished, and the [audit](docs/desktop/repository-audit.md#m0-spike-results) has its results. M2, the committed shell, is on `main`, with its [results](docs/desktop/repository-audit.md#m2-shell-results) in the audit too. M3, open, is finished, with its [results](docs/desktop/repository-audit.md#m3-open-results) there as well. M4, save, is finished, with its [results](docs/desktop/repository-audit.md#m4-save-results) there too. M5, close, quit and recovery, is finished, with its [results](docs/desktop/repository-audit.md#m5-close-results) there as well. M6, Finder and packaging, is finished, with its [results](docs/desktop/repository-audit.md#m6-finder-and-packaging-results) there too.
- **Released:** [v0.2.0](https://github.com/Marcos-A/full/releases/tag/v0.2.0) on 14 November 2026, with the find panel restyle, the view keys, Mac zoom, exports, HTML previews, Markdown formatting keys and bar, reopening the last session, and the searchable shortcut list. Its notes are in [docs/releases](docs/releases/v0.2.0.md). [v0.1.0](https://github.com/Marcos-A/full/releases/tag/v0.1.0), the first public download, came out on 11 November 2026. Both are ad hoc signed and published as immutable releases with a build attestation. The website shows the version too.
- **Next:** nothing planned for the Mac app. Signing and notarization, the rest of M7, stay postponed.
- **Window positions** reopen where they were, checked on the M4 with build `b9bccb9` (on branch `desktop-window-frames` until merged).
- **Find and replace everywhere** is on branch `desktop-find-replace`, waiting for its check on the M4 (see below).
- **Multiple windows** passed all six Mac checks on 25 November 2026 ([results](docs/desktop/repository-audit.md#multiple-windows-results)), as did line numbers and the split editor. Not in a release yet.
- **Open With for `.py`:** since the `macos-15` runner image of 18 November, where Python's IDLE claims `.py` by extension, full claims it by extension too (`425daf5`), or macOS stops offering it there.
- **Mac test builds** are published as pre-releases named `mac-<commit>`. The specs of the v0.2.0 features and the decisions taken while building them are in git history (TODO.md at `0643699`).

If you're picking this up in a new chat:

1. Read this file, then the [roadmap](ROADMAP.md). The [audit](docs/desktop/repository-audit.md) overrides the [report](docs/desktop/implementation-report.md) where they disagree.
2. Other sessions may be editing `/srv/apps/full` at the same time. Run `git status` first and leave changes you didn't make alone. For anything larger than a small edit, work in a sibling `git worktree` and rebase onto `origin/main` before merging.

## Decisions

None is waiting. Joining the Apple Developer Program is still postponed: see the [roadmap](ROADMAP.md#decisions).

## M7 Signing (postponed)

For when Gatekeeper warnings are no longer acceptable.

- [ ] Decide on the Apple Developer Program, then add a Developer ID certificate and the notarization credentials to GitHub's secrets.
- [ ] Sign with Developer ID and the hardened runtime, notarize, and staple the DMG in CI.
- [ ] Install the downloaded DMG on a separate Mac and check that Gatekeeper opens it with no warning.
- [ ] Remove the README's quarantine step once that holds.

## Still to check from v0.2.0

The Mac checks passed on the M4 with build `aec2d8d`.

- [ ] Download v0.2.0 as a new user would, following the README's download check, and check that the status bar shows `v0.2.0`. Record it in the README's manual checks.
- [ ] Open XLSX exports, including comma decimals in a quoted comma-separated file and grouped thousands, in Numbers and LibreOffice, with no repair prompt. Excel for Mac, Google Sheets and printing to PDF in Chrome, Firefox and Safari passed.
- [ ] Consider: reopened files on the Mac ask for the restored-file confirmation on their first save, as restored files always have. With quitting no longer asking, that may be met more often.

## Find and replace everywhere

Built on branch `desktop-find-replace`: Find (Cmd/Ctrl+F) and Find and Replace (Cmd/Ctrl+Alt+F) in the palette and the Mac app's Edit menu, for every file type. Text views open CodeMirror's panel in the editor last worked in. Rendered only Markdown and the HTML preview switch to source only first, and side by side stays as it is. The CSV table has its own bar ([CsvFind.tsx](src/ui/CsvFind.tsx), [csvSearch.ts](src/core/csvSearch.ts)), loaded with `import()` and fetched in idle time once a table is shown.

Decisions taken while building it:

- The table is searched on the main thread in slices of about 6 ms, not on a worker: a worker would need the whole table copied to it after every edit. Typing in the field stayed at a 22 ms median and 27 ms p95 while each key searched 600,000 cells.
- Replace All is one `CsvModel.setCells` splice rather than `setCell` per match inside a `transaction`: each `setCell` recounts the columns of every row, which is quadratic over 100,000 matches. One undo still reverts it, and 99,999 cells take about 0.3 s.
- The first Replace on a match that isn't shown yet only shows it, as editors do.
- Until the bar has the focus, Find takes the focus off the grid, so keys typed early can't edit a cell.

- [ ] **Check on the M4,** as this adds keyboard shortcuts and menu items: Cmd+F and Cmd+Option+F in each view, from the menu and the keyboard, on a Spanish keyboard too; Edit › Find… next to the new File menu items; and the CSV bar in a half-screen window on a MacBook Air. Then record it in both READMEs' manual checks, where the row says "Not yet run".

## PDF in the Mac app, later

- In WKWebView, `window.print()` does nothing. Tauri 2 has `WebviewWindow::print()` (wry 0.57 runs an `NSPrintOperation` on macOS). Add a `print_page` command in [main.rs](src-tauri/src/main.rs) that calls it on the window that asked, and a "Print…" item with Cmd+P in the File section of [menu_table.rs](src-tauri/src/menu_table.rs).
- Check on the M4: that it uses the `@media print` styles; whether `beforeprint` and `afterprint` fire (if not, build `#print-root` before calling `print_page` and remove it when the call resolves, after finding out whether it resolves when the dialog opens or when it closes); that the PDF button's "Save as PDF" suggests the right name; and light and dark.
- Once that passes, set `canPrint` to true in `desktopHost`, add `export-pdf` to both menu lists, and record the results in the [audit](docs/desktop/repository-audit.md).

## Improvements to consider

- [ ] Consider: title each Mac window after its file in front, as every window is called "full" in the Window menu now.
- [ ] Consider: a more vibrant syntax highlighting theme, in the vein of Sublime Text's. The app is mostly for reading and analysing the contents of code files, not for coding for long hours, so stronger colours suit it better than a muted theme. The highlighting is set up in [SourcePane.ts](src/doc/SourcePane.ts).

## Not desktop

- [ ] Consider: add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
