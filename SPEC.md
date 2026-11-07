# Folio: Build Specification

## 1. Summary

Build **Folio**, a browser-based app for opening, viewing, editing and saving `.csv` and Markdown files. Use `folio` as the project and package name, and "Folio" as the name shown in the UI and page title. **This is a working name that may change**, so keep the display name in one place. The user drops a file onto the page, sees it rendered, copies from it, edits it and saves it. If the browser or tab closes before a file has been closed in the app, that file is offered for recovery at the next launch.

The app is a **static site with no backend**, built and hosted on the owner's remote server. File contents stay in the user's browser and are never sent to the server.

**The guiding rule is to never change what the user did not change.** Opening, viewing and saving a file must not alter any of its content, apart from the narrow exceptions stated in this spec.

## 2. Scope

### In scope
- File types: `.csv`, `.md`, `.markdown` (extensions are case-insensitive)
- Opening by drag and drop or with an "Open file" button; multiple files can be open as in-app tabs
- Rendering, copying, editing and saving
- Recovery of up to 10 abruptly closed files

### Out of scope
- User accounts, cloud sync, collaboration or any server-side storage of file contents
- Creating new blank files
- Formula evaluation, charts, sorting that rewrites the file, or `.xlsx` support
- Resolving relative image paths in Markdown (show a clear placeholder instead)

## 3. Technical stack

Use the current stable versions and commit the lockfile. A library may be replaced only if the replacement meets the same acceptance criteria.

| Concern | Choice |
|---|---|
| Build and language | Vite, TypeScript (strict) |
| UI | React |
| Markdown source editor | CodeMirror 6 |
| Markdown rendered editor | Milkdown (ProseMirror and remark), with GFM |
| CSV parsing | Small custom tokenizer that records each field's raw text (see 6.2) |
| CSV table | Custom grid with TanStack Virtual |
| Local persistence | IndexedDB through `idb` |
| Tests | Vitest and Playwright |

All dependencies must be bundled and served from the app's own origin. Do not load anything from a CDN at runtime.

## 4. Deployment on the remote server

The agent builds on the remote server and must inspect it first (OS, Node version, existing web server or reverse proxy, ports in use).

**Requirements**
- Host the app at the root of a subdomain matching the project name, currently `folio.<owner's domain>`.
- Serve the production build as static files using the server's existing web server if it has one.
- **HTTPS is required.** Saving over the original file, Web Locks and the async clipboard API work only in a secure context. Plain HTTP on a remote host will break these features.
- Cache hashed assets long-term. Serve `index.html` with `Cache-Control: no-cache`.
- Send these headers:
  ```
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  ```
- Keep the production origin stable. Recovery data belongs to the origin, so changing domain, subdomain or port leaves it behind.

**Safety on the server**
- Do not change DNS records, existing sites, firewall rules or TLS configuration without the owner's approval.
- Provide `README.md` with the build, deploy, update and rollback steps.

**Ask the owner before deploying**
1. Is "Folio" the final name? Which parent domain should the subdomain use, and does its DNS record already point to this server? Settle the name before deploying, because changing the subdomain later leaves recovery data behind.
2. Is HTTPS already available for that subdomain, and if not, how should it be set up?
3. Should the URL be public or protected at the web-server level (for example, basic auth or VPN only)? The app has no login of its own.

Development and testing can continue while these answers are pending. Use an SSH tunnel to `localhost` to test in a secure context.

## 5. Layout and interaction

### Design direction

Folio should feel like a minimal, elegant code editor in the spirit of Sublime Text: quiet, fast and focused on the content. Take inspiration from that style only, and do not copy Sublime Text's name, logo, icons or themes.

- **Content first:** the file fills the window. Interface elements stay slim, with no cards, heavy borders, large shadows or decorative graphics.
- **Dark-first:** design the dark theme first, using a soft charcoal background rather than pure black, and provide a matching light theme.
- **Restrained colour:** use neutral tones with one accent colour for focus, selection and the active tab. Use syntax colours sparingly in the source editor.
- **Typography:** use a system monospace stack for source text, CSV cells, the status bar and tabs. Use a readable proportional system font on the Markdown rendered side. Do not load web fonts.
- **Editor details:** line numbers in a subtle gutter, active-line highlighting and a thin caret. Scrollbars stay thin and unobtrusive.
- **Motion:** none beyond short, subtle transitions (under 120 ms), and none when the user has requested reduced motion.
- **Dialogs:** small and compact, used only for decisions the user must make.
- **Accessibility:** text meets WCAG AA contrast, all actions work by keyboard, focus is always visible and icon-only controls have accessible labels.

### Elements

