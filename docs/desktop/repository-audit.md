# Desktop target: feasibility and repository audit

The discovery gate from section 2 of the [implementation report](implementation-report.md), run against the real repository, plus the feasibility verdict. Where this file and the report disagree, this file wins, because the report was written without seeing the code. The plan itself is in [ROADMAP.md](../../ROADMAP.md).

- **Audited:** 7 November 2026, commit `be04f8a`, on the Linux x86-64 server.
- **Line references** are to that commit. M1 has since moved `src/doc/fileAccess.ts` to `src/platform/webHost.ts`, and `handle` to `binding`.
- **Not tested here:** nothing has run in a real Tauri app or on a Mac. Every claim about `WKWebView` or `tauri://` below is either reasoning or from documentation, and is marked as such.

## Verdict

**Feasible, and a good fit. Go ahead, starting with a short spike on a real Mac.**

The code is small and already keeps file access in one place. WebKit is the engine the Mac app would use, and the web suite passes on it. No finding needs a rewrite or threatens the deployed site.

| Area | Verdict | Basis |
|---|---|---|
| Shared frontend runs bundled and offline | Very likely | Static Vite output, no router, no service worker, no remote runtime requests |
| App works on WebKit | Likely | 136 of 136 runnable tests pass on Playwright WebKit. That is a Linux build, not `WKWebView` |
| Replacing browser file access | Straightforward | `fileAccess.ts` is 135 lines, with a few call sites in [workspace.ts](../../src/doc/workspace.ts) and [OpenDoc.ts](../../src/doc/OpenDoc.ts) |
| Recovery on IndexedDB under `tauri://` | Unknown, must be tested | Depends on secure-context and storage behaviour only a Mac can show |
| Native save that keeps its promises | Feasible, needs care | The report's write recipe has a metadata bug (see [Corrections](#corrections-to-the-report)) |
| Automated macOS testing | Partly | `tauri-driver` has no macOS support; a plugin route exists but is unproven here |
| Distribution to other people | Feasible, costs money | Needs the paid Apple Developer Program |

### What could block or delay it

