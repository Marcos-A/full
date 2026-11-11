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

Finished on 7 November 2026.

**Conclusions**

- **The plan stands.** The app starts, the frontend runs unchanged under the CSP, and IndexedDB recovery survived every way of ending the app that was tested. Recovery doesn't need a native store.
- **The main new work is in M5.** Only closing the window can be held back with Tauri's events. Cmd+Q, Dock Quit and logout end the app with no chance to ask about unsaved work.
- **M3 and M4 have what they need.** Finder drops arrive natively with the full path, and the web saving fallback only goes to Downloads.
- **Launch and typing look fine.** Opening a 1 MB Markdown file looks slow, and needs proper timing in M6.

**Not answered, and carried forward**

- **Option+W:** it quit the app with unsaved changes in two early runs, then showed the save dialog in a later one. The cause is unknown. M5 checks it along with the Cmd+W decision.
- **Cold launch:** not measured. M6 runs the launch budgets.
- **Older macOS:** everything ran on macOS 26.7.1. Whether `navigator.locks` needs a guard depends on the oldest version M6 supports.
- **Removing the `style-src` exclusion:** not tested. It works with the exclusion, and M2 keeps it, so the answer wouldn't change anything.

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

**Input**

- **The default menu and shortcuts work:** Cmd+C, X, V and A in the source editor, rendered side and grid; Cmd+Z and Cmd+Shift+Z; Cmd+S and Cmd+K; each firing once. Undo behaved as expected, judged by what it did and not by inspecting which handler ran.
- **Row, column and split-pane drags work** with `dragDropEnabled` on.
- **Option+W quits the whole app when the file has unsaved changes,** while Safari and Chrome ask first. It exits with code 0 and no crash report, and the work is offered in Recover files, so nothing is lost. Clicking the tab's × runs the same `closeDoc` and asks correctly, so the shortcut is the trigger. The web code has no `window.close()`. The native cause isn't confirmed.

- **Dead keys lose the accent:** typing `à` into a selected grid cell gives `a`. This also happens on the website in Safari and Chrome on the same Mac, so it's a shared-code bug and not specific to `WKWebView`. The existing e2e test can't catch it, because it simulates the dead key and inserts a ready-made `à`. In the app's event log, `Dead` (`BracketLeft`) reaches the non-editable `.grid-scroll`, no composition starts, and `a` then goes to the cell editor as plain text. In a cell already in edit mode, the same keys give `à` in all three. So an editable element has to hold focus before the dead key arrives, and moving focus during its keydown is too late. Fixed in `8e34605`, which keeps a hidden text field focused while a cell is selected. A real dead key then gives the accent in the app, Safari and Chrome, and VoiceOver still reads the cell position when moving in the app.

**Close and quit**

- **The red button and Cmd+W can be held back:** each fires `CloseRequested`, and `prevent_close` keeps the window open. Without a hold, each logs `CloseRequested`, `Destroyed`, `ExitRequested` and `Exit`.
- **Cmd+Q can't be held back with these events:** it logs only `Exit`, with or without a hold, and the app closes. `ExitRequested` doesn't fire, so `prevent_exit` never gets a chance. M5 needs another route, such as a custom Quit menu item, which is untested. Until then, recovery is what protects the work.
- **Dock Quit behaves like Cmd+Q:** it logs only `Exit` and closes the app, with or without a hold. One earlier run with a hold logged nothing and stayed open, and a retest didn't repeat that, so the Quit probably didn't register that time.
- **Logout behaves the same way:** it logs only `Exit`, and the app didn't delay the logout. It didn't reopen after logging back in. Only recovery protects the work in this case.
- **Option+W showed the save dialog in this build,** run from Terminal. The earlier quit hasn't been reproduced, so its cause is still open.

**Measure**

Frame gaps come from `requestAnimationFrame` over 15 seconds of typing, with the inspector open. They show pauses on the main thread rather than input latency, so they don't test the report's 16 ms target directly. Open times were judged by hand.

| File | Open | Frame p50 | p95 | Max | Over 50 ms |
|---|---|---|---|---|---|
| 1 MB Markdown | More than a second | 17 ms | 28 ms | 55 ms | 1 |
| 100,000-row CSV | "Pretty fast" | 17 ms | 17 ms | 61 ms | 1 |
| 50 MB CSV | About a second | 17 ms | 17 ms | 35 ms | 0 |

