# Roadmap

Where full is going and in what order. Tasks for the current milestones are in [TODO.md](TODO.md).

## Now: full for macOS

A native Mac app built with Tauri 2, from the same frontend as the website. It adds what a browser can't do: double-click a file in Finder, save over the original in any case, and work fully offline.

The website stays as it is and keeps deploying the same way. The app bundles its own copy of the frontend and never loads the deployed site.

- **Feasibility:** feasible, a good fit. See the [audit](docs/desktop/repository-audit.md).
- **Detail:** the [implementation report](docs/desktop/implementation-report.md) has the flows, budgets and acceptance matrix. The audit corrects it in 18 places and takes precedence.
- **Rough effort:** 3 to 4 focused weeks in total, plus waiting on Apple. M0 removed the biggest risk, recovery, and added work to M5, so the total stays the same.

| Status | Milestone | Needs a Mac | Rough effort |
|---|---|---|---|
| Done | [M1 Prepare the shared code](#m1-prepare-the-shared-code) | No | 2–3 days |
| Done | [M0 Spike](#m0-spike-on-a-real-mac) | Yes | 1–2 days |
| Done | [M2 Committed shell](#m2-committed-shell) | Yes | 1–2 days |
| Done | [M3 Open](#m3-open) | Yes | 3–4 days |
| Done | [M4 Save](#m4-save) | Mostly | 3–4 days |
| Done | [M5 Close, quit and recovery](#m5-close-quit-and-recovery) | Yes | 3–5 days |
| Done | [M6 Finder and packaging](#m6-finder-and-packaging) | Yes | 2–3 days |
| Partly done | [M7 Public release](#m7-public-release) | Yes | 2–3 days |

Every milestone also has to pass the web gate: build, unit tests, `test:e2e`, and `test:perf` when shared code changes.

### M0 Spike on a real Mac

Wrap the built `dist/` in a throwaway Tauri shell and answer the questions only `WKWebView` can answer. Finished on 7 November 2026. IndexedDB survived every quit that was tested, so recovery doesn't need a native store. The [audit](docs/desktop/repository-audit.md#m0-spike-results) has the results, and what wasn't answered.

### M1 Prepare the shared code

Add the seam between the app and the platform, with no change in website behaviour. It can ship to the website by itself. It did, in `ecef218`.

**Done when:** `workspace.ts` no longer calls browser file APIs directly, the existing tests pass with at most helper changes, and a new test runs the save flows against a fake native host on WebKit. That restores coverage for the 10 tests that only run on Chromium today.

### M2 Committed shell

Add `src-tauri/`, a real version number, the CSP, minimal capabilities, `desktop:*` scripts, build info in the status bar and safe external links. Add `src-tauri/` to `.dockerignore` and `src-tauri/target/` to `.gitignore`, otherwise deploys would send gigabytes of build output to Docker.

Finished on 7 November 2026. The [audit](docs/desktop/repository-audit.md#m2-shell-results) has the results from the Mac.

**Done when:** the app launches on a Mac with the network off and shows the UI with no CSP violations. The web build has no Tauri code, checked by a search of `dist/`. The WebdriverIO route is decided: see [Design decisions](#design-decisions).

### M3 Open

Rust grant registry, native picker, native drop (M0 confirmed `WindowEvent::DragDrop` gives the full path), and Finder cold and warm opens through `RunEvent::Opened`.

Finished on 8 November 2026. The [audit](docs/desktop/repository-audit.md#m3-open-results) has the results from the Mac.

**Done when:** mixed drops, duplicates and unsupported files behave as on the web, and Rust tests prove a path the user never offered can't be read.

### M4 Save

Save and Save As, atomic replace that keeps metadata, revision checks, conflict dialog with Reload on desktop, failure handling.

Finished on 8 November 2026. The [audit](docs/desktop/repository-audit.md#m4-save-results) has the results from the Mac.

**Done when:** scenarios 1, 4 and 5 of the report's section 11 pass, Rust tests cover failures in real temp directories, and mode, tags and creation date survive a save.

### M5 Close, quit and recovery

Close and quit handling through a new "close all" flow in shared code, a flush that's awaited before exit, restoring with the native path, and a Rust-owned re-grant on first save.

Finished on 8 November 2026. Cmd+Q, Dock Quit and logout can all be held back, through a method added to tao's application delegate. Force Quit, a crash and a power cut can't, and recovery covers them. The [audit](docs/desktop/repository-audit.md#m5-close-results) has the results from the Mac, and what wasn't answered.

**Done when:** closing and each quit path that can be held back are verified with Cancel, Don't Save, Save and failed Save. Any path that can't be held back loses no work to recovery, and the docs say so. Force Quit recovery works in a packaged build (scenario 6), and data survives an app update.

### M6 Finder and packaging

File associations, app and document icons, native menus using the existing commands, and a universal or Apple Silicon build. Run the launch, open, typing and save budgets on a packaged build, including cold launch and opening a 1 MB Markdown file, which looked slow in M0. Choose the oldest supported macOS, and guard `navigator.locks` if that version needs it.

Finished on 11 November 2026. The app is universal and needs macOS 15 or later, and Finder offers it for Markdown, CSV and, under Open With only, `.txt`. The [audit](docs/desktop/repository-audit.md#m6-finder-and-packaging-results) has the budgets and the results from the Mac.

**Done when:** it installs and works for a clean macOS user (scenarios 2, 3 and 7), budgets are met or an exception is approved, and a small private beta can run with an ad-hoc signature.

### M7 Public release

Developer ID signing, notarization, stapled DMG, and a download link. Update the README and screenshots before tagging, including the "right in your browser" wording, privacy text and the checks table. Say that recovery data stays on the Mac in unencrypted form, as the website already does for browsers, and that the app keeps a plain-text list of the paths of files it has opened, so that restored files can be saved back.

**Done when:** the report's definition of done holds, and a downloaded DMG opens without Gatekeeper warnings on a separate Mac.

Split on 11 November 2026. v0.1.0 is a public download without Apple's signature: the DMG keeps its ad hoc signature, and users remove the quarantine flag themselves, as the [README](README.md#mac-app) describes. What Apple's signature would prove is covered instead by an immutable GitHub release and a build attestation, which show the DMG came from this repository's workflow at a given commit and hasn't changed since. They don't replace Apple's malware scan. Developer ID signing and notarization stay postponed, with the rest of the definition of done.

## Design decisions

Taken in the audit. Change them here if they turn out wrong.

**A small `FileHost` seam, not the report's port.** It fits the web's download mode and permission prompts, which the proposed port can't express:

The interface is in [src/platform/host.ts](src/platform/host.ts), and the web adapter in [src/platform/webHost.ts](src/platform/webHost.ts). `write` takes the revision the file is expected to have. The browser can't check it, so only the native host does.

- **The web bundle stays free of Tauri, because it never imports it.** Each target has its own entry point, chosen by Vite mode: the fake host's is `e2e/native/main.ts`, and M2 adds a desktop one that installs the real host before starting the app. This replaced the planned `define` flag, since there is no shared branch to remove at build time. `e2e/privacy.spec.ts` checks the built bundle.
- **Rust owns grants.** The webview never hands Rust a path to trust. Paths come from native dialogs and native events, and a restored file is only re-granted by a native confirmation, naming a path from Rust's own list and not the page's. The webview holds an opaque grant for each file, and knows the path only for the recovery record and for recognising a file that's already open.
- **Recovery stays in IndexedDB,** unless M0 rules it out. `DocumentRecord` gains an optional native path with no database version bump, so the website's existing records keep working.
- **Testing has three layers:** the existing Playwright suite plus a fake native host, `cargo test` on real temp directories, and written manual checks on a Mac, in the README table the project already uses.
- **No WebdriverIO route for now.** The plugin looks maintained, and it runs on macOS. But what's left for a Mac to prove is native: panels, Finder, quit paths and Gatekeeper. The webview's behaviour is already covered by Playwright and the fake host on WebKit. The cost is a second test stack, plus a WebDriver server compiled into the app that has to stay out of release builds, and its docs show no guard for that. CI launching the built app covers crashes at startup. Reconsider if a bug specific to `WKWebView` gets past those checks.
- **The webview can't leave the app or reach more than it's granted.** The window's capabilities are the app's own commands, with no core or plugin permissions. The dialog plugin is used from Rust only. Rust rechecks links, and a navigation guard keeps the webview on the bundled page, so "Open Link" in the context menu can't replace the app with a remote page.
- **The app's version and its releases are separate.** `0.1.0` is what macOS needs. Test builds show `Build abc1234` in the status bar, and a build made for a public release shows its version, such as `v0.1.0 · 35ff77a`, following the `app-build-info` convention.
- **Direct download only, no Mac App Store.** The sandbox would rule out sibling temp files and path-based recovery.

## Decisions

Settled:

- **Reference Mac:** Marcos's M4.
- **App name:** `full`, in lowercase in Finder and the menu bar, matching the brand.
- **Cmd+W on desktop:** closes the file, with Alt+W also working. It closes the window when no file is open.
- **Bundle identifier:** `com.marcos-a.full`. Changing it later would strand recovery data, like changing the web origin.
- **Intel:** a universal build, with no Intel performance gate. This is an exception to the report, which asks for an Intel reference Mac. Apple has said macOS 26 is the last release for Intel Macs.
- **`.txt`:** offered as an Alternate handler, under Open With but never the default.
- **Apple Developer Program ($99 a year):** not for now. It's only needed for signing and notarization, and v0.1.0 ships without them, with an immutable release and a build attestation instead. Revisit it if Gatekeeper's warnings put people off.
- **Oldest macOS:** 15, the oldest GitHub still runs, so CI starts the app on the oldest version it supports.

Still needed from Marcos:

None for now.

## Later

Not in the first release. Order isn't decided.

- **File watching:** a passive "changed in another app" notice. The check at save stays regardless.
- **Relative images in Markdown on desktop:** the app could read neighbouring files, which the web can't. It would widen the grant model, so it needs its own security review.
- **Window state restore** and **Reveal in Finder.**
- **Auto-update:** only through Tauri's signed updater, with its own security review. Until then, updates are manual.
- **Windows and Linux:** the seam keeps them possible. Each needs its own test pass, and the app isn't described as cross-platform until then. Windows also needs its drag-and-drop mode reviewed.
- **Lazy-loading Milkdown:** do it sooner if launch misses its budget.

Not planned: mobile, a rewrite of the frontend, or a desktop app that loads the deployed site.
