# TODO

Concrete next steps. The [roadmap](ROADMAP.md) has the goals, order and reasons. This file only details the current milestone, so tasks for each milestone get added when the one before is nearly done. Delete tasks once they're done and their result is recorded.

## Where things stand

Last updated 14 November 2026.

- **Done:** M1 is live on the website. The M0 spike is finished, and the [audit](docs/desktop/repository-audit.md#m0-spike-results) has its results. M2, the committed shell, is on `main`, with its [results](docs/desktop/repository-audit.md#m2-shell-results) in the audit too. M3, open, is finished, with its [results](docs/desktop/repository-audit.md#m3-open-results) there as well. M4, save, is finished, with its [results](docs/desktop/repository-audit.md#m4-save-results) there too. M5, close, quit and recovery, is finished, with its [results](docs/desktop/repository-audit.md#m5-close-results) there as well. M6, Finder and packaging, is finished, with its [results](docs/desktop/repository-audit.md#m6-finder-and-packaging-results) there too.
- **Released:** [v0.2.0](https://github.com/Marcos-A/full/releases/tag/v0.2.0) on 14 November 2026, with the find panel restyle, the view keys, Mac zoom, exports, HTML previews, Markdown formatting keys and bar, reopening the last session, and the searchable shortcut list. Its notes are in [docs/releases](docs/releases/v0.2.0.md). [v0.1.0](https://github.com/Marcos-A/full/releases/tag/v0.1.0), the first public download, came out on 11 November 2026. Both are ad hoc signed and published as immutable releases with a build attestation. The website shows the version too.
- **Next:** nothing planned for the Mac app. Signing and notarization, the rest of M7, stay postponed.
- **Window positions** reopen where they were, checked on the M4 with build `b9bccb9` (on branch `desktop-window-frames` until merged).
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

Decided on 25 November 2026, for a new chat to take on. Today the only find and replace is CodeMirror's own panel (`search` and `searchKeymap` in [SourcePane.ts](src/doc/SourcePane.ts)), opened with Cmd/Ctrl+F while a text editor has the focus. It's in no menu and no palette command, so it's found only by knowing the key. Where it's missing:

| What's on screen | Now |
|---|---|
| Text and code, raw CSV text, Markdown or HTML source | Cmd/Ctrl+F in the editor only |
| CSV table | Nothing. The website falls through to the browser's find, which sees only the rows drawn (the grid draws rows as it scrolls) and can't replace. The Mac app does nothing |
| Markdown rendered only, or the rendered side focused | Nothing. The browser's find on the website, without replace, and nothing in the Mac app |
| HTML preview | Nothing. It's read-only, so find only |

To do, in this order:

- [ ] **Find, and Find and Replace, as commands.** Add them to the palette and the Mac app's Edit menu: Find… with Cmd+F, and Find and Replace… with Cmd+Option+F. They work for every file type. In a text view they open the existing panel, with the replace field focused for the second. New shortcuts go in [shortcuts.ts](src/ui/shortcuts.ts) first, and from there into both READMEs' Keyboard tables (a unit test checks that they match). New menu items go in both [menu_table.rs](src-tauri/src/menu_table.rs) and `MENU_COMMANDS` in [menu.ts](src/desktop/menu.ts), which a unit test also compares.
- [ ] **Markdown rendered only:** Find switches to source only, or to side by side if that was in use, and opens the panel there. The source is the true copy, and searching it is simpler and more reliable than searching the rendered view.
- [ ] **Find and replace in the CSV table,** the larger part:
  - **The bar:** like the text one, above the grid. It searches cell values in the model ([csvModel.ts](src/core/csvModel.ts)), not the DOM, so it covers every row of a 100,000-row file.
  - **Moving between matches:** Next and Previous, also Enter and Shift+Enter, select the matching cell and scroll to it with `scrollToCell` in [CsvGrid.tsx](src/ui/CsvGrid.tsx). Matches are highlighted.
  - **Replacing:** Replace changes the current cell with `setCell`, and Replace All changes every match inside one `transaction`, so a single undo reverts it.
  - **Options:** case, whole cell, and only in the selected columns.
  - **Speed:** keep it snappy with 100,000 rows. Search on a worker, or in chunks, so typing in the field never blocks, and add a case to `e2e/performance.spec.ts`. Load the bar on demand, with `import()`, so the main bundle doesn't grow.
- [ ] **Tests and checks:**
  - Tag the shared tests `@cross` so they run on WebKit.
  - The Mac app needs a check on the M4, as this adds keyboard shortcuts and menu items: Cmd+F and Cmd+Option+F in each view, from the menu and the keyboard, on a Spanish keyboard too.
  - Update both READMEs (feature list and Keyboard tables) in the same commit.

Mind the branches still waiting on 25 November, which change the Mac menus and `MENU_COMMANDS`: `desktop-window-frames`, then `desktop-reopen-setting`, then `desktop-open-recent`, merged in that order. Start from `main` once they're merged, or rebase onto it then.

## Smaller windows on the Mac

The window's smallest size was 768 by 560 points, wider than half of a MacBook Air's 1440-point screen, so a window tiled to half of it overlapped its neighbour. It's 560 by 420 now, on branch `desktop-window-frames`, and the layout test runs at that size.

- [ ] On the MacBook Air M1: tile full to the left half of the screen with another app on the right, and to the top and bottom halves. Neither overlaps, and tabs, status bar and both sides of a Markdown file stay usable.

## PDF in the Mac app, later

- In WKWebView, `window.print()` does nothing. Tauri 2 has `WebviewWindow::print()` (wry 0.57 runs an `NSPrintOperation` on macOS). Add a `print_page` command in [main.rs](src-tauri/src/main.rs) that calls it on the window that asked, and a "Print…" item with Cmd+P in the File section of [menu_table.rs](src-tauri/src/menu_table.rs).
- Check on the M4: that it uses the `@media print` styles; whether `beforeprint` and `afterprint` fire (if not, build `#print-root` before calling `print_page` and remove it when the call resolves, after finding out whether it resolves when the dialog opens or when it closes); that the PDF button's "Save as PDF" suggests the right name; and light and dark.
- Once that passes, set `canPrint` to true in `desktopHost`, add `export-pdf` to both menu lists, and record the results in the [audit](docs/desktop/repository-audit.md).

## Improvements to consider

- [ ] Consider: title each Mac window after its file in front, as every window is called "full" in the Window menu now.
- [ ] Consider: a more vibrant syntax highlighting theme, in the vein of Sublime Text's. The app is mostly for reading and analysing the contents of code files, not for coding for long hours, so stronger colours suit it better than a muted theme. The highlighting is set up in [SourcePane.ts](src/doc/SourcePane.ts).
- [ ] Consider: make reopening the last session a setting. When it's on, the app reopens the tabs left open, as it does now. When it's off, it goes back to how it behaved before v0.2.0: it shows a list of the files that weren't saved and can be restored. See [lastSession.ts](src/recovery/lastSession.ts) and [closing.ts](src/desktop/closing.ts).

## Not desktop

- [ ] Consider: add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