- **Warm launch:** 1,423, 2,371, 462, 439 and 445 ms, timed by pressing Return when the start screen appeared. The first two numbers are late key presses: to the eye, every launch was about equally fast. So it's about 450 ms against the 1-second budget, as a hand-timed result and not a p95.
- **The 1 MB Markdown file misses the report's 500 ms open budget,** by this rough timing. Revisit it with proper timing in M6.
- **Closing its tab was slow and unresponsive once,** and fine on a second try. The cause is unknown.
- **No sign of pauses from `refreshRecovery` or persisting,** including at 50 MB.

**Saving (not a TODO question)**

- **`showSaveFilePicker` is missing,** so the app shows the "This browser can't overwrite files" notice. The wording is wrong for a desktop app, and M4 replaces this path.
- **`<a download>` of a blob works,** which is not what the audit expected. The copy goes to Downloads, even for a file opened from elsewhere, and gets a unique name such as `test copy2 (1).csv`. It contains the edit, and the original is unchanged.

**Finder**

- **A drop from Finder arrives natively:** `WindowEvent::DragDrop` logged the file's full path. The file doesn't open, so the page's HTML5 handler stays out of the way with `dragDropEnabled` on. M3 has to open dropped files from the native event.
- **`full.app` is greyed out in Finder's Open With dialog for a CSV,** as expected. The spike declares no file types. M6 adds them.

## M2 shell results

Checked on 7 November 2026 on the M4 with macOS Tahoe 26.7.1, using the ad hoc signed DMGs from commit `fd4494c`, built on a hosted `macos-15` runner with Tauri 2.12.5 and Rust 1.99.1.

- **The app starts with the network off** and shows the UI styled normally, with `Build fd4494c` in the status bar.
- **No CSP violations** in the inspector build's Console, after a reload, with a Markdown file, a CSV over 5 MB, and a remote image loaded with "Load remote images".
- **The normal build has no Web Inspector.** CI checks each binary for it. The first round mixed up the two builds because both DMGs had the same name, so the inspector build is now named "full inspector".
- **Links:** clicking a web link or a mail link opens it in the default app, and the window stays as it was. "Open Link" in the context menu does nothing, because the navigation guard refuses it.
- **The native boundary holds from the page.** Called from the Console, a core window command, a `file:` link and a `javascript:` link were all refused, and setting `location.href` to a website left the app where it was.
- **The website bundle is unchanged:** `dist/` built byte-identical to `main`'s, and CI's search of `dist/` finds no Tauri code.

Not checked: `npm run desktop:dev`, because neither machine has Rust. Downloaded builds show Gatekeeper's "not opened" warning until the quarantine flag is removed, which M7's notarization fixes.

## M3 open results

Checked on 8 November 2026 on the M4, using the ad hoc signed DMGs from commit `b819dad`, built on a hosted `macos-15` runner.

**How it works**

- **Grants:** `src-tauri/src/grants.rs` takes paths only from the Open panel, Finder drops and `RunEvent::Opened`. The webview gets an opaque grant per file, and reads bytes through it as a raw IPC response. No command takes a path, and a unit test checks that.
- **The path still reaches the webview, one way only.** The recovery record needs it for M5, and comparing it finds a file that's already open. Nothing accepts it back.
- **Grants hold the canonical path and last until the app quits.** A link is judged by what it points at, and a link or pipe swapped in after the grant is refused.
- **Native events use one IPC channel,** the page's own connection, so the window still has no core or plugin permissions. The channel holds cold-start files in Rust until the page asks, once `ws.start()` has finished.
- **The drop overlay is the shared one.** Desktop code sends it synthetic drag events, so the website's code didn't change. `dist/` is byte-identical to `main`'s.

**On the Mac**

- **Open panel:** multiple selection works, unsupported types are greyed out, and Cancel does nothing.
- **Finder drops:** the overlay follows the drag, and a 1,000,000-row CSV opens in a few seconds through the raw transfer.
- **Mixed drops, duplicates and unsupported files behave as on the web.** Supported files open and the others are named in an error. Dropping an open file, or a link to it, focuses its tab. A file with the same name and content in another folder opens separately. A link named `.md` that points at a PNG is refused, and a folder named `.md` is reported as unreadable.
- **A file in Documents opens with no macOS permission prompt.**
- **Finder opens:** `open -a` delivers `RunEvent::Opened` both while the app runs, which brings the window forward, and at launch, with two files. The app declares no file types yet and this still works.
- **The boundary holds from the page.** From the inspector build's Console, `read_granted` with `/etc/hosts` gives "permission denied", and `plugin:dialog|open` is refused by the ACL. Drops log no errors.