- **Empty state:** a full-page drop zone, an "Open file" button and the recovery list (if not empty).
- **Tabs:** one for each open file, with name, unsaved-changes indicator and close button. Dropping a file onto the app at any time opens it in a new tab.
- **Duplicate files:** if the same file is already open, focus its tab. Use `isSameEntry` when handles exist; otherwise compare name, size and last-modified time.
- **Commands:** there is no permanent toolbar. Save, Save As, Undo, Redo, Revert, Copy and view options are available from a command palette (Cmd/Ctrl+K) with fuzzy search, and from a small menu button at the end of the tab bar so that they remain discoverable.
- **Status bar:** file type, encoding, line endings and, for CSV, delimiter plus row and column counts.
- **Unsupported files:** show a non-blocking error naming the file. Other files in the same drop must still open.
- **Appearance:** follow the OS light or dark setting by default, with a manual override in the command palette stored in `localStorage`. The layout must remain usable down to a 768 px wide window.
- **UI strings:** English, kept in one module so that they can be translated later.
- **Keyboard:** Cmd/Ctrl+K opens the command palette, Cmd/Ctrl+S saves, Cmd/Ctrl+Shift+S is Save As, Alt+W closes the current file, and Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z undo and redo. Browsers reserve Cmd/Ctrl+W, T and N, so do not use them.

## 6. File handling

### 6.1 Encoding and line endings

Record these when a file opens and keep them when it is saved.

**Encoding detection order**
1. A byte order mark (UTF-8, UTF-16 LE, UTF-16 BE)
2. Strict UTF-8 decoding (`TextDecoder` with `fatal: true`)
3. Fallback to Windows-1252

The user can reopen a file with a different encoding from the status bar. Saving must use the file's encoding and retain any byte order mark. `TextEncoder` writes only UTF-8, so implement encoders for UTF-16 and Windows-1252. If the text contains a character that Windows-1252 cannot represent, stop before saving and offer "Save as UTF-8" or "Cancel". Never substitute characters silently.

**Line endings:** detect LF, CRLF or CR and keep them, including whether the file ends with a final newline.

**Mixed line endings (known exception):** show a notice in the status bar. Unedited files keep their original bytes, but the first saved edit may convert all line endings to the dominant style.

**Unedited files:** Save performs no write. Save As writes the original bytes unchanged.

### 6.2 CSV

**Parsing**
- Detect the delimiter by scoring `,`, `;`, tab and `|` for consistency across a sample of rows, ignoring delimiters inside quotes. The user can override the result from the status bar.
- **Spanish and Catalan Excel exports are a primary case:** semicolon delimiters, comma decimals and Windows-1252 must all work without any configuration.
- Support RFC 4180 quoting: escaped quotes, plus delimiters and newlines inside fields.
- Treat every value as text. Never convert numbers, dates, or leading zeros.
- Do not evaluate formulas. Render cell values as text only, never as HTML.

**Preservation**
- The model stores each field's **raw source text**, including its quotes.
- Editing a cell re-encodes that field only. Every other field and row is written back exactly as it was read.
- Quote an edited value only if it contains the delimiter, a quote or a line break, or if the original field was quoted.
- Adding a column changes every row, but must not alter existing fields.

**Malformed files**
- Rows with differing field counts must still display, with missing cells visually distinct. Missing cells must not be written unless the user fills them in.
- For unterminated quotes or other parse failures, show a warning and open the file in raw text view without changing it.

**Grid**
- The first row is styled as a header by default, with a toggle. This setting does not change the file.
- Sticky header row and row numbers; resizable columns; virtual scrolling.
- Double-click, Enter or typing begins editing a cell. Tab, Enter and the arrow keys move between cells.
- Insert and delete rows and columns.
- A view toggle shows the raw CSV text in the source editor. Edits there re-parse the grid.

**Copy and paste**
- Select single cells, rectangular ranges, whole rows, whole columns or the whole table.
- Copy writes both `text/plain` (tab-separated) and `text/html` (a table), so that the result pastes correctly into Excel, Google Sheets and Word.
- Pasting tabular data fills from the active cell and adds rows or columns if needed, as one undoable action.

**Size targets**
- 100,000 rows must scroll smoothly and open within 3 seconds on a typical laptop.
- Parse on a Web Worker when a file exceeds 5 MB.
- Show a warning above 50 MB, but still allow the file to open if the browser can handle it.

### 6.3 Markdown

**Rendering:** GFM (tables, task lists, strikethrough, autolinks), code blocks, images and links. Sanitize everything: no scripts, event handlers, iframes or `javascript:` URLs. External links open in a new tab with `rel="noopener noreferrer"`. Show YAML front matter as a distinct block and keep it unchanged when editing the source.

**Views:** side by side (default, with a draggable divider), source only and rendered only. Sync scrolling between the two sides on a best-effort basis.

**The source text is the single source of truth.**

