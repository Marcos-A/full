# TODO

Concrete next steps. The [roadmap](ROADMAP.md) has the goals, order and reasons. This file only details the current milestone, so tasks for each milestone get added when the one before is nearly done. Delete tasks once they're done and their result is recorded.

## Where things stand

Last updated 14 November 2026.

- **Done:** M1 is live on the website. The M0 spike is finished, and the [audit](docs/desktop/repository-audit.md#m0-spike-results) has its results. M2, the committed shell, is on `main`, with its [results](docs/desktop/repository-audit.md#m2-shell-results) in the audit too. M3, open, is finished, with its [results](docs/desktop/repository-audit.md#m3-open-results) there as well. M4, save, is finished, with its [results](docs/desktop/repository-audit.md#m4-save-results) there too. M5, close, quit and recovery, is finished, with its [results](docs/desktop/repository-audit.md#m5-close-results) there as well. M6, Finder and packaging, is finished, with its [results](docs/desktop/repository-audit.md#m6-finder-and-packaging-results) there too.
- **Released:** [v0.1.0](https://github.com/Marcos-A/full/releases/tag/v0.1.0), the first public download of the Mac app, on 11 November 2026. It's ad hoc signed, published as an immutable release with a build attestation, and was checked on the M4 by following the README as a new user would. The website shows the version too.
- **Next:** nothing planned for the Mac app. Signing and notarization, the rest of M7, stay postponed.
- **On `main` and the website, not yet in a public Mac release:** the find panel restyle, the view keys, Mac zoom, exports (HTML, XLSX, PDF on the website), HTML previews, Markdown formatting keys and bar, reopening the last session, and the searchable shortcut list (Alt+K). v0.1.0 is still the latest public version. Mac test builds are published as pre-releases named `mac-<commit>`. Their specs and the decisions taken while building them are in git history (TODO.md at `0643699`).

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

## Next Mac test build

What testing `mac-0643699` and `mac-eb6d385` on the M4 found, and what's still to check.

- [ ] **Links in an HTML preview don't open in the Mac app** (`mac-0a00cb7`). Markdown links work. In WebKit a preview link is rewritten to `about:blank#full-link=…`. Right-click > Open Link was refused by the navigation guard as an `about` page, though the guard accepts that address in its unit test, so macOS must report it in another form. Open Link in New Window reached the new-window handler, which didn't know rewritten links; it now opens them (a new-window request only ever comes from the user). The next build logs the full `about:` address of each refused or allowed preview link (`that page was …`, `a preview link went to …`). Fix the guard for the form it shows. Don't loosen it blindly: the guard can't tell the preview frame from the app's own window, and a blank page must never replace the app.
- [ ] Check on the M4: Cmd+= (Cmd+Shift+0 on a Spanish keyboard) and Cmd++ zoom in step by step, past actual size, and the level is remembered across launches; Cmd+click on a link no longer selects the paragraph; the shortcut list opens with Alt+K, with `?` in the palette and from Help > Keyboard Shortcuts. Then the checks left from `0643699`, with `FULL_TIMINGS`: zoom in a large CSV and a split Markdown file; HTML preview renders and its links open; Export as HTML and Excel through the save panel; Cmd+Option+1 to 3 and Alt+B in the View menu; quitting with unsaved work by every route, then relaunching; Force Quit still goes to the recovery list. Record them in the README's manual checks.
- [ ] Open XLSX exports, including comma decimals in a quoted comma-separated file and grouped thousands, in Excel for Mac, Numbers, LibreOffice and Google Sheets, with no repair prompt. Print to PDF in Chrome, Firefox and Safari, light and dark.
- [ ] Consider: reopened files on the Mac ask for the restored-file confirmation on their first save, as restored files always have. With quitting no longer asking, that may be met more often.

## Make the formatting bar more elegant

The bar (Alt+B, [formatBar.ts](src/ui/formatBar.ts), `.format-bar` in [styles.css](src/ui/styles.css)) works but looks plain: nine text glyphs (`B`, `I`, `` ` ``, `{ }`, `H`, `•`, `1.`, `“`, `[ ]`) in a 28 px strip. Make it look as considered as the rest of the app, in both themes and every tone, without giving up what made it cheap.

- [ ] Look: consistent glyph sizes and weights (B bold, I italic, code in the monospace font), even button widths, quiet hover and pressed states with the accent tone only on focus and hover, small separators between the inline, block and list groups, and alignment with the tab bar above. Consider simple inline SVG icons drawn in `currentColor` if text glyphs can't look right, but no icon font, images or extra requests.
- [ ] Keep: hidden by default, plain DOM built once and loaded with import(), one row that scrolls sideways when narrow, tooltips with the action and its shortcut, `role="toolbar"` with arrow keys, and the axe checks.
- [ ] Check it light and dark, with each tone, on the website and in the Mac app, and that typing in a 1 MB Markdown file with the bar shown still meets the `test:perf` limits.

## PDF in the Mac app, later

- In WKWebView, `window.print()` does nothing. Tauri 2 has `WebviewWindow::print()` (wry 0.57 runs an `NSPrintOperation` on macOS). Add a `print_page` command in [main.rs](src-tauri/src/main.rs) that calls it on the main window, and a "Print…" item with Cmd+P in the File section of [menu_table.rs](src-tauri/src/menu_table.rs).
- Check on the M4: that it uses the `@media print` styles; whether `beforeprint` and `afterprint` fire (if not, build `#print-root` before calling `print_page` and remove it when the call resolves, after finding out whether it resolves when the dialog opens or when it closes); that the PDF button's "Save as PDF" suggests the right name; and light and dark.
- Once that passes, set `canPrint` to true in `desktopHost`, add `export-pdf` to both menu lists, and record the results in the [audit](docs/desktop/repository-audit.md).

## Not desktop

- [ ] Consider: add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