Not checked: a real double-click and Open With in Finder, because the app declares no file types until M6. `open -a` reaches the same event, but M6 has to confirm those two. Files in iCloud or Dropbox folders are also untested.

## M4 save results

Checked on 8 November 2026 on the M4, using the ad hoc signed DMG from commit `8906b37`, built on a hosted `macos-15` runner.

**How it works**

- **Grants:** Save, Save As and "Save a copy" go through `src-tauri/src/grants.rs`, and still no command takes a path. The Save panel's destination is granted in Rust, like an opened file. The page only suggests a name, and anything like a folder in it is dropped.
- **Replacing a file:** `src-tauri/src/save.rs` writes and flushes the new content in a directory the system picks on the same volume, then swaps it in with `NSFileManager`'s safe-save call. A new file is created exclusively instead, so it can't land on one that appeared after the panel closed.
- **The revision check isn't a compare-and-swap.** It runs before writing and again just before the swap, and another program can still change the file in the gap. Two saves in the app can't overlap, because Rust runs them one at a time.
- **A rename ignores a file's own permissions,** so the file is opened for writing first. That's what refuses a read-only or Finder-locked file.
- **Links:** a grant holds the canonical path, so saving through a link saves to its target. A link at the path or on the way to it, if it appears later, is refused.
- **Bytes go to Rust as a raw IPC body,** with the grant and expected revision in headers. Failures come back as codes that never hold a path, and the page words them in the user's language.
- **Reload** exists only where the host has `reread`, which the website's doesn't. It asks first and can't be undone.
- **The website's bundle changed for the first time since M1,** by 959 bytes: the retry loop and Reload branch in `workspace.ts`, `OpenDoc.reload`, `FileChangedError`, and six strings. The website never reaches the new branches, because its host has no `reread` and its `write` never reports a change.

**In CI, on the macOS runner**

- Mode, Finder tags, `com.apple.FinderInfo`, other extended attributes and creation date survive one save and two in a row. The modification time is the new one.
- A read-only file, a Finder-locked file and a file in a read-only folder are refused, the old file is left as it was, and nothing is left beside it.

**On the Mac**

Marcos ran the written steps and found nothing wrong:

- **Scenario 1:** edits to a Markdown and a CSV file save over the originals, with mode, tag, extended attribute, creation date and CRLF line endings kept.
- **Scenario 4:** another app's change stops the save. Cancel, Reload (with its second confirmation), Overwrite and Save As each behave as written.
- **Scenario 5:** read-only and locked files show the failure with only Cancel and Save As, and the file doesn't change.
- **Save panel:** a name typed with no extension gets the file's own, an unsupported extension is refused, and replacing a file asks first.
- **Restored files:** "Save a copy" uses the panel and keeps the record, and Save tells the user to use Save As.
- **iCloud Drive:** the same metadata checks pass, and a second save a minute later shows no false conflict.

Not checked: Dropbox folders, because Marcos doesn't use Dropbox, and network and external volumes, where the system may not offer a staging directory, and then the save fails and offers Save As. A hard link to a saved file keeps the old content, as [correction 3](#security-and-data) expected.

## M5 close results

Checked on 8 November 2026 on the M4, with ad hoc signed DMGs from commits `461ec0a` and `0ccf8f4` (the same app, plus one log line) and, for the update, `2a77728`, all built on a hosted `macos-15` runner.

**How it works**