| Action | Source text | Rendered side |
|---|---|---|
| Open, view, select or copy | Unchanged | Rendered from source |
| Edit the source | Changes only where typed | Updates within about 150 ms |
| Edit the rendered side | Regenerated from the rendered document (may reformat) | Updates directly |

**Avoid sync loops.** Loading the source text into the rendered editor must never write Markdown back to the source. Serialize only in response to a real user edit on the rendered side, and ignore any transaction the app itself made. **This is the most important correctness risk in the Markdown editor, and it needs dedicated tests.**

**Reformatting warning**
- Show the warning when the user first **tries to change** the rendered side of a file (typing, pasting, cutting, deleting or using a formatting command).
- Do **not** show it for clicking, selecting, scrolling or copying.
- Until it is accepted, the rendered side stays read-only and the attempted edit is not applied.
- Suggested text: "Editing here may reformat parts of this file's Markdown, including parts you don't change. Editing the source side doesn't do this."
- Actions: "Continue" and "Edit source instead", plus a "Don't show this again" checkbox.
- Acceptance applies to that file until its tab closes. "Don't show this again" is stored in `localStorage` for all files.

**Undo and revert**
- All edits share one undo history, whichever side they come from. Keep it in CodeMirror, and apply each rendered-side edit to CodeMirror as one transaction.
- Undoing a rendered-side edit restores the **exact** previous source text.
- Undo shortcuts behave the same way on both sides.
- "Revert to last saved" asks for confirmation, then restores the last saved text exactly. Revert can itself be undone.

**Copying**
- Normal text selection and copying work on both sides.
- "Copy source" copies the Markdown text. "Copy rendered" writes `text/html` and `text/plain`.

## 7. Saving

| Browser | Save | Save As |
|---|---|---|
| Chrome, Edge | Overwrites the original through a `FileSystemFileHandle` | `showSaveFilePicker` |
| Safari, Firefox | Downloads a new copy; label the button "Download" | Same, with an editable file name |

- Get handles with `DataTransferItem.getAsFileSystemHandle()` on drop and `showOpenFilePicker()` from the Open button. Read handles during the drop event, before it ends.
- If there is no handle, the first Save behaves like Save As.
- **External changes:** before overwriting, compare the file's size and last-modified time with those recorded at the last read or write. If they differ, offer "Overwrite", "Save As" or "Cancel".
- **Failures:** on a permission or write failure, keep the file marked as unsaved, keep the recovery data and show the error. Offer a download as a fallback.
- Show the browser limitation once, in a dismissible notice, on Safari and Firefox.

## 8. Recovery after an abrupt close

### Rules
- Do not rely on `beforeunload` or `pagehide` to save content, because they don't run reliably during crashes.
- Create a record **as soon as a file is opened**, before rendering it, and keep updating it during editing.
- Closing a file in the app deletes its record. **Any remaining record that no live page owns is an abruptly closed file.**
- This includes tab closes, browser quits, reloads, crashes, power loss and files with no unsaved changes.

### Data model (`documents` store in IndexedDB)

```ts
interface DocumentRecord {
  id: string;               // UUID
  sessionId: string;        // the page that currently owns this file
  name: string;
  kind: 'csv' | 'markdown';
  handle?: FileSystemFileHandle;
  originalBytes: ArrayBuffer;
  currentText: string;
  lastSavedText: string;
  hasUnsavedChanges: boolean;
  encoding: string;
  hasBom: boolean;
  lineEnding: 'lf' | 'crlf' | 'cr' | 'mixed';
  delimiter?: string;
  fileSize: number;
  fileLastModified: number;
  updatedAt: number;
}
```

### Persistence
- Debounce writes to about 500 ms after each edit, so that a crash loses at most about a second of typing. Also make a best-effort flush on `visibilitychange` (hidden) and `pagehide`.
- Save in a way that doesn't block typing. For large files, avoid serializing on the main thread for every keystroke.
- Call `navigator.storage.persist()` once to reduce the chance of eviction.
- On a quota or write error, show a persistent warning saying that recovery isn't currently protecting this file.

### Identifying abandoned files
Pages can run at the same time, so a file open in another tab must never appear as abruptly closed.
1. Each page generates a `sessionId` and holds the Web Lock `session:<sessionId>` for its lifetime.
2. A record is abandoned if no lock named after its `sessionId` appears in `navigator.locks.query()`.
3. To restore a record, re-check ownership and set the new `sessionId` in a single read-write IndexedDB transaction, so that two pages can't claim the same file.
4. Use `BroadcastChannel` to refresh the recovery list in other open pages. Also refresh when a page regains focus.

