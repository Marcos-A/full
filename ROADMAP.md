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
| Next | [M2 Committed shell](#m2-committed-shell) | Yes | 1–2 days |
| Planned | [M3 Open](#m3-open) | Yes | 3–4 days |
| Planned | [M4 Save](#m4-save) | Mostly | 3–4 days |
| Planned | [M5 Close, quit and recovery](#m5-close-quit-and-recovery) | Yes | 3–5 days |
| Planned | [M6 Finder and packaging](#m6-finder-and-packaging) | Yes | 2–3 days |
| Planned | [M7 Public release](#m7-public-release) | Yes | 2–3 days |

Every milestone also has to pass the web gate: build, unit tests, `test:e2e`, and `test:perf` when shared code changes.

### M0 Spike on a real Mac

Wrap the built `dist/` in a throwaway Tauri shell and answer the questions only `WKWebView` can answer. Finished on 7 November 2026. IndexedDB survived every quit that was tested, so recovery doesn't need a native store. The [audit](docs/desktop/repository-audit.md#m0-spike-results) has the results, and what wasn't answered.

### M1 Prepare the shared code

Add the seam between the app and the platform, with no change in website behaviour. It can ship to the website by itself. It did, in `ecef218`.

**Done when:** `workspace.ts` no longer calls browser file APIs directly, the existing tests pass with at most helper changes, and a new test runs the save flows against a fake native host on WebKit. That restores coverage for the 10 tests that only run on Chromium today.

### M2 Committed shell

Add `src-tauri/`, a real version number, the CSP, minimal capabilities, `desktop:*` scripts, build info in the status bar and safe external links. Add `src-tauri/` to `.dockerignore` and `src-tauri/target/` to `.gitignore`, otherwise deploys would send gigabytes of build output to Docker.

**Done when:** the app launches on a Mac with the network off and shows the UI with no CSP violations. The web build has no Tauri code, checked by a search of `dist/`. Also decide here whether the WebdriverIO route is worth keeping.

### M3 Open

Rust grant registry, native picker, native drop (M0 confirmed `WindowEvent::DragDrop` gives the full path), and Finder cold and warm opens through `RunEvent::Opened`.

**Done when:** mixed drops, duplicates and unsupported files behave as on the web, and Rust tests prove a path the user never offered can't be read.

### M4 Save

Save and Save As, atomic replace that keeps metadata, revision checks, conflict dialog with Reload on desktop, failure handling.

**Done when:** scenarios 1, 4 and 5 of the report's section 11 pass, Rust tests cover failures in real temp directories, and mode, tags and creation date survive a save.

### M5 Close, quit and recovery

Close and quit handling through a new "close all" flow in shared code, a flush that's awaited before exit, restoring with the native path, and a Rust-owned re-grant on first save.

M0 found that only closing the window can be held back with Tauri's events. Cmd+Q, Dock Quit and logout log only `Exit`. Try a custom Quit menu item for Cmd+Q, then find out whether the Dock and logout can be caught natively at all. Also find out why Alt+W quit the app in some M0 runs.

**Done when:** closing and each quit path that can be held back are verified with Cancel, Don't Save, Save and failed Save. Any path that can't be held back loses no work to recovery, and the docs say so. Force Quit recovery works in a packaged build (scenario 6), and data survives an app update.

### M6 Finder and packaging

File associations, app and document icons, native menus using the existing commands, and a universal or Apple Silicon build. Run the launch, open, typing and save budgets on a packaged build, including cold launch and opening a 1 MB Markdown file, which looked slow in M0. Choose the oldest supported macOS, and guard `navigator.locks` if that version needs it.

**Done when:** it installs and works for a clean macOS user (scenarios 2, 3 and 7), budgets are met or an exception is approved, and a small private beta can run with an ad-hoc signature.

### M7 Public release

Developer ID signing, notarization, stapled DMG, and a download link. Update the README and screenshots before tagging, including the "right in your browser" wording, privacy text and the checks table. Say that recovery data stays on the Mac in unencrypted form, as the website already does for browsers.

**Done when:** the report's definition of done holds, and a downloaded DMG opens without Gatekeeper warnings on a separate Mac.

## Design decisions

Taken in the audit. Change them here if they turn out wrong.

**A small `FileHost` seam, not the report's port.** It fits the web's download mode and permission prompts, which the proposed port can't express:

The interface is in [src/platform/host.ts](src/platform/host.ts), and the web adapter in [src/platform/webHost.ts](src/platform/webHost.ts). `write` has no expected-revision argument yet: M4 adds it along with the atomic replace.

- **The web bundle stays free of Tauri, because it never imports it.** Each target has its own entry point, chosen by Vite mode: the fake host's is `e2e/native/main.ts`, and M2 adds a desktop one that installs the real host before starting the app. This replaced the planned `define` flag, since there is no shared branch to remove at build time. `e2e/privacy.spec.ts` checks the built bundle.
- **Rust owns grants.** The webview never hands Rust a path to trust. Paths come from native dialogs and native events, and a restored path is only re-granted by a native confirmation.
- **Recovery stays in IndexedDB,** unless M0 rules it out. `DocumentRecord` gains an optional native path with no database version bump, so the website's existing records keep working.
- **Testing has three layers:** the existing Playwright suite plus a fake native host, `cargo test` on real temp directories, and written manual checks on a Mac, in the README table the project already uses.
- **Direct download only, no Mac App Store.** The sandbox would rule out sibling temp files and path-based recovery.

## Decisions

Settled:

- **Reference Mac:** Marcos's M4.
- **Bundle identifier:** `com.marcos-a.full`. Changing it later would strand recovery data, like changing the web origin.

Still needed from Marcos:

| # | Question | Recommendation | Needed by |
|---|---|---|---|
| 1 | Is `full` the app's name in Finder and the menu bar, or `Full`? | `full`, matching the brand | M2 |
| 2 | Does Cmd+W close the file on desktop? Alt+W only exists because browsers own Cmd+W | Yes, with Alt+W also working. Closes the window when no file is open | M5 |
| 3 | Intel support? Apple has said macOS 26 is the last release for Intel Macs | Ship a universal build if it stays free of extra work, with no Intel performance gate. That needs an exception to the report, which asks for an Intel reference Mac | M6 |
| 4 | Should `.txt` be offered? | Yes, as an Alternate handler: under Open With but never the default | M6 |
| 5 | Join the Apple Developer Program ($99 a year)? Notarization needs it | Yes, but only once M6 proves the app is worth distributing | M7 |

## Later

Not in the first release. Order isn't decided.

- **File watching:** a passive "changed in another app" notice. The check at save stays regardless.
- **Relative images in Markdown on desktop:** the app could read neighbouring files, which the web can't. It would widen the grant model, so it needs its own security review.
- **Window state restore** and **Reveal in Finder.**
- **Auto-update:** only through Tauri's signed updater, with its own security review. Until then, updates are manual.
- **Windows and Linux:** the seam keeps them possible. Each needs its own test pass, and the app isn't described as cross-platform until then. Windows also needs its drag-and-drop mode reviewed.
- **Lazy-loading Milkdown:** do it sooner if launch misses its budget.

Not planned: mobile, a rewrite of the frontend, or a desktop app that loads the deployed site.