- **Why M0 saw only `Exit`:** tao's application delegate doesn't implement `applicationShouldTerminate:`, so AppKit quits without asking anyone.
- **The hook:** `src-tauri/src/mac_quit.rs` adds that method to tao's delegate at startup. Dock Quit, logout and Apple-event quits all arrive there, and it answers `NSTerminateLater` while the page decides.
- **Every route asks the page:** the red button, the Quit item, Cmd+W with no file open and that hook all go through `src-tauri/src/closing.rs` and the native events channel. The window still has no core or plugin permissions, so `getCurrentWindow().onCloseRequested` wasn't needed. An answer is tied to the question's number, so a stale or made-up one does nothing.
- **Menu:** the app has its own Quit and Close items, because Tauri's default items go straight to AppKit. It's otherwise the default menu, until M6.
- **The page's part:** `src/desktop/closing.ts` writes everything typed to the recovery store first, then runs `closeAll`, which asks about unsaved files before closing the others, so Cancel leaves the rest open. Any error keeps the app open.
- **A page that doesn't respond** within 5 seconds lets the app close, since it can't save anything. Recovery has what it last wrote.
- **Restored files:** no command takes a path. `src-tauri/src/tickets.rs` keeps Rust's own list of granted paths in `~/Library/Application Support/com.marcos-a.full/restorable-files.json`, in plain text, and the recovery record holds an opaque ticket. The page can only ask for a native confirmation of a file the user offered earlier, in a chosen language. The dialog's text is Rust's. A ticket opens nothing, and with a missing or unknown ticket the save goes to Save As. If a link or folder has replaced the file, the save is refused.
- **Maximum wait:** on desktop, steady typing reaches the recovery store within 3 seconds, set by `persistMaxWaitMs` on the host.
- **The website's bundle changed by 623 bytes,** for five things in shared code, none of which it reaches differently: `closeDoc` reusing a close already in progress, which a dialog already prevents on the web; the order in `closeAll`, which the website never calls; the maximum wait, which its host doesn't set; a catch for `SaveCancelled`, which only the desktop host throws; and an optional `nativeTicket` on native records.

**In CI, on the macOS runner**

- A real Apple event quits the packaged app through the hook, and the page answers. The log shows `AppKit asked, Ask(1)`.
- A file sent to the running app arrives.

**On the Mac**

Marcos ran the written steps:

- **Red button, Cmd+Q and Dock Quit:** Cancel, Don't save, Save and a failed Save on a read-only file each behave as written, in all 15 rounds.
- **Logout is held back.** Cancel in full stops it, and macOS then shows `"full" interrupted logout` with Cancel and Try Again. Its Cancel stays logged in, and its Try Again asks full again, which the log shows as a second question. Save writes the file and the logout finishes.
- **Cmd+W** closes the file and leaves the window, asks first if there are unsaved changes, and closes the window when no file is open.
- **Option+W** held for 2 seconds shows one dialog, and the app stays open.
- **Force Quit recovery, offline (scenario 6):** the edit is offered, and the first save shows the native alert with the full path. Its Cancel writes nothing. Its Save writes the file, and later saves don't ask again. Save As writes the new file and leaves the original.
- **`kill -9` during steady typing:** all 38 characters came back. Typing probably stopped just before the kill, so this doesn't separate the maximum wait from the normal debounce. The Playwright test in `e2e/native.spec.ts` covers the maximum wait.
- **An update keeps recovery:** after a Force Quit, installing a build numbered `0.1.1` over `0.1.0` still offered the work, and the native alert still named the path.

**What can't be held back**

Force Quit, `kill -9`, a crash and a power cut end the app with no chance to ask. Recovery covers them, up to the last write to its store: half a second after typing stops, and at most 3 seconds during steady typing.

**Not answered**

- **Why Option+W quit the app in M0.** The old build wasn't retested. The likely route is key repeat: a repeated Option+W while the dialog is open isn't intercepted by the page, and could reach the Close Window menu item. That item is gone, and the behaviour didn't appear in M5.
- **A file sent to the app once didn't open,** right after logging back in with full reopened by macOS. It didn't happen again on the same path, and the cause is unknown.

Option+W with no file open does nothing, by decision: only Cmd+W closes the window. Not checked: how long macOS lets an app hold back a logout.

## M6 Finder and packaging results

Checked from 8 to 11 November 2026 on the M4, with ad hoc signed universal DMGs from commits `134c03c` and `52a2de0`, and `563745f`, the same app rebased onto `main`. All were built on a hosted `macos-15` runner with Tauri 2.12.5.

**How it works**