### Recovery list UI
- Show the list on the empty state and as a dismissible banner or menu when files are already open. Do not reopen files automatically.
- Each entry shows the file name, type, time of last edit, size and whether it has unsaved changes.
- Actions per entry: "Restore", "Download copy" and "Discard". "Discard" asks for confirmation if there are unsaved changes.
- Global actions: "Restore all" and "Clear all recovery data" (with confirmation).
- A restored file returns with its text, unsaved state and encoding details. Undo history doesn't need to survive.
- If it has a stored handle, ask for write permission upon the first Save (`requestPermission` requires a user gesture). If this is denied or the handle no longer works, fall back to Save As.

### Limit
- Keep at most **10** abandoned records (`MAX_RECOVERY_ENTRIES = 10`). Files open in live pages don't count.
- When over the limit, evict records with no unsaved changes first (oldest first), then the oldest unsaved records.

### Closing a file normally
- No unsaved changes: close and delete the record.
- Unsaved changes: offer "Save", "Don't save" and "Cancel". Delete the record only after the save succeeds or the user chooses "Don't save".

Also set a `beforeunload` prompt while there are unsaved changes, as a convenience.

## 9. Security and privacy

- Make no network requests containing file content, with no analytics, telemetry or external error reporting.
- Markdown images on external `https:` URLs will load, which reveals the user's IP address to those hosts. Block them and add "Load remote images" per file, off by default.
- Recovery data is stored unencrypted in the browser profile. "Clear all recovery data" must remove it entirely. Mention this in the README for use on shared computers.
- Treat all file content as untrusted.

## 10. Browser support

Support the current versions of Chrome and Edge fully. Support Safari and Firefox with the save fallback from section 7. Web Locks, IndexedDB and `BroadcastChannel` are required in all four.

## 11. Acceptance criteria

The automated tests must cover each item below, using Playwright where the behaviour is browser-level. Where automation is impractical, such as a native save dialog, document the manual check in the README.

**Preservation**
1. Opening a file and saving it without edits leaves it byte-identical. Cover CRLF, no final newline, UTF-8 with BOM, UTF-16 and Windows-1252.
2. Viewing, selecting and copying from the Markdown rendered side does not mark the file as changed.
3. A one-word source edit in Markdown changes only that word in the saved file. Use a fixture with `*` bullets and `__bold__`.
4. Editing one CSV cell changes only that field. Use a fixture with inconsistent quoting and semicolons.
5. A Windows-1252 file with `à, é, ç, ñ, ·` displays correctly and saves with the same bytes outside the edit.
6. Values such as `007`, `1,50` and `=SUM(A1)` display and save exactly as they appear in the source.

**Editing**
7. An edit on the rendered side updates the source. The warning appears first, unless it has been dismissed permanently, and declining leaves the source byte-identical.
8. Undoing a rendered-side edit restores the exact previous source. Revert restores the exact saved text.
9. Multi-cell copy pastes correctly into a spreadsheet as rows and columns; tab-separated data pasted from a spreadsheet fills the correct cells.
10. A Markdown file containing `<script>`, `onerror` and `javascript:` payloads executes nothing.

**Saving**
11. Chrome or Edge overwrites the original file after permission is granted. Safari and Firefox download a copy.
12. An externally modified file triggers the conflict prompt before anything is overwritten.
13. A character that the file's encoding cannot represent triggers the prompt, with no silent replacement.

**Recovery**
14. Edit a file, kill the browser process within 2 seconds of pausing, then relaunch. The file is listed, and restoring it brings back the edit.
15. A file closed normally does not appear in the list.
16. A file open in a second tab does not appear in the list in the first tab, but does appear after the second tab is closed.
17. Two tabs restoring the same record at once result in only one owner.
18. After 12 abrupt closes, 10 records remain, chosen according to the eviction rule.
19. Discard and "Clear all recovery data" remove the data from IndexedDB.

**Performance and privacy**
20. A 100,000-row CSV meets the targets in section 6.2, and typing in a 1 MB Markdown file has no noticeable lag.
21. A network capture during a full open, edit and save flow shows no request containing file content, and no request to any other origin. Remote images remain blocked until the user enables them.

**Interface**
22. Every command can be run from both the command palette and the menu button, and by keyboard alone. Both themes meet WCAG AA text contrast.

## 12. Build order

Complete each step, with its tests, before moving on.

1. Project scaffold, file opening, and decoding and encoding with byte-identical round-trip tests
2. Recovery store, session locks and recovery UI (build early so that all later work relies on it)
3. Markdown source editor, rendered view (read-only) and saving
4. CSV tokenizer, preservation tests and grid
5. Rendered-side Markdown editing, warning, shared undo and revert
6. Clipboard features, conflict detection and browser fallbacks
7. Full acceptance run, deployment and README

## 13. Definition of done

- All acceptance tests pass, and any manual checks are documented with their results.
- The owner has answered the questions in section 4, and the app is live over HTTPS.
- The README covers setup, testing, deployment, updates, rollback and known limitations.
- Report any spec deviation to the owner with the reason, rather than making it silently.