1. **No Mac in this environment.** This server has no Rust, and Tauri's macOS bundling and signing need Apple hardware. Milestone M0 can't start without a Mac. The shared-code work in M1 doesn't need one.
2. **Secure context under `tauri://localhost`.** I found no authoritative answer. The app calls `navigator.locks` without a guard at startup ([session.ts:8](../../src/recovery/session.ts#L8)), so if it's missing `ws.start()` fails. `crypto.randomUUID` and `navigator.clipboard` have the same dependency. If it turns out insecure, small desktop-only shims are enough, so this is a cost and not a blocker.
3. **Quit paths.** The report only handles the window's close request. Cmd+Q, Dock quit and logout may take other routes, and they need testing on a Mac.

## Audit findings

### 1. Toolchain and commands

| Item | Finding |
|---|---|
| Layout | Single package, no monorepo. Package manager npm, with `package-lock.json` |
| Runtime | No Node or Rust on the host. Node 24 in the [Dockerfile](../../Dockerfile), and Node 26 in the Playwright 1.65 image used for tests through [in-docker.sh](../../scripts/in-docker.sh) |
| Stack | React 19, Vite 8, TypeScript 7, CodeMirror 6, Milkdown 7, TanStack Virtual, `idb` |
| Commands | `npm run build` (typecheck and build), `npm test`, `npm run test:e2e`, `npm run test:perf` |
| Version | `package.json` says `0.0.0` and the repository has no tags, so there is no release versioning for Tauri to read yet |
| Disk | 14 GB free on this server (87% used). A Rust `target/` directory and a WebKitGTK image would use a real share of that |

### 2. Frontend build

| Item | Finding |
|---|---|
| Entry and output | [index.html](../../index.html) → [src/main.tsx](../../src/main.tsx) → `dist/` |
| Routing | None. One page with absolute `/` asset paths, which suit `tauri://localhost/` |
| Bundle | One 1.33 MB JS chunk (429 KB gzipped), one CSS file, one CSV worker. No dynamic imports, so Milkdown loads even for a CSV |
| PWA | A web manifest only, no service worker |
| Frontend env vars | None. Variables such as `BASE_URL` and `HOST_PORT` are test and deploy settings |
| CSP | Same policy kept twice, in [vite.config.ts](../../vite.config.ts) and [security-headers.conf](../../deploy/security-headers.conf). Desktop would add a third copy |

Hashed web assets at this commit, for comparison in M2: `index-BTei216k.js`, `index-x8ktvJeg.css`, `csvWorker-rOQ0BaDx.js`.

### 3. Document state

| Concern | Where | Desktop impact |
|---|---|---|
| Open and duplicates | `openFiles`, `openOne`, `findDuplicate` in workspace.ts | `isSameEntry` needs a native equivalent |
| Recovery before render | `openOne` writes the record before creating the editor | Keep as is. It runs after decoding, which the report's wording doesn't quite match |
| Dirty tracking | `OpenDoc.contentChanged` compares the full text on every edit, deferred for tables over 20,000 rows | Shared, no change needed, but see Performance |
| Saving | `save`, `saveAsPicker`, `saveToHandle`, `saveFailed` | Permission and conflict steps map well onto a native host |
| Unedited saves | Write `originalBytes` exactly | Keep as is |
| External changes | Size and `lastModified` compared at save. Cancel, Save As or Overwrite | The report adds Reload, which doesn't exist on the web |
| File identity | `doc.handle` also drives `isNew` | Needs a native-capable replacement, including in saved records |
| Dialogs | HTML dialogs through `ws.ask` | Reusable. Also usable for the quit flow |
| Shortcuts | Window `keydown` in [App.tsx](../../src/ui/App.tsx) and [commands.ts](../../src/ui/commands.ts) | Must be checked against native menu shortcuts |
| Drag and drop | Window drop listeners in App.tsx. Grid and pane drags use pointer events | Grid drags shouldn't conflict with native drop. Spike to confirm |
| Close | `beforeunload` and `closeDoc` for one file | No "close all" exists. The desktop quit flow needs one |

### 4. File types and guarantees

Supported: `.csv`, `.md`, `.markdown`, `.txt` ([fileTypes.ts](../../src/core/fileTypes.ts)), matched by extension. Detected and kept: UTF-8, UTF-16 and Windows-1252, BOM, line endings. Byte fixtures are built inline in [preservation.spec.ts](../../e2e/preservation.spec.ts), and there's no fixtures directory. All of this happens in shared code above the file layer, so the desktop host only has to carry bytes.

### 5. Browser dependencies that a desktop host changes

| Dependency | Where | What desktop needs |
|---|---|---|
| File System Access API | `fileAccess.ts`, `handle` fields | Native host |
| `<a download>` of a blob | `fileAccess.ts:113`, called from [workspace.ts:534](../../src/doc/workspace.ts#L534), [:623](../../src/doc/workspace.ts#L623), [:791](../../src/doc/workspace.ts#L791) | Native Save As. The link works in the spike, although [WebKit bug 216918](https://bugs.webkit.org/show_bug.cgi?id=216918) suggested `WKWebView` would ignore it (see [M0 results](#m0-spike-results)). The copy goes to Downloads, so the app still needs a native route. **The report doesn't cover this**, and it includes the failed-save escape route and "Download copy" in recovery |
| `window.open` for links | [RenderedPane.ts:185](../../src/doc/RenderedPane.ts#L185) | A narrow command that opens only URLs that pass `classifyLink`, rechecked in Rust. **Not in the report** |
| `fetch('/build-info.json')` | [StatusBar.tsx:15](../../src/ui/StatusBar.tsx#L15) | Generate the file into the desktop build. Otherwise it shows "Build unknown" |
| Web Locks | [session.ts](../../src/recovery/session.ts) | Spike. One window makes a simple fallback possible |
| Clipboard | [commands.ts:62](../../src/ui/commands.ts#L62), `fileAccess.ts:124` | Spike. Native paste through the menu and `onPaste` should still work |
| `beforeunload` | [workspace.ts:154](../../src/doc/workspace.ts#L154) | Replaced by native close handling |
| Interface wording | [strings.ts](../../src/strings.ts): "this browser", "Download", "your browser's paste shortcut" | Desktop variants |
| `localStorage`, IndexedDB | workspace.ts, [store.ts](../../src/recovery/store.ts) | Should work. Persistence is a spike item |

Tests that stub these: [saving.spec.ts](../../e2e/saving.spec.ts) (pickers, permissions, failed writes) and [helpers.ts](../../e2e/helpers.ts) (`useDownloads`). The web adapter has to keep reading the picker functions from `window`, or these tests stop working. Unit tests run in Node without a DOM and cover `src/core` and eviction, so `Workspace` is only tested through Playwright.

### 6. Baseline quality gate

All on commit `be04f8a`, in Docker on this server.

| Check | Result |
|---|---|
| Typecheck and build | Pass |
| Unit tests | 112 passed |
| E2E: Chromium, Firefox, WebKit | 235 passed |
| Performance | 3 passed. 100,000-row CSV opens in 969 ms; scroll p95 26.7 ms; 1 MB Markdown opens in 248 ms; typing median 25.6 ms, p95 33.9 ms |
| **Whole suite on WebKit** (one-off config, not committed) | **136 passed, 15 skipped, 0 failed** |

The usual `test:e2e` runs only the `@cross` tests on WebKit, about 42 of 151, which is why I ran the whole suite. The 15 skips are the parts WebKit hasn't exercised, and they are what the Mac has to prove:

- 10 for overwrite and conflict flows that need the File System Access API. The native host replaces these and needs its own coverage.
- 4 for clipboard.
- 1 for recovery after a killed process.

These timings are from headless Chromium on a server, so they say nothing about the report's Mac budgets. They also aren't measured like the report's "below 16 ms" typing target, which should be redefined once there's a Mac baseline.

### 7. Remote resources

The production bundle has no runtime request to the deployed origin or a CDN. Its only URLs are XML namespaces, error-text links (`react.dev`, `prosemirror.net`) and the `relative.invalid` parsing base. `e2e/privacy.spec.ts` asserts this behaviour on the web.

The one intended remote resource is HTTPS images in Markdown, blocked until "Load remote images" is run for that file. Desktop should keep the same behaviour, so it needs `img-src https:` in its CSP.

## M0 spike results

In progress. Record the answer to each question in [TODO.md](../../TODO.md#m0-spike-on-a-real-mac) here.

Tested on the M4 with macOS Tahoe 26.7.1, using an ad hoc signed DMG from Tauri 2.12.5 and Rust 1.99.1, built on a hosted `macos-15` runner.

**Platform**

- **The app starts,** so the unguarded `navigator.locks` use at startup doesn't stop it on this macOS version. Older versions are untested.
- **The APIs are present:** `isSecureContext` is true, `crypto.randomUUID` and `navigator.storage.persist` are functions, and `navigator.locks` and `navigator.clipboard` exist. This shows only that they're available, not that they work.

- **The CSP works with `style-src` excluded from Tauri's changes.** There were no console errors and nothing looked unstyled in the app, including with a 200,000-row CSV in the grid. What breaks without the exclusion is untested.
- **The module worker loads under the CSP.** Opening that CSV (over 5 MB) logged the worker being created and replying, so it didn't use the silent fallback to parsing on the main thread.

**Recovery**

- **Cmd+Q, then `kill -9` as a precaution, about 2 seconds after typing:** the change was kept and offered for recovery.
- **The same, immediately after typing:** a one-word change was lost. Cmd+Q alone didn't repeat this, so the `kill -9` may have interrupted the write as the app closed. This isn't confirmed.
- **Cmd+Q alone, Force Quit and `kill -9` of a running app:** all changes came back in every round, both after 2 seconds and when quitting by hand as fast as possible. Recovery survives a crash once the debounce has passed.
- **Those hand-timed rounds may have run after the write,** because reaching Force Quit or Terminal probably takes longer than 500 ms.
- **`kill -9` during continuous typing (one run, on a timer):** typed `1 2 3 ...` and the recovered text ended at `16 1`, so little or nothing was lost. This is better than the code predicts. `schedulePersist` resets its timer on every change and has no maximum wait, so steady typing shouldn't write until a pause. Either there was a pause just before the kill, or something else wrote the text, and this run can't tell which. Check this in M5: without a maximum wait, a long burst of typing with no pause could lose more than the last 500 ms.
- **Replacing the app keeps recovery data.** After a `kill -9`, `full.app` was replaced with a rebuilt DMG with the same identifier, and the unsaved word was offered. The rebuild had the same version number and the same app code, so this doesn't test a version bump or a change to the stored data format.
- **If the web content process dies, the app recovers cleanly.** After `kill -9` on the process, the window stays open and returns to the start screen, so the file is closed, and the unsaved file is offered in Recover files. M5 could restore it automatically or explain what happened, because the app gives no sign of why the file closed. Typing after this hasn't been tested.
- **Data location:** the only item found under `~/Library` by searching for the identifier is `~/Library/WebKit/com.marcos-a.full.spike`. An update has to preserve it. Since the real identifier differs, the spike's data wouldn't carry over to the real app.
- **Cmd+Q gives no unsaved-changes warning,** even with pending changes. Nothing was lost, but M5 needs to hold the quit back.

**Input (partial)**

- **The default menu and shortcuts work:** Cmd+C, X, V and A in the source editor, rendered side and grid; Cmd+Z and Cmd+Shift+Z; Cmd+S and Cmd+K; each firing once. Undo behaved as expected, judged by what it did and not by inspecting which handler ran.
- **Row, column and split-pane drags work** with `dragDropEnabled` on.
- **Option+W quits the whole app when the file has unsaved changes,** while Safari and Chrome ask first. It exits with code 0 and no crash report, and the work is offered in Recover files, so nothing is lost. Clicking the tab's × runs the same `closeDoc` and asks correctly, so the shortcut is the trigger. The web code has no `window.close()`. The native cause isn't confirmed.

- **Dead keys lose the accent:** typing `à` into a selected grid cell gives `a`. This also happens on the website in Safari and Chrome on the same Mac, so it's a shared-code bug and not specific to `WKWebView`. The existing e2e test can't catch it, because it simulates the dead key and inserts a ready-made `à`. In the app's event log, `Dead` (`BracketLeft`) reaches the non-editable `.grid-scroll`, no composition starts, and `a` then goes to the cell editor as plain text. In a cell already in edit mode, the same keys give `à` in all three. So an editable element has to hold focus before the dead key arrives, and moving focus during its keydown is too late. The `fix-grid-dead-keys` branch keeps a hidden text field focused while a cell is selected. In the app, a real dead key then gives the accent, and VoiceOver still reads the cell position when moving. Real Safari and Chrome are still to be checked.

**Close and quit (partial)**

- **Two patterns in the native log.** Some exits log `CloseRequested`, `Destroyed`, `ExitRequested` and `Exit`. Others log only `Exit`, which would leave nothing to hold back. The log had no labels, so which action gives which pattern isn't confirmed. The hold tests haven't taken effect yet either.
- **Option+W showed the save dialog in this build,** run from Terminal. The earlier quit hasn't been reproduced, so its cause is still open.

**Saving (not a TODO question)**

- **`showSaveFilePicker` is missing,** so the app shows the "This browser can't overwrite files" notice. The wording is wrong for a desktop app, and M4 replaces this path.
- **`<a download>` of a blob works,** which is not what the audit expected. The copy goes to Downloads, even for a file opened from elsewhere, and gets a unique name such as `test copy2 (1).csv`. It contains the edit, and the original is unchanged.

**Finder (partial)**

- **A drop from Finder arrives natively:** `WindowEvent::DragDrop` logged the file's full path. The file doesn't open, so the page's HTML5 handler stays out of the way with `dragDropEnabled` on. M3 has to open dropped files from the native event.
- **`full.app` is greyed out in Finder's Open With dialog for a CSV,** as expected. The spike declares no file types. M6 adds them.

## Corrections to the report

### Security and data

1. **`open_paths` from JavaScript defeats the grant model.** As written, the frontend passes any path and Rust records it as granted. A script running in the webview could then read and overwrite any supported file in the home directory. Rust must record drop and Finder paths from its own native events and offer the webview opaque IDs. Paths from dialogs are already native.
2. **Re-granting after a restart needs a native gesture for the same reason.** The first save of a restored file shows a Rust-owned confirmation naming the path, or the Save panel. A JavaScript dialog can't authorise it. This takes the place of the browser's permission prompt in the existing flow.
3. **"Restrictive permissions" on the temp file would change the saved file.** A rename would turn a `0644` file into `0600` and drop Finder tags, extended attributes and creation date. Copy the mode and attributes first, or use a macOS replace API that keeps them. Test this, including in iCloud and Dropbox folders. Also note that a rename breaks hard links, and that the stat-then-rename gap is small but real. It isn't a true compare-and-swap, so it shouldn't be described as one.
4. **Symlinks.** If grants hold the canonical path, opening through a link and saving to its target works naturally. The "reject symlink targets" rule then only fires if the path becomes a link later.
5. **Cmd+Q and other quit paths** need the same protection as closing the window. If some can't be intercepted, recovery has to cover them, and the docs have to say so.

### Things that don't match the code

6. **`SupportedKind` omits `text`.** `DocKind` is the existing type, and `.txt` is a supported format.
7. **`FileIdentity.locator: string` can't hold a `FileSystemFileHandle`**, and the proposed port leaves out the web's download mode and permission prompts. There is also no `DocumentController`. M1 built a seam that fits: see the [roadmap's design](../../ROADMAP.md#design-decisions).
8. **Records need a compatible format.** Existing users' records hold `handle`. Add an optional field and don't bump the database version just for this.
9. **Product name.** The brand, `APP_NAME` and the report all use lowercase `full`, so the Tauri `productName` must too.
10. **`version` has no source yet.** Tauri can read it from `package.json`, which needs a real version first.

### Tauri details

11. **The config field is `contentTypes`**, plural, per the current reference, not `contentType`.
12. **CSP needs two deliberate changes.** IPC needs a `connect-src` addition (`ipc: http://ipc.localhost` in Tauri's example). Tauri also adds nonces to styles, and under the CSP specification a nonce makes the browser ignore `'unsafe-inline'`, which this app's policy relies on. `dangerousDisableAssetCspModification: ["style-src"]` should keep the web policy's meaning. Despite its name it isn't a weakening here. Confirm in M0.
13. **Don't export a Markdown type.** full doesn't own Markdown. Declare support through `contentTypes` and leave `exportedType` out unless testing on a Mac shows it's needed.
14. **`.txt` has a better answer than leaving it out.** `rank: "Alternate"` should offer full under Open With without competing for the default.
15. **Single-instance matters less on macOS.** LaunchServices sends a second double-click to the running app through `RunEvent::Opened`. The plugin is cheap but can wait for Windows and Linux, unless testing shows a need for it on Mac.
16. **Binary transfer needs `tauri::ipc::Response`.** Returning `Vec<u8>` from a command serialises it to JSON. Check the current API when implementing.
17. **Automated macOS end-to-end is limited.** `tauri-driver` doesn't support it. Tauri's docs describe a WebdriverIO route that compiles `tauri-plugin-wdio-webdriver` into the app. They say nothing about its maturity, and it must never reach a release build.
18. **Minimum Tauri version.** Use 2.11.1 or later. The [origin-confusion advisory](https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9) (CVE-2026-42184, medium) affects up to 2.11.0. It names Windows and Android, so it doesn't affect the Mac app directly, but it matters for the later ports. The newest 2.x at the audit date is 2.12.5 (21 October 2026). Tauri 3 is in alpha, and GitHub marks its latest alpha as the repository's latest release, so pin `2.x` explicitly and don't take "latest" on trust. The single-instance plugin needs Rust 1.90 or later.

### Performance

The report's budgets are fine as targets. These existing behaviours are the likely problems to measure first:

- **`refreshRecovery` reads every record in full** every 5 seconds and on every focus ([workspace.ts:157](../../src/doc/workspace.ts#L157), [:715](../../src/doc/workspace.ts#L715)), including all open documents' bytes and text, just to build a list. With one window, desktop needs this only at startup and after a restore or discard, so it can skip the polling. That needs no web or schema change.
- **Each persist rewrites the whole record**, including `originalBytes`. Splitting the store would mean a schema migration, so do it only if a large-file measurement justifies it.
- **`detectAndDecode` runs on the main thread**, and only large CSV parsing uses the worker. There is no cancellation either, so the report's "retain cancelability" isn't available without new work.
- **A single 1.33 MB bundle.** Lazy-loading Milkdown is the obvious option if launch misses its budget.

## Sources

Tauri 2: [WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/), [configuration](https://v2.tauri.app/reference/config/), [CSP](https://v2.tauri.app/security/csp/), [file associations and `RunEvent::Opened`](https://v2.tauri.app/learn/mobile-file-associations/) (covers macOS despite the URL), [single-instance](https://v2.tauri.app/plugin/single-instance/), [macOS signing](https://v2.tauri.app/distribute/sign/macos/), [releases](https://v2.tauri.app/release/). Also the [custom-scheme service worker issue](https://github.com/tauri-apps/tauri/issues/13031), which is one more reason not to add a service worker.
