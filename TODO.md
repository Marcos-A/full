# TODO

Concrete next steps. The [roadmap](ROADMAP.md) has the goals, order and reasons. This file only details the current milestone, so tasks for each milestone get added when the one before is nearly done. Delete tasks once they're done and their result is recorded.

## Where things stand

Last updated 14 November 2026.

- **Done:** M1 is live on the website. The M0 spike is finished, and the [audit](docs/desktop/repository-audit.md#m0-spike-results) has its results. M2, the committed shell, is on `main`, with its [results](docs/desktop/repository-audit.md#m2-shell-results) in the audit too. M3, open, is finished, with its [results](docs/desktop/repository-audit.md#m3-open-results) there as well. M4, save, is finished, with its [results](docs/desktop/repository-audit.md#m4-save-results) there too. M5, close, quit and recovery, is finished, with its [results](docs/desktop/repository-audit.md#m5-close-results) there as well. M6, Finder and packaging, is finished, with its [results](docs/desktop/repository-audit.md#m6-finder-and-packaging-results) there too.
- **Released:** [v0.2.0](https://github.com/Marcos-A/full/releases/tag/v0.2.0) on 14 November 2026, with the find panel restyle, the view keys, Mac zoom, exports, HTML previews, Markdown formatting keys and bar, reopening the last session, and the searchable shortcut list. Its notes are in [docs/releases](docs/releases/v0.2.0.md). [v0.1.0](https://github.com/Marcos-A/full/releases/tag/v0.1.0), the first public download, came out on 11 November 2026. Both are ad hoc signed and published as immutable releases with a build attestation. The website shows the version too.
- **Next:** nothing planned for the Mac app. Signing and notarization, the rest of M7, stay postponed.
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

## Line numbers and split editor on the Mac

Alt+L and View › Line Numbers show or hide line numbers in every source pane, remembered between sessions. Alt+S and View › Split Editor show a second editor of the same file beside the first, remembered per tab. The web suite passes on WebKit and the native fake for both.

- [ ] On the M4: Option+L and the menu item both toggle them, and the item's check follows. With the HTML preview focused, the menu takes Option+L. In a table cell, where the item is off, Option+L still types `¬`, and also on a Spanish keyboard.
- [ ] On the M4: Option+S and View › Split Editor split and join the editor, and the item's check follows. Typing, undo and Cmd+F work in both editors, and in a table cell Option+S still types its character (`ß` on a US keyboard), also on a Spanish keyboard. In Markdown and HTML the second editor replaces the rendered side, and Cmd+Option+1 brings it back.

## Multiple windows on the Mac

On branch `desktop-windows`: dragging a tab out of the window, or Window › Move Tab to New Window, gives the file a window of its own, with its unsaved changes, its view and its grant (undo history stays behind). File › New Window (Cmd+Shift+N) opens an empty one. Closing one window of several asks about its unsaved files, as closing each would. Quitting asks nothing and every window comes back at the next launch, the others behind the front one. Rust: `pages.rs` (each window's page, and which is in front), `closing.rs` (quitting asks every page), `windows.rs` (building windows, and what each page is told). Web: windows take over a session reserved for them, see `reserveSession` in [lastSession.ts](src/recovery/lastSession.ts). A grant never goes into storage, only through `open_window`, which checks that this run issued it. Mac clippy and the Rust tests pass here, and the web suite passes with the fake host, whose windows are popup pages.

The fake host's pages share storage, locks and messages the way one browser's do. Whether separate windows of the real app share them too is the one thing that can't be seen here, so the first checks are about that.

- [ ] On the M4, with a test build: move a tab with unsaved changes to a new window, then check that neither window lists it for recovery (they share IndexedDB and Web Locks), and that saving it in its new window asks nothing.
- [ ] Drag a tab out of the window: the new window opens near the pointer, and a short drag is still a click. This depends on WebKit sending the release outside the window to the page.
- [ ] Quit with three windows, one of them with an unsaved file, by Cmd+Q, the Dock and the last red button: nothing is asked, and the next launch brings back all three with the same front window.
- [ ] Close one window of several by its red button, and by Cmd+W with no file: it asks about unsaved files, and Cancel keeps the window open.
- [ ] Switching windows switches the menu's checks and items. Cmd+W, menu commands and Finder's files go to the front window, and a dropped file to the window it's dropped on. The Open and Save panels, and the native confirmations, attach to the window that asked.
- [ ] New Window cascades from the front one. Zoom applies to each window on its own.
- [ ] Not done yet: windows are all titled "full" in the Window menu, and window positions and sizes aren't restored (see "Window state restore" in the [roadmap](ROADMAP.md#later)).

## PDF in the Mac app, later

- In WKWebView, `window.print()` does nothing. Tauri 2 has `WebviewWindow::print()` (wry 0.57 runs an `NSPrintOperation` on macOS). Add a `print_page` command in [main.rs](src-tauri/src/main.rs) that calls it on the main window, and a "Print…" item with Cmd+P in the File section of [menu_table.rs](src-tauri/src/menu_table.rs).
- Check on the M4: that it uses the `@media print` styles; whether `beforeprint` and `afterprint` fire (if not, build `#print-root` before calling `print_page` and remove it when the call resolves, after finding out whether it resolves when the dialog opens or when it closes); that the PDF button's "Save as PDF" suggests the right name; and light and dark.
- Once that passes, set `canPrint` to true in `desktopHost`, add `export-pdf` to both menu lists, and record the results in the [audit](docs/desktop/repository-audit.md).

## Improvements to consider

- [ ] Consider: a more vibrant syntax highlighting theme, in the vein of Sublime Text's. The app is mostly for reading and analysing the contents of code files, not for coding for long hours, so stronger colours suit it better than a muted theme. The highlighting is set up in [SourcePane.ts](src/doc/SourcePane.ts).
- [ ] Consider: make reopening the last session a setting. When it's on, the app reopens the tabs left open, as it does now. When it's off, it goes back to how it behaved before v0.2.0: it shows a list of the files that weren't saved and can be restored. See [lastSession.ts](src/recovery/lastSession.ts) and [closing.ts](src/desktop/closing.ts).

## Not desktop

- [ ] Consider: add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
