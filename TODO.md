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
- [ ] **Shortcuts for the Markdown views.** "Split view", "Source only" and "Rendered only" are only in the palette today ([commands.ts:117](src/ui/commands.ts#L117)), with no keys. Give each one a shortcut that works on both sides of the pane, shown next to it in the palette.
  - Pick keys that the browsers and the Mac menu don't claim, and match them by `event.code` as for Alt+N, since Option plus a letter is a dead key or a symbol on macOS. Three neighbouring keys (for example Alt+1, 2 and 3) would be easy to remember. Check them on Chromium, Firefox, WebKit and the Mac app.
  - If HTML previews and the formatting bar are built, the same keys should switch HTML views too, and must not clash with the bar's shortcuts.
  - Add them to the Mac app's View menu, in English and Catalan.
  - **Tests:** e2e for each key from the source and the rendered side, on Chromium, Firefox, WebKit and the native project.
  - **Docs:** a row in the Keyboard table of both READMEs.
- [ ] **Zoom in and out in the Mac app.** On the website the browser's zoom (Cmd/Ctrl + and -) already scales everything, but the Mac app has no way to make text larger or smaller.
  - Cmd+=, Cmd+- and Cmd+0 for zoom in, zoom out and actual size, in the View menu in English and Catalan. Tauri's `zoomHotkeysEnabled` window option or the webview's `set_zoom` may do it with no code in the page; prefer that over restyling font sizes.
  - Remember the level across launches, like the theme. Check that the grid, the divider, the tab bar and the find panel still lay out correctly at each step, and that a large file doesn't pay for a zoom change with a long relayout.
  - Don't confuse it with the Window menu's existing "Zoom" item ([menu_table.rs:243](src-tauri/src/menu_table.rs#L243)), which is macOS's maximize.
  - The website keeps using the browser's zoom; don't add a second one there.
  - **Docs:** the shortcuts in the Keyboard table, noted as Mac app only, in both READMEs.
- [ ] **Export to other formats.** Write a copy of the open file in another format: Markdown to HTML or PDF, text and code to PDF, and CSV to XLSX. It keeps to the app's three promises: the original file is never touched (the export is a new file, and the tab stays on the original), nothing is uploaded, and there's no new interface beyond palette and menu commands. Minimalism and speed come first: if a step below can't meet them, raise it before building rather than relaxing them.
  - **Feasibility, assessed 12 November 2026:** doable with no new dependency. TXT to MD needs no code at all.
  - **Decided 12 November 2026:**
    - XLSX detects numbers, by the rules under "CSV to XLSX" below.
    - PDF ships on the website first. The Mac app gets it once printing is checked on the M4 (see "PDF in the Mac app, later"). HTML and XLSX ship on both from the start, since saving them needs nothing new natively.
  - **What exists to build on:**
    - `exportCopy(name, bytes)` in [host.ts](src/platform/host.ts) already writes a copy without rebinding the tab. On the website it downloads ([webHost.ts](src/platform/webHost.ts)). In the Mac app it opens the save panel and writes there ([desktop/host.ts](src/desktop/host.ts)).
    - The Mac save panel sets no type filter for a name outside the app's own types, so `notes.html`, `notes.pdf` and `data.xlsx` stay as typed (`save_panel_defaults` in [grants.rs](src-tauri/src/grants.rs)). Choosing a path in the panel counts as the user's yes (`offer_save_target` marks the grant confirmed), so writing a type the app doesn't open needs no second confirmation. Don't change the Rust side for HTML or XLSX.
    - Milkdown, with the commonmark and gfm presets, is already in the main bundle ([RenderedPane.ts](src/doc/RenderedPane.ts)), and so is ProseMirror's `DOMSerializer` (`@milkdown/kit/prose/model`).
    - `parseCsv` and `fieldValue` in [csv.ts](src/core/csv.ts), and the worker pattern in [csvParse.ts](src/core/csvParse.ts), which starts a worker with `new URL('./csvWorker.ts', import.meta.url)` and falls back to running inline.
    - `escapeHtml` and `toHtmlTable` in [clipboardTable.ts](src/core/clipboardTable.ts).
  - **TXT to MD:** already done by Save As. Saving under a `.md` name switches the tab to Markdown (`adoptTypeFromName` in [workspace.ts](src/doc/workspace.ts)). Plain text has nothing to convert, so don't add a command. Mention it in the README instead.
  - **Commands and names:**
    - Palette commands in the "File" group, only for the types they apply to:

      | id | English | Catalan | For |
      |---|---|---|---|
      | `export-html` | Export as HTML… | Exporta com a HTML… | Markdown |
      | `export-pdf` | Print or save as PDF… | Imprimeix o desa com a PDF… | Markdown, text and code, on the website only for now |
      | `export-xlsx` | Export as Excel (.xlsx)… | Exporta com a Excel (.xlsx)… | CSV |

    - Labels go in [strings.ts](src/strings.ts) and [strings.ca.ts](src/strings.ca.ts), with a notice after each export (for example "Exported notes.html" and "S'ha exportat notes.html") and the error messages below.
    - Add `export-html` and `export-xlsx` to `MENU_COMMANDS` in [desktop/menu.ts](src/desktop/menu.ts) and to the File section of [menu_table.rs](src-tauri/src/menu_table.rs), after Save As with a separator before. The unit test that compares the two lists has to keep passing. `export-pdf` stays out of the Mac menu until the Mac check is done.
    - A host flag, `canPrint`, true in `webHost` and false in `desktopHost` for now, decides whether `export-pdf` is built.
    - The suggested name is the file's name with its extension replaced: `notes.md` becomes `notes.html`, `data.csv` becomes `data.xlsx`, `untitled` becomes `untitled.html`, and a name with no extension gets one added.
    - Where the browser has `showSaveFilePicker` (Chrome, Edge), use `pickSaveTarget` and `write`, so the user picks a place and a name, and call `forgetSaveTarget` if writing fails, so no empty file is left behind. Elsewhere use `exportCopy`, which downloads. Never call `markSaved` and never change the tab's binding, name, type or dirty mark.
    - What's exported is the current text, unsaved changes included. Flush first: `doc.rendered?.flushEdit()` for Markdown edited on the rendered side, and commit a grid cell that's being edited, as Save does.
    - No export dialog, no options, no page setup beyond the system's. No other formats (DOCX, ODT, EPUB, CSV to JSON and so on) unless asked for.
  - **MD to HTML:**
    - One module, `src/export/html.ts`, loaded with `import()` on first use. It exposes `markdownToHtml(markdown, name): Promise<{ page: string; body: HTMLElement }>`, which HTML export and printing both use.
    - Parse `doc.markdownBody()` (without front matter, as the rendered side shows it) with Milkdown's parser. If the tab has a rendered pane, take its parser and its already-parsed document after `flushLoad()`. Otherwise make a headless `Editor` on a detached `<div>` with the same presets, created once and kept for the next export. For files over 100 KB, parse section by section as `parseSections` does, so a 1 MB file doesn't freeze the page.
    - Serialize with `DOMSerializer.fromSchema(schema).serializeFragment(doc.content)`. It uses the schema's `toDOM`, not the app's node views, so images come out as real `<img src>` with their original `src` and no placeholders, and no `contenteditable` or ProseMirror classes. Don't reuse "Copy rendered", which copies the live editor's `innerHTML` with all of those.
    - After serializing:
      - Task items: Milkdown writes `<li data-item-type="task" data-checked>`, and the app draws the box with CSS. Insert `<input type="checkbox" disabled>`, checked where it applies, at the start of each one, so the box survives being pasted into Word or opened without the stylesheet.
      - Raw HTML in the Markdown: the rendered side shows it as muted code (`span[data-type='html']`), never as HTML. Export it the same way, escaped inside `<code>`. That keeps the export what the user saw, and keeps scripts and event handlers out of it. Passing raw HTML through would need a sanitizer and is out of scope.
      - Links keep their `href` exactly as written, with no `target` or `rel` added. Headings keep the ids `syncHeadingIdPlugin` gives them, so in-page links work.
      - Code blocks stay `<pre><code>`, with the language as a `class="language-…"` and no colours.
    - The page, UTF-8 without a BOM, with LF line endings:
      - `<!doctype html>`, `<html>` with no `lang` (the document's language is unknown), `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, and the file name without its extension as `<title>`, escaped.
      - One inline `<style>` of about 40 lines, based on the `.md-rendered` rules in [styles.css](src/ui/styles.css): the system font stack, `max-width: 46rem` centred, tables with borders, code blocks, blockquotes and `img { max-width: 100% }`. `color-scheme: light dark` with system colours (`Canvas`, `CanvasText`, `LinkText`), so the page follows the reader's theme with no colour chosen by the app. No accent tone and no app name or link.
      - No `<script>`, no web fonts, no external stylesheet, no generator `<meta>`.
    - Images: relative ones work when the HTML is saved next to them. Remote ones keep their URLs, so a browser opening the exported file loads them. That happens outside the app, and the README says so.
  - **PDF (website first):**
    - Through the system print dialog, whose "Save as PDF" every browser offers. Writing PDFs in JavaScript (jsPDF, pdfmake) would add hundreds of KB and set type worse than the browser does, so don't.
    - Print a dedicated element, not the editors. CodeMirror only keeps the visible lines in the page, so printing the source pane would print one screenful. A `#print-root` `<div>` is built just before printing and removed after:
      - Markdown: the `body` from `markdownToHtml`. Images follow the tab's "Load remote images" choice, as on screen: data images print, and remote ones print only if they're allowed. Otherwise, and for relative images, print the same short placeholder text as the rendered side, so printing never makes a request the screen wouldn't.
      - Text and code: one `<pre>` with the whole text, plain monospace, wrapped (`white-space: pre-wrap; overflow-wrap: anywhere`), with no line numbers and no syntax colours.
    - A `@media print` block in [styles.css](src/ui/styles.css), a few lines in the main bundle: hide everything but `#print-root`, light colours whatever the theme or tone, `@page { margin: 18mm }` with the paper size left to the system, `break-inside: avoid` on images, table rows and code blocks, and `break-after: avoid` on headings.
    - Set `document.title` to the file name without its extension while printing, since Chrome and Safari use it as the PDF's name, and put it back afterwards.
    - `export-pdf` builds `#print-root` (asynchronously, for a large Markdown file), then calls `window.print()`, and cleans up on `afterprint`.
    - Cmd/Ctrl+P: catch it in the page's keydown handler and run `export-pdf`, and list it as the command's shortcut. If the browser's own File > Print is used instead, `beforeprint` can only work synchronously: build `#print-root` from the rendered pane's current document if there is one, and from the plain source text otherwise. Never print the app's interface.
    - CSV doesn't get a print command. XLSX covers it.
  - **PDF in the Mac app, later:**
    - In WKWebView, `window.print()` does nothing. Tauri 2 has `WebviewWindow::print()` (wry 0.57 runs an `NSPrintOperation` on macOS). Add a `print_page` command in [main.rs](src-tauri/src/main.rs) that calls it on the main window, and a "Print…" item with Cmd+P in the File section of [menu_table.rs](src-tauri/src/menu_table.rs).
    - Check on the M4: that it uses the `@media print` styles; whether `beforeprint` and `afterprint` fire (if not, build `#print-root` before calling `print_page` and remove it when the call resolves, after finding out whether it resolves when the dialog opens or when it closes); that the PDF button's "Save as PDF" suggests the right name; and light and dark.
    - Once that passes, set `canPrint` to true in `desktopHost`, add `export-pdf` to both menu lists, and record the results in the [audit](docs/desktop/repository-audit.md).
  - **CSV to XLSX:**
    - Runs on a worker, `src/export/xlsxWorker.ts`, started as `csvParse.ts` does, so 100,000 rows never block typing. It falls back to running inline (after an `import()`) only if the worker can't start. Send it `model.text()`, `model.delimiter`, whether the header row is on, the column widths and the sheet name. It parses the text again with `parseCsv`, which is cheaper than cloning 100,000 row objects. It sends back the file's bytes as a transferable `ArrayBuffer`.
    - Number detection, by column so that a column stays consistent:
      - A cell is numeric when its value (after `fieldValue`, so without quotes) matches `-?(0|[1-9]\d*)(D\d+)?` exactly, where `D` is the file's decimal mark, and has at most 15 significant digits. Excel loses precision after 15, which would change long IDs and card numbers.
      - The decimal mark is decided once per file: a comma if the delimiter isn't a comma, at least one value looks like `1,5`, and none looks like `1.5`. A dot otherwise.
      - A column becomes numeric only if every non-empty cell below the first row is numeric. Otherwise the whole column stays text. So a postcode column with `08001` stays text rather than mixing `8001` numbers and `08001` text.
      - The first row never counts in that check, unless it's numeric itself. With the header row on, it's the header. With it off, a text first row is still most likely a header the user only hid in the grid, and counting it would turn every column into text. It's written as text, above numbers if its column is numeric, which Excel handles. A numeric first row with the header row off is data, and counts like any other row. (Decided 12 November 2026.)
      - Always text: leading zeros (`007`, but `0` and `0.5` are numbers), a leading `+`, spaces around the value, thousands separators, currency signs, `%`, exponents (`1E5` is often a product code), dates, times and booleans. Dates stay text on purpose, since turning them into Excel dates means guessing the locale.
      - The header row, when it's on, is always text, even where a header cell looks like a number (`2025`).
      - Write numbers in the cell's `<v>` with a dot, from the original digits rather than through `Number()`, so no floating-point noise appears. Excel shows them in the reader's locale.
      - Trailing zeros: when every number in a column has the same number of decimals (`1.50`, `2.75`), give the column a number format with that many (`0.00`), so `1.50` still shows as `1.50`. Columns with mixed decimals use General, which shows `1.5`; the README says so.
    - Text cells:
      - Inline strings (`t="inlineStr"`), which means a value like `=SUM(A1)` is never treated as a formula, and the writer needs no shared string table. If one of the four apps below refuses inline strings, switch to `sharedStrings.xml`.
      - Escape `&`, `<` and `>`, and use `xml:space="preserve"` so spaces at either end survive.
      - Characters XML 1.0 can't hold (control characters other than tab, LF and CR) are written as `_xHHHH_`, and a literal `_xHHHH_` already in the text is escaped as `_x005F_xHHHH_`.
      - Line breaks inside a cell: CRLF and CR become LF, and those cells get a style with wrapping on, so Excel shows the breaks.
      - Empty cells are left out.
    - Limits: over 1,048,576 rows, 16,384 columns or 32,767 characters in one cell, Excel can't open the file. Refuse the export with a message naming the limit (and the cell, for the last), rather than truncating anything.
    - The sheet:
      - Named after the file without its extension: at most 31 characters, with `: \ / ? * [ ]` removed, no apostrophe at either end, and not "History". If nothing is left, use "Sheet1".
      - Column widths taken from `model.columnWidths`, converted from pixels to Excel's character units (roughly px / 7).
      - With the header row on: bold header, and the top row frozen (`<pane ySplit="1" topLeftCell="A2" state="frozen"/>`).
      - A `<dimension ref>` for the used range, and an `r` attribute on every row and cell, which some readers need.
    - The parts: `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/sheet1.xml` and `xl/styles.xml` (fonts, the wrap style, the bold header style and the decimal formats). No `docProps`, themes or calc chain.
    - The ZIP writer (`src/export/zip.ts`, about 100 lines): local headers, central directory and end record. CRC-32 with a 256-entry table, the export time as the DOS date, and version 2.0. Compress with `CompressionStream('deflate-raw')` (method 8) where it exists, which all supported browsers have, and store (method 0) otherwise. No ZIP64, which the row limit makes unnecessary.
    - Memory: build the sheet XML in chunks of a few thousand rows, encoded to `Uint8Array`s and fed through the compression stream, never as one string. 100,000 rows of ten columns is tens of MB of XML.
  - **Errors:** a failed export shows the usual error notice and changes nothing in the tab. A cancelled picker or panel does nothing at all.
  - **Keeping it snappy:**
    - `src/export/html.ts`, the XLSX worker and the ZIP writer load only when an export runs. The `@media print` CSS and the Cmd/Ctrl+P handler are the only additions to the main bundle. Compare `dist/assets` before and after.
    - The headless Milkdown editor is made only on the first HTML export or print from a tab without a rendered pane.
  - **Tests:**
    - Unit (`tests/unit/export.test.ts`, Node environment):
      - The number rules, as a table: `0`, `-3`, `1.5`, `1,5` in each mode, `007`, `+1`, `1 000`, `1.000,50`, `1E5`, 16 digits, `12%` and `€5`.
      - The column rule: one text cell below the first row keeps the column text. A text first row doesn't, with the header row on or off. A numeric first row with the header row off counts.
      - The decimal mark choice per delimiter.
      - Trailing-zero formats.
      - XML escaping and `_xHHHH_`.
      - Sheet names.
      - Pixels to character widths.
      - The ZIP, read back with `DecompressionStream` and a check of each CRC.
    - e2e, run on Chromium, Firefox, WebKit and the native project (PDF on the first three only):
      - After each export, the original is byte-identical, and the tab keeps its name, binding, type and dirty mark.
      - The HTML has no `<script>`, no `on…` attribute and no `contenteditable`; raw HTML comes out escaped; task boxes are there; and opening it makes no request when it has no remote images.
      - Printing hides the interface and contains the whole of a long file, not one screenful. Printing makes no request with "Load remote images" off (add this to [privacy.spec.ts](e2e/privacy.spec.ts)).
      - An XLSX of a 100,000-row CSV unzips, has the right number of rows, and has the expected numeric and text columns.
      - Picker cancelled, write failed, and download where there's no picker.
    - `test:perf`: export the 100,000-row CSV while typing in a Markdown tab. Typing stays within the usual limits (median under 50 ms, p95 under 100 ms), and the export finishes in under 5 s on Chromium. Startup is unchanged.
    - Manual:
      - Open the XLSX fixture (quotes, line breaks in cells, leading zeros, comma and dot decimals, non-Latin text, a 100,000-row file) in Excel for Mac, Numbers, LibreOffice and Google Sheets, with no "repair" prompt in any of them.
      - Print to PDF from Markdown, text and code in Chrome, Firefox and Safari, light and dark, and with each tone.
      - Export HTML and XLSX in the Mac app through the save panel.
      - Record each result in the README's manual checks table.
  - **Docs:**
    - Both READMEs:
      - A line in "What it does".
      - Known limitations: how numbers are detected and that dates stay text, mixed decimals showing as General, PDF coming from the print dialog (and not yet in the Mac app), raw HTML exported as text, and remote images keeping their URLs in exported HTML.
      - The Save As tip for TXT to MD.
      - Cmd/Ctrl+P in the Keyboard table, noted as website only for now.
    - A screenshot only if the export earns one.
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

Done, and recorded in the [README](README.md#tests-and-manual-checks). All of these needed a real browser:

- [x] Overwrite after permission, in Chrome or Edge.
- [x] Drop keeps its handle, in Chrome or Edge.
- [x] Paste into and from Excel, Google Sheets and Word.
- [x] The main flow in real Safari.

And one to consider:

- [ ] Add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
