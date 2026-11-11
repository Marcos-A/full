# TODO

Concrete next steps. The [roadmap](ROADMAP.md) has the goals, order and reasons. This file only details the current milestone, so tasks for each milestone get added when the one before is nearly done. Delete tasks once they're done and their result is recorded.

## Where things stand

Last updated 11 November 2026.

- **Done:** M1 is live on the website. The M0 spike is finished, and the [audit](docs/desktop/repository-audit.md#m0-spike-results) has its results. M2, the committed shell, is on `main`, with its [results](docs/desktop/repository-audit.md#m2-shell-results) in the audit too. M3, open, is finished, with its [results](docs/desktop/repository-audit.md#m3-open-results) there as well. M4, save, is finished, with its [results](docs/desktop/repository-audit.md#m4-save-results) there too. M5, close, quit and recovery, is finished, with its [results](docs/desktop/repository-audit.md#m5-close-results) there as well. M6, Finder and packaging, is finished, with its [results](docs/desktop/repository-audit.md#m6-finder-and-packaging-results) there too.
- **Released:** [v0.1.0](https://github.com/Marcos-A/full/releases/tag/v0.1.0), the first public download of the Mac app, on 11 November 2026. It's ad hoc signed, published as an immutable release with a build attestation, and was checked on the M4 by following the README as a new user would. The website shows the version too.
- **Next:** nothing planned for the Mac app. Signing and notarization, the rest of M7, stay postponed.

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

## For a future release

- [ ] **Restyle the find and replace panel** in the source editor (Cmd+F). In dark mode its buttons are light grey with faint text and can't be read. It happens on the website and in the Mac app alike (seen with v0.1.0). It's CodeMirror's stock search panel: [SourcePane.ts](src/doc/SourcePane.ts) only sets the panel's background, text colour and font, so the buttons, fields and checkboxes keep CodeMirror's light-theme look. Make it follow the app's design in both themes, with the accent tone for focus and checked states. While at it, its labels ("next", "previous", "all", "match case", "regexp", "by word", "replace", "replace all") are fixed lowercase English: give them proper wording and a Catalan version through CodeMirror's `phrases`. Check it on the website and in the Mac app, light and dark.
- [ ] **Preview HTML files.** A read-only preview of `.html` and `.htm` files, using the split, source and rendered views Markdown already has. Minimalism and speed come first: if a step below can't meet them, raise it before building rather than relaxing them.
  - **What it is:** the browser renders the file in a sandboxed `<iframe srcdoc>`. It needs no new dependency and no HTML parser. The preview can't be edited, so there is no round trip from the rendered page to the source, no reformatting warning, and the byte-for-byte promise holds untouched.
  - **Keeping it minimal:**
    - No new interface. The palette's existing "Split view", "Source only" and "Rendered only" commands and "Load remote images" apply to HTML files too. There's no new button, panel, setting or status bar item.
    - No extras: no device widths, zoom, reload button, console, element inspector, "open in browser" or print. It's a quiet look at the file, not a browser.
    - The frame has no border, shadow or caption. It sits where the Markdown rendered side does, with the same divider.
    - The page looks as the file asks: white by default, even in dark mode. Don't inject colours or fonts, because a preview that restyles the page would mislead. If the white panel in dark mode feels too harsh in practice, decide on it then, not up front.
    - No new strings beyond what the limits below need, in English and Catalan.
  - **Keeping it snappy:**
    - Load the preview code with `import()` on first use, like the syntax grammars in [syntax.ts](src/doc/syntax.ts), so the main bundle stays the same size. Check this against `dist/assets` before and after.
    - Create the iframe only while the preview is visible and the tab is active. Remove it in source-only view and in background tabs, as the Markdown rendered side already defers loading until it's visible. At most one preview frame exists at a time.
    - Update only after typing pauses (`RENDER_DEBOUNCE_MS`, 150 ms), never on every keystroke, and never while an update is still being laid out. If several edits arrive during one update, render only the latest text.
    - Measure each update. If one takes longer than a frame budget (say 50 ms), lengthen the wait before the next one in proportion. Above a size limit (start from `MAX_HIGHLIGHT_CHARS`, 1 MB), stop live updates: show the preview as it was at open or save, with a short note saying so. Typing must never pay for the preview.
    - Chrome may give a sandboxed iframe its own process. Measure the time and memory of the first preview there, in Firefox, in WebKit and in the Mac app before choosing the default view.
    - Keep scroll position by reading `scrollTop` before replacing `srcdoc` and restoring it on `load`. Don't sync scrolling between source and preview: it needs a scan of the source for every scroll and isn't worth the cost.
  - **Safety and privacy:**
    - Never give the iframe `allow-scripts`, so nothing in the file runs and it can't reach the recovery data in IndexedDB. `allow-same-origin` on its own is fine, and lets the app catch link clicks (sending them through `classifyLink` and the host, as Markdown does) and read the scroll position. No `allow-popups`, `allow-forms` or `allow-top-navigation`.
    - An iframe built with `srcdoc` inherits the app's CSP, which allows `img-src https:`. So make a strict `<meta http-equiv="Content-Security-Policy">` the page's first element: `default-src 'none'; style-src 'unsafe-inline'; img-src data:`, with `https:` added only after "Load remote images". A second policy can only tighten, so the file can't undo it. Remote images, CSS `url()`s, `@import`s and fonts then stay blocked, as they are for Markdown.
  - **Limits to state in the README:** pages built by JavaScript appear empty. Stylesheets and images next to the file don't load, the same limit as Markdown's "Image not available". Over the size limit the preview doesn't follow typing.
  - **Tests:**
    - e2e: scripts and inline event handlers don't run; the privacy test passes with remote images, stylesheets and fonts in the file, and with "Load remote images" on; links open as they do for Markdown; opening, previewing and saving leaves the file byte-identical; the preview follows edits and keeps its scroll position.
    - Run them on Chromium, Firefox, WebKit and the native project.
    - `test:perf`: add "typing in a 1 MB HTML file with the preview open" with the same limits as Markdown (median under 50 ms, p95 under 100 ms), and check that opening and typing in other files don't change.
    - Check it in the Mac app with `FULL_TIMINGS`.
  - **Docs:** a line in "What it does" and the known limits in both READMEs, and a screenshot only if the preview earns one.
  - **To decide:** the default view for HTML files. Source only is suggested, since HTML is code and people mostly open it to edit it, which also means no frame is created until it's asked for.
  - **Later, maybe:** SVG previews could share almost all of the same code.
- [ ] **Markdown formatting bar.** A thin bar of basic Markdown formatting, hidden by default and shown or hidden with a shortcut. The keyboard shortcuts for each action are the heart of it, and the bar is a visible way to find them. Minimalism and speed come first: if a step below can't meet them, raise it before building rather than relaxing them.
  - **Actions:** bold, italic, inline code, code block, heading (repeated presses cycle H1, H2, H3 and back to text), bullet list, numbered list, quote and link. Nine in all. No tables, images, strikethrough, task lists, colours or alignment. Anything more goes in the palette, not the bar.
  - **How they edit:**
    - On the source side, each action is one small CodeMirror transaction: wrap in `**`, add `- ` to the start of each selected line, and so on. Everything else stays byte for byte, and undo and redo work as for typing.
    - Each one toggles: bold on `**text**` unwraps it. With nothing selected, it inserts the markers and puts the cursor between them. With several lines selected, line actions apply to each line.
    - Follow the markers the file already uses (`_` or `*` for italics, `-` or `*` for bullets, `` ``` `` or `~~~` for fences). Find them by reading only the lines near the cursor when the action runs, not by scanning the file.
    - On the rendered side, use Milkdown's existing commands. They pass through the reformatting warning as any rendered edit does.
  - **Keeping it minimal:**
    - Hidden by default, so a new user sees exactly what they see today. Reword "There are no toolbars" in both READMEs, for example to "no toolbars unless you ask for one".
    - Plain text symbols in the system font (**B**, *I*, `` ` ``, `{ }`, `H`, `•`, `1.`, `"`, `[ ]` or similar; no emoji, which draw in colour), with no icon set, images or web fonts. Quiet tones, with the accent tone only on focus and hover.
    - One row, as thin as the tab bar, between the tabs and the panes. It takes space from the panes rather than covering text. No dropdowns, separators or overflow menu. On a narrow window it scrolls sideways instead of wrapping.
    - Tooltips name the action and its shortcut, nothing more.
    - Only one setting: whether the bar is shown, remembered across launches like the theme, for all Markdown files. The bar doesn't appear for CSV, text or code files, and the toggle shortcut does nothing there.
  - **Keeping it snappy:**
    - The bar's code loads with `import()` the first time it's shown, so the main bundle and startup don't change while it's hidden. The formatting shortcuts are a small keymap added only to Markdown source editors. Compare `dist/assets` before and after.
    - Build the bar once, as plain DOM. Don't re-render it with React on edits.
    - Don't track the cursor while typing. The bar shows no "active" state (bold lit up inside bold text) at first. If it's added later: only while the bar is shown, read the syntax tree at the cursor only, and only after the selection settles (one `requestAnimationFrame`), never on every keystroke.
    - Actions read only the lines they change. They never serialize or scan the whole document on the source side.
    - Showing or hiding the bar changes the panes' height once. Check that it doesn't make CodeMirror or Milkdown measure or redraw the whole document in large files.
  - **Shortcuts:**
    - Actions: Cmd/Ctrl+B and I; Cmd/Ctrl+E for inline code; Cmd/Ctrl+Shift+7, 8 and 9 for numbered list, bullets and quote; Cmd/Ctrl+K is the palette, so the link needs another key.
    - The source side has no Markdown keymap today ([SourcePane.ts:130](src/doc/SourcePane.ts#L130)), and the rendered side's keys come from Milkdown's preset. Both sides should answer to the same keys.
    - Bar toggle: Alt plus a letter matched by `event.code`, as for Alt+N in [commands.ts](src/ui/commands.ts), such as Alt+B. Check every shortcut on Chromium, Firefox, WebKit and the Mac app, where the browser or the menu may claim it (Firefox uses Ctrl+B for bookmarks).
    - Put every action and the toggle in the palette, and the toggle in the Mac app's View menu.
  - **Accessibility:** `role="toolbar"` with one Tab stop and arrow keys inside it, labels in English and Catalan, and the axe checks passing.
  - **Tests:**
    - e2e: each action, toggling, empty selection, several lines and existing markers; everything outside the change stays byte-identical; one undo restores the exact previous text; rendered-side actions show the warning first; the bar's visibility is remembered.
    - Run them on Chromium, Firefox, WebKit and the native project.
    - `test:perf`: the existing 1 MB Markdown typing test with the bar shown, at the same limits, and startup with it hidden unchanged.
    - Check it in the Mac app with `FULL_TIMINGS`.
  - **Docs:** the shortcuts in the Keyboard table, a line in "What it does", and the reworded "no toolbars" promise in both READMEs. Retake the Markdown screenshots only if the bar appears in them, which it shouldn't if it's hidden by default.
  - **To decide:** whether the shortcuts ship first, by themselves, with the bar following only if they aren't enough. That's the more minimal path.
- [ ] **Reopen the last session as it was left**, as Sublime Text does. Closing the window or quitting with files open, saved or not, named or untitled, should bring them all back at the next launch: the same tabs, in the same order, with the same one active, without going through the recovery list. Minimalism and speed come first: if a step below can't meet them, raise it before building rather than relaxing them.
  - **What exists today:** every open file already has a full record in IndexedDB ([store.ts](src/recovery/store.ts)) with its current text, last saved text, original bytes, encoding, file handle or native path, and it's kept up to date while typing. When a page goes away, its records become "abandoned" and are offered in the recovery list (up to `MAX_RECOVERY_ENTRIES`, 10), which the user restores one by one or all at once. So the content is already safe. What's missing is tab order, which tab was active, each tab's state, and restoring without being asked.
  - **What to add:**
    - A small session record per page: the ordered list of record ids, the active one, and for each tab its view (split, source or rendered, grid or raw), cursor and selection, scroll position, divider position and word wrap. Write it only when one of these changes, debounced, and on `pagehide`, never on every keystroke or scroll event.
    - At launch, if the most recently closed session is abandoned, claim its records with the existing `claimRecord` (so two pages opening at once can't both take them) and reopen its tabs in order, with the active one shown and its cursor and scroll put back.
    - Anything else abandoned (older sessions, other browser tabs, crashes) stays in the recovery list as today.
    - Untitled files come back untitled, with their text. Unsaved changes come back unsaved, with the dirty mark. Undo history doesn't survive, as the README already says for restores.
  - **Keeping it minimal:**
    - No new screen, dialog or banner when restoring the last session: the app simply opens as it was left. The recovery list stays only for what isn't the last session.
    - At most one setting: "Reopen files from last time", on by default. Whether it exists at all is not decided yet (see "To decide" below).
    - No session names, saved workspaces, project folders or history. One session, the last one.
  - **Keeping it snappy:**
    - Show the active tab first, and as fast as a normal launch shows the start screen. Read only the session record and the active tab's record before the first paint. Today `refreshRecovery` calls `allRecords()`, which loads every record's text and original bytes; for ten large files that's tens of megabytes before anything is shown. Read single records by id, and add a light index (names, kinds, sizes, dirty flags) if the tab bar needs it before the content.
    - Other tabs appear in the tab bar straight away, but their content is read and their editor built only when first selected, or during idle time after launch (`requestIdleCallback`), one at a time.
    - Restore cursor and scroll in the same frame the editor appears, with no visible jump, and without measuring the whole document.
    - A CSV of 100,000 rows still parses on the worker, and only when its tab is shown.
    - `test:perf`: launch with ten restored tabs (one of them a 100,000-row CSV and one a 1 MB Markdown file) must reach an editable active tab within the current open limits, and typing in it must meet the usual limits while the others load. Check the Mac app's launch time with `FULL_TIMINGS` against the M6 budgets.
  - **Files that changed on disk:** a restored file whose disk copy changed since it was closed (`fileLastModified`, or a different size) must not be overwritten silently. Without unsaved changes, reload it from disk. With unsaved changes, keep them and mark the tab, using the same quiet treatment as deleted files rather than a dialog at launch. A file deleted meanwhile follows the existing deleted-file behaviour.
  - **Closing and quitting (decided 11 November 2026):**
    - In the Mac app, Cmd+Q, Dock Quit, closing the window and logout stop asking about unsaved files, as Sublime does with hot exit, since nothing is lost. Before quitting, wait for the recovery store to have everything typed so far, as the close flow already does, so quitting never loses the last keystrokes. Closing a single tab (Alt+W) still asks, because that really discards the changes. "Revert" and closing a tab stay the only ways to throw changes away.
    - The website keeps its `beforeunload` warning for unsaved changes. Browser storage can be cleared, and Safari deletes it after seven days without a visit, so the website can't promise as much as the Mac app. Ask for `navigator.storage.persist()` where it's offered.
  - **Privacy:** reopening by itself shows the last files to whoever opens the app next, which matters on a shared computer. The README's note about recovery data on shared computers needs to say so, and "Clear all recovery data" must also clear the session record.
  - **Several browser tabs:** each page is its own session. Restore the most recently closed one into the next page that opens, and leave the others in the recovery list. A second page opened while the first is still open starts empty, as today.
  - **Tests:**
    - e2e: close and reopen with saved, unsaved and untitled files, CSV, Markdown and text, in a given order with a given tab active; check order, active tab, dirty marks, view, cursor and scroll, and that every file is byte-identical. A file changed or deleted on disk in between. Two pages reopening at once claim each record only once. The recovery list still shows older sessions.
    - Run them on Chromium, Firefox, WebKit and the native project, and on the Mac: Cmd+Q, Dock Quit, closing the window and logout with unsaved files (no question, everything back at the next launch), Alt+W (still asks), Force Quit, and installing a new version over the old one. Update the README's "Mac app close and quit" manual check to match.
  - **Docs:** rewrite the Recovery line in both READMEs, the Mac app's note that closing and quitting ask about unsaved files (they no longer will), and the shared-computer note.
  - **To decide (still open):** whether reopening the last session needs a setting to turn it off. Not decided yet: ask before building.

## Not desktop

Already open, and tracked in the [README](README.md#tests-and-manual-checks). All of these need a real browser:

- [ ] Overwrite after permission, in Chrome or Edge. Do this one first: M1 moved this code, and so far only tests with stubbed file pickers have covered the move.
- [ ] Drop keeps its handle, in Chrome or Edge.
- [ ] Paste into and from Excel, Google Sheets and Word.
- [ ] The main flow in real Safari.

And one to consider:

- [ ] Add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