- **File types:** `tauri.conf.json` declares Markdown (`.md`, `.markdown`) through `net.daringfireball.markdown` and CSV through `public.comma-separated-values-text`, both at the Default rank, and exports no type ([corrections 11 and 13](#tauri-details)). `.txt` is declared by its extension alone, at the Alternate rank ([correction 14](#tauri-details)). Declaring `public.plain-text` would also have offered full for every kind of source code, which it can't open.
- **CI asks macOS itself** which apps it offers, with `scripts/mac-check-file-types.swift`. full is offered for `.md`, `.markdown`, `.csv` and `.txt`, isn't the default for `.txt`, and isn't offered for `.py`, `.c`, `.swift`, `.json`, `.xml`, `.html`, `.log`, `.tsv`, `.rtf` or `.png`.
- **Document icons:** Tauri has no field for them, so `src-tauri/Info.plist` repeats the file types with an icon for each, and replaces what Tauri writes. A unit test keeps the two the same. `scripts/make-mac-icons.mjs` draws the icons from `public/icon.svg`, and the app icon now leaves the margin macOS expects, so it's the same size as its neighbours in the Dock.
- **Menus:** `src-tauri/src/menu_table.rs` lists every item, its words in English and Catalan, and its shortcut. The page only says which items apply and in which language, through `update_menu`, so it can't relabel anything. A click reaches the page as one of its existing commands, over the native events channel. Close and Quit stay the app's own items and are always on, and a test keeps Tauri's predefined Quit and Close Window out.
- **Editing items:** Undo, Redo and Select All are the app's own. In a text field they use WebKit's own editing, and elsewhere they run the file's or the table's commands. Cut, Copy and Paste are AppKit's. While a dialog is open, only the editing items are on. Cmd+N is on New File…, which the page runs since `31bb275`.
- **Universal build:** CI checks that the binary holds both architectures, and starts the Intel half under Rosetta until the page reports ready. Marcos approved shipping Intel with no Intel performance gate, an exception to the report's section 3.4, which asks for an Intel reference Mac. No one has run it on an Intel Mac.
- **Oldest macOS: 15.0.** GitHub retired its macOS 14 runners on 2 November 2026, so 15 is the oldest version CI can start the app on. The page reaches ready there, which includes `navigator.locks`, so it needs no guard.
- **Measuring:** started with `FULL_TIMINGS` set, the app prints launch, open, typing and save times to its own stderr, and nothing leaves the Mac. Otherwise it measures nothing. Typing reports also say what was running during each slow frame. The two new commands, `update_menu` and `report_timing`, take no path.
- **The website's bundle didn't change:** `dist/` is byte-identical to `main`'s, and no shared code changed.

**Budgets**

On the M4, from the packaged universal build, started by running its binary directly.

| Budget | Target | Result | Verdict |
|---|---|---|---|
| Warm launch to a usable window | p95 ≤ 1.0 s | 394–411 ms over 10 launches | Met |
| Cold launch, after `sudo purge` | p95 ≤ 2.0 s | 1,708–1,920 ms over 5 launches | Met, narrowly. `purge` empties the disk caches, which isn't a restart |
| 1 MB Markdown, open to editable | p95 ≤ 500 ms | Source pane: 117–193 ms over 6 opens. Rendered side: 1,589–1,732 ms | Met for the source pane, which is editable first. The rendered side fills in after it |
| Typing in a 1 MB Markdown file | No long task ≥ 50 ms from desktop code; latency below 16 ms where feasible | Latency p50 13 ms, p95 21 ms, worst 85 ms. 11 frames over 50 ms, the worst 58 ms | Met for desktop code: every slow frame overlapped shared Markdown rendering (10) or the shared recovery check (2), and none the menu or persisting |
| Save of a 1 MB file | Interactive; progress only past 150 ms | 15–19 ms | Met |

- **The 1 MB file that looked slow in M0** was the rendered side. The source pane is editable long before it fills, and typing works meanwhile, because parsing yields between sections.
- **The cold launch excludes the first launch after installing,** when macOS checks the app, as the budget allows.

**On the Mac**

Marcos ran the written steps:

- **Menus:** every File, View, Table and Window item acted once, check marks followed the view, and the menus changed to Catalan and back. Cmd+W, Cmd+Q and Dock Quit still asked about unsaved work. Select All did nothing on a table in `52a2de0`, which `563745f` fixes. In `563745f`, Select All selects the whole table, a cell's text while editing it, and the palette's text, and ⌘N sits on New File….
- **A clean user, offline (scenarios 2, 3 and 7):** in a new standard account with Wi-Fi off, Open With lists full for `.txt` without making it the default, and not for `.py`. A double-click on a file with full closed opens one window, and a second double-click adds a tab to it, with one copy running. Open With works the same way, cold and warm. A drop of two Markdown files and a `.py` opens the first two and names the third. A save offline reaches the disk.
- **The failed Finder open from M5** didn't happen again.

**Not answered**

- **Typing with five 1 MB files open** had a frame of 203 ms in the first run, before the app reported what slow frames overlapped. It wasn't repeated, and it isn't part of the budget.
- **Finder drop feedback within 100 ms** wasn't timed. M3 judged it by eye.
- **Intel and macOS 15 by hand:** CI starts the app on both, but no one has used it there.

**After M6: any text file on the Mac**

On 11 November 2026 the Mac app started opening any text file, as the website already did, following Marcos's choice of "any text file, with safeguards" on 9 November.

- **Grants:** any regular file the user offers can be read. A link still has to lead to one of the four original types, so a link named `notes.md` can't stand in for something else. No command takes a path, as before.
- **Writing:** the first write to a file of any other type, including putting a deleted one back, needs a yes in a native dialog that names the path. `Grants::write_expecting` enforces it, so a script in the page can't skip the dialog. Choosing the file in the Save panel, or confirming a restored file, counts as that yes.
- **Finder:** a fifth file type declares `public.text` at the Alternate rank, so Open With and Get Info offer full for source code, HTML, JSON and so on, and it's never the default by itself. It has its own unlabelled document icon. CI checks that full is offered for those types, isn't the default for `.txt`, `.py` or `.html`, and isn't offered for images, PDFs or archives.
- **Save panel:** for a name outside the four types, it sets no type filter, so the name stays as typed. That this holds in a real panel hasn't been checked on a Mac.

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
17. **Automated macOS end-to-end is limited.** `tauri-driver` doesn't support it. Tauri's docs describe a WebdriverIO route that compiles `tauri-plugin-wdio-webdriver` into the app. They say nothing about its maturity, and it must never reach a release build. M2 decided against this route for now: see the [roadmap](../../ROADMAP.md#design-decisions).
18. **Minimum Tauri version.** Use 2.11.1 or later. The [origin-confusion advisory](https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9) (CVE-2026-42184, medium) affects up to 2.11.0. It names Windows and Android, so it doesn't affect the Mac app directly, but it matters for the later ports. The newest 2.x at the audit date is 2.12.5 (21 October 2026). Tauri 3 is in alpha, and GitHub marks its latest alpha as the repository's latest release, so pin `2.x` explicitly and don't take "latest" on trust. The single-instance plugin needs Rust 1.90 or later.

### Performance

The report's budgets are fine as targets. These existing behaviours are the likely problems to measure first:

- **`refreshRecovery` reads every record in full** every 5 seconds and on every focus ([workspace.ts:157](../../src/doc/workspace.ts#L157), [:715](../../src/doc/workspace.ts#L715)), including all open documents' bytes and text, just to build a list. With one window, desktop needs this only at startup and after a restore or discard, so it can skip the polling. That needs no web or schema change.
- **Each persist rewrites the whole record**, including `originalBytes`. Splitting the store would mean a schema migration, so do it only if a large-file measurement justifies it.
- **`detectAndDecode` runs on the main thread**, and only large CSV parsing uses the worker. There is no cancellation either, so the report's "retain cancelability" isn't available without new work.
- **A single 1.33 MB bundle.** Lazy-loading Milkdown is the obvious option if launch misses its budget.

## Sources

Tauri 2: [WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/), [configuration](https://v2.tauri.app/reference/config/), [CSP](https://v2.tauri.app/security/csp/), [file associations and `RunEvent::Opened`](https://v2.tauri.app/learn/mobile-file-associations/) (covers macOS despite the URL), [single-instance](https://v2.tauri.app/plugin/single-instance/), [macOS signing](https://v2.tauri.app/distribute/sign/macos/), [releases](https://v2.tauri.app/release/). Also the [custom-scheme service worker issue](https://github.com/tauri-apps/tauri/issues/13031), which is one more reason not to add a service worker.
