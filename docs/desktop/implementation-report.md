# full — Tauri 2 desktop target implementation report

> Hand-off report, kept as received. It was written without access to this repository, so where it conflicts with the code, [repository-audit.md](repository-audit.md) and [ROADMAP.md](../../ROADMAP.md) take precedence. The "historical `SPEC.md`" it mentions is [docs/original-spec.md](../original-spec.md).

**Audience:** AI coding agent implementing the desktop target  
**Status:** implementation plan, based on a repository-less hand-off  
**Prepared:** 7 November 2026  
**Primary target:** macOS (Apple Silicon and Intel); retain one codebase that can later package for Windows and Linux.

## 1. Decision and non-negotiable boundaries

Add Tauri 2 as an **additional build target** in the existing full repository. Do not rewrite full and do not replace the deployed web application. The existing frontend remains the product UI and document-editing implementation; Tauri supplies a small native host plus a carefully bounded desktop-file adapter.

The result must have two independently usable distributions:

| Distribution | How it runs | File access |
|---|---|---|
| Existing web app | Existing production deployment | Existing browser implementation; preserve behavior and deployment |
| full for macOS | Signed/notarized `.app` / DMG eventually | Native open/save, Finder associations, native drop and lifecycle integration |

Do **not** make desktop mode load the deployed web URL. Bundle the production frontend into the application so it launches, opens existing files, and saves locally with no network connection. The web deployment remains separately built and served.

`SPEC.md` is historical design material for a previous name/implementation. It is useful for intent (CSV/Markdown, preservation, recovery, privacy), but it is **not evidence of full’s current files, libraries, routes, data model, commands, or deployed behavior**. Resolve every discrepancy in favor of the audited repository and document it in the implementation PR.

## 2. Required discovery gate (do this before editing)

This workspace did not contain full’s repository at report time; it had only an empty `sources/` directory and the historical `SPEC.md`. Therefore no claim below about existing files, framework, package manager, test commands, or current behavior is repository-verified. Do not start by applying a guessed tree.

In a clean branch of the real repository, produce `docs/desktop/repository-audit.md` with the following evidence:

1. Record the commit SHA, package manager and lockfile, Node/Rust toolchain constraints, workspace/monorepo layout, and the exact web build/test/typecheck commands.
2. Identify the frontend entry point, bundler, output directory, SPA routing/base-path behavior, static assets, CSP/service-worker/PWA configuration, and environment variables used by production and development.
3. Map document state end-to-end: open/import path, active tabs, dirty tracking, serializer/byte preservation, save/save-as, external-change behavior, recovery/autosave, dialogs/notifications, keyboard shortcut registration, drag/drop, and close confirmation.
4. Inventory supported extensions/MIME types and existing fixtures. Verify actual encoding and newline guarantees rather than importing them from `SPEC.md`.
5. Locate shared core code that can be kept platform-neutral. Identify every direct browser API (`window`, `document`, `File`, File System Access API, IndexedDB, download anchor, `localStorage`, drag events) and each test that mocks it.
6. Run the existing full web quality gate before any change. Capture the baseline result.
7. Verify that bundling a production build locally makes no runtime request to the deployed web origin or a CDN. List any intentional remote resources and decide whether desktop must block or bundle them.

If full is not React/Vite, keep the architecture below but adapt the Tauri `beforeDevCommand`, `beforeBuildCommand`, `devUrl`, and `frontendDist` values to the audited build system. Do not introduce React/Vite merely because the historical spec mentioned them.

## 3. Target architecture

### 3.1 Separate product policy from platform mechanics

The editor must never read a native path, invoke Tauri, or decide how a file picker works. It should consume an application-owned port. Keep all desktop imports in the desktop adapter and bootstrap layer so the browser build cannot accidentally pull native APIs.

```text
editor / document domain (shared, platform-agnostic)
  ├─ DocumentController, dirty state, serializers, recovery policy
  └─ FileWorkspacePort
       ├─ BrowserFileWorkspace       (existing browser semantics)
       └─ TauriFileWorkspace         (native dialog/read/write/stat)
                 └─ narrow Rust commands / Tauri plugins

platform bootstrap
  ├─ web: select BrowserFileWorkspace
  └─ desktop: select TauriFileWorkspace; subscribe to Finder launch/open and native drop
```

Use explicit data types, not `File` objects leaking throughout the domain:

```ts
export type SupportedKind = 'markdown' | 'csv';

export interface FileIdentity {
  /** Opaque outside the adapter. Native adapter currently uses an absolute path. */
  locator: string;
  displayName: string;
  kind: SupportedKind;
}

export interface FileRevision {
  size: number;
  modifiedMs: number;
  // Add a content hash only if timestamp+size proves insufficient in the audited implementation.
}

export interface OpenedDocument extends FileIdentity {
  bytes: Uint8Array;
  revision: FileRevision;
}

export type WriteResult = { revision: FileRevision };

export interface FileWorkspacePort {
  chooseOpen(): Promise<OpenedDocument[]>;
  chooseSaveAs(suggestedName: string, kind: SupportedKind): Promise<FileIdentity | null>;
  read(identity: FileIdentity): Promise<OpenedDocument>;
  stat(identity: FileIdentity): Promise<FileRevision | null>;
  write(identity: FileIdentity, bytes: Uint8Array, expected: FileRevision | null): Promise<WriteResult>;
  reveal?(identity: FileIdentity): Promise<void>;
}
```

Preserve the audited app’s richer metadata (encoding, BOM, line endings, raw CSV fields, original bytes) in its existing document model. The adapter only transports bytes and revisions. An unchanged document must still use the existing no-op / byte-identical policy; never silently normalise text because it crossed the desktop boundary.

### 3.2 Desktop detection

Create a single `isDesktopHost()` module that checks `isTauri()` from `@tauri-apps/api/core`, ideally behind a dynamic import from a desktop bootstrap. Do not sniff user agents or test for `window.__TAURI__` directly. Unit tests should inject the port instead of mocking Tauri globally.

### 3.3 Native boundary: use a narrow command layer

Do not give the webview blanket read/write access to the home directory. The dialog plugin can temporarily scope paths selected by a user, but that scope is not persistent. Prefer a small Rust command layer that owns a per-document grant registry:

- `open_paths(paths: Vec<PathBuf>) -> Vec<OpenedFile>` validates extension, canonicalises safely, reads bytes, records the canonical path as granted, and returns display name, bytes, size and modified time.
- `choose_open() -> Vec<OpenedFile>` presents an `NSOpenPanel` through Tauri’s dialog plugin or Rust API, then delegates to the same open routine.
- `choose_save_as(suggested_name, kind) -> Option<OpenedFileIdentity>` presents a native save panel, validates/normalises the extension only after an explicit user choice, creates no content yet, and grants that destination.
- `read_granted(path)`, `stat_granted(path)`, and `write_granted(path, bytes, expected_revision)` reject paths absent from the in-memory grant registry.
- `reveal_in_finder(path)` is optional, uses a dedicated audited command, and must not expose an arbitrary shell command.

This gives the frontend only the files a user selected, dropped, or opened through Finder. Do not use shell plugin APIs. Do not turn on broad `fs` permissions as a shortcut. If the repository’s threat model needs paths to survive restart, re-grant them only after a user gesture/reopen; a recovery record must never become a silent persistent filesystem capability.

For ordinary files use atomic replacement: write bytes to a unique sibling temporary file with restrictive permissions, flush it, re-stat the target to verify `expected_revision`, then atomically rename/replace it. Return the revision from the resulting target. On an error, retain the original and leave the document dirty. Platform-specific replacement details belong in Rust behind the command; test them. Never write through a symlink without an explicit documented policy; default to reject symlink targets for writes unless the existing app already has an intentional, tested behavior.

### 3.4 Performance is a product requirement, not a later optimisation

full should feel immediate and quiet in the way Sublime Text does: input must win over background work, opening must show useful progress rather than a frozen window, and routine operations must not make the editor visibly hesitate. Tauri is only the host; it does not automatically make a slow frontend fast.

Establish a baseline on the reference Macs selected in the audit (one current Apple Silicon machine and one supported Intel machine if Intel is shipped), in a **packaged release build**, with cold/warm-launch caches clearly stated. Add these initial budgets; tighten them once the audited app has a measured baseline:

| Scenario | Budget / required outcome |
|---|---|
| Warm launch to interactive empty window | p95 ≤ 1.0 s |
| Cold launch to interactive empty window | p95 ≤ 2.0 s, excluding first macOS security scan/install launch |
| Native picker / Finder drop feedback | Visual response within 100 ms; never block keyboard/mouse input while bytes are loading |
| Small document (≤ 1 MB) open to editable view | p95 ≤ 500 ms after native read begins |
| Typing while autosave/recovery is active | no long task ≥ 50 ms attributable to desktop integration; visible input latency stays below 16 ms at 60 Hz where feasible |
| Save of typical text document | UI remains interactive; show compact progress only when operation exceeds 150 ms |
| Large files | stream/read and parse off the UI thread where the current document architecture permits; show progress and retain cancelability; do not promise a size limit without measurement |

Record timings in developer-only performance instrumentation or Playwright/E2E traces, never telemetry. Test both first launch and repeat launch. Do not add a splash screen merely to hide slow initialization; instead defer non-essential restoration, syntax/highlight loading, thumbnail/icon work, updater checks, and filesystem watches until the first window can accept input.

Implementation constraints:

- Keep Rust commands async and move blocking filesystem reads, hashing, conflict comparisons, compression and large serialisation off the webview/UI event loop (`spawn_blocking` or equivalent on the Rust side; Worker on the frontend side where applicable).
- Transfer `Uint8Array`/binary data once; avoid base64 conversion, JSON-stringifying multi-megabyte content, or duplicating a document in React state, recovery state, and command payload simultaneously.
- Retain the audited editor’s incremental rendering/virtualisation. Native integration must not eagerly parse every Finder-opened file or mount every tab’s editor at once.
- Debounce recovery writes, write only changed state, and schedule them after keystrokes/idle time. A recovery operation may never synchronously serialize a large document on every keypress.
- Do not perform a full content hash on the UI thread for every save. Use size/mtime revision checks initially; if stronger identity is required, hash in background and cache by revision.
- Lazy-load desktop-only modules and optional integrations, but keep the first editor bundle and its workers local and available offline. Measure that code splitting improves rather than delays first edit.
- Avoid synchronous dialogs for routine status, repeated filesystem stats, excessive console logging, and unbounded watcher events. Coalesce watcher notifications.

## 4. Tauri 2 integration

### 4.1 Add only after the audit

Use the official Tauri 2 CLI to initialise integration in the audited repository and commit all generated Rust manifests, capabilities and lockfile changes. Use compatible current stable 2.x package versions as one set, pinned by the project lockfile; do not mix tutorials for Tauri 1 with Tauri 2 packages. At implementation time re-check the Tauri release notes and generated permission identifiers.

Expected additions (names may be adjusted to the actual repository layout):

```text
src-tauri/
  Cargo.toml
  build.rs
  tauri.conf.json
  capabilities/default.json
  icons/
  src/lib.rs
  src/main.rs
src/platform/
  FileWorkspacePort.ts
  browser/BrowserFileWorkspace.ts
  desktop/TauriFileWorkspace.ts
  desktop/desktopBootstrap.ts
  desktop/openRequests.ts
```

Add package scripts without altering current web scripts, for example `desktop:dev`, `desktop:build`, `desktop:test:smoke`. They should call the locally installed Tauri CLI through the package manager, not a globally installed binary.

### 4.2 Build configuration

Configure Tauri to run the existing frontend development server in development and to package the existing production build directory in release. The release config must have a real `frontendDist` (or the equivalent current field) and **no remote `devUrl` fallback**. Validate the actual field names against the installed Tauri CLI schema, not this illustrative fragment:

```jsonc
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "full",
  "version": "<read-from-existing-release-versioning>",
  "identifier": "<reverse-DNS-identifier-owned-by-the-project>",
  "build": {
    "beforeDevCommand": "<existing web dev command>",
    "devUrl": "<actual local dev URL>",
    "beforeBuildCommand": "<existing web production build command>",
    "frontendDist": "<actual production output directory>"
  },
  "app": {
    "windows": [{ "label": "main", "title": "full", "width": 1100, "height": 750, "minWidth": 768, "minHeight": 560, "dragDropEnabled": true }],
    "security": { "csp": "<derive from audited web CSP; do not weaken it just for Tauri>" }
  },
  "bundle": {
    "active": true,
    "targets": ["app", "dmg"],
    "fileAssociations": []
  }
}
```

Tauri supports platform-specific config overlays such as `tauri.macos.conf.json`; use them for macOS-only packaging values rather than contaminating shared configuration. It packages the configured frontend distribution into the app bundle, which is the required offline model. See the official [configuration reference](https://v2.tauri.app/reference/config/) and [macOS bundle guide](https://v2.tauri.app/distribute/macos-application-bundle/).

Install the minimum official components necessary for this scope:

- `@tauri-apps/api` / `tauri` core.
- `@tauri-apps/plugin-dialog` only if the selected command design uses the JS dialog plugin. Its `open` and `save` APIs return a path or null; selected paths are dynamically scoped only for the running app. [Dialog API](https://v2.tauri.app/reference/javascript/dialog/).
- `tauri-plugin-single-instance` for a coherent one-app experience. Register it first and route incoming launch arguments/open requests to the existing window.
- Optional, post-MVP: `tauri-plugin-window-state`; do not let restored window state bypass unsaved-work recovery.

Do **not** add an auto-updater to the first desktop milestone unless a signed release/update service is included in the same security review. If added later, use Tauri’s signed updater flow rather than downloading and executing arbitrary files; [official updater documentation](https://v2.tauri.app/plugin/updater/).

### 4.3 Capabilities and CSP

Tauri 2 capabilities are a security boundary. Create a capability scoped to the `main` window with only the exact commands/plugins used. Do not assume `fs:default` permits desktop document reads/writes: its default scope is application-specific directories. Tauri’s permission guidance requires separately granting commands and narrowly scoped paths. [Official permission guidance](https://v2.tauri.app/learn/security/using-plugin-permissions/).

Prefer custom commands for documents, and include only required core permissions (`core:default`, events/window as needed) plus dialog/single-instance permissions. Check the generated schema/permissions in the installed version. Keep web CSP and desktop CSP strict: no `unsafe-eval`, no remote scripts, no blanket `connect-src *`. If CodeMirror or another audited component needs a CSP exception, document its necessity and verify it applies in both builds.

## 5. Native document flows

### 5.1 Open

All of these must funnel through one idempotent `requestOpen(locators, source)` action:

1. **Cmd+O / Open command:** native dialog filters for exactly the extensions verified by the audit (likely `.md`, `.markdown`, `.csv`, `.txt` only if currently supported).
2. **Finder double-click / Open With:** macOS passes file URLs at cold start or while full is running.
3. **Finder drag/drop:** subscribe to Tauri’s native `getCurrentWebview().onDragDropEvent`; on `drop`, feed `event.payload.paths` into `requestOpen`. The modern events are `enter`, `over`, `drop`, and `leave`; always unregister on component disposal. [Tauri webview drag/drop API](https://v2.tauri.app/reference/javascript/api/namespacewebview/).
4. **Existing HTML5 drop:** retain it for browser builds. On desktop macOS prefer native paths so files are not needlessly copied into browser `File` objects. On Windows, review the documented `dragDropEnabled` conflict with HTML5 drop before enabling both.
5. **Application launch with paths:** on macOS handle `RunEvent::Opened`. Store cold-start URLs in managed Rust state before the webview is ready; expose a one-time `take_pending_open_urls` command; emit an event for warm opens. This two-case model is prescribed in Tauri’s [file-association handling guide](https://v2.tauri.app/learn/mobile-file-associations/).
6. **Second application launch:** configure the single-instance callback to bring the existing main window forward and enqueue valid paths. Deduplicate with the same canonical-identity policy used by normal opens.

The request coordinator must:

- Percent-decode file URLs only in Rust and reject non-`file:` URLs.
- Canonicalise identity for duplicate detection, without presenting canonical paths as user-facing names.
- Open multiple valid files independently; show a concise non-blocking error for each unsupported/unreadable one.
- Focus an already open document instead of creating duplicate tabs.
- Read bytes before parsing so the existing decoder/preservation logic remains authoritative.
- Create/update recovery records before rendering, preserving the existing app’s durability contract.

### 5.2 Save and Save As

Implement commands through the shared command layer, keeping current keyboard routing in one place:

| Command | macOS shortcut | Desktop behavior |
|---|---|---|
| Save | Cmd+S | If it has a native identity, conflict-check then atomically write there; otherwise Save As |
| Save As | Cmd+Shift+S | Native save dialog, then write only after serializer/preflight succeeds |
| Open | Cmd+O | Native multi-select dialog |
| Close tab | Preserve current shortcut after audit | Same dirty confirmation contract |

Save preflight order:

1. Ask the existing document serializer for the exact output bytes; do no filesystem work if it returns an encoding or validation error.
2. If unchanged and the audited app’s contract is no-op save, return success without writing.
3. Read/stat the target immediately before write. Compare it to the document’s last known revision.
4. If target differs, show a conflict dialog with **Reload from disk**, **Overwrite**, **Save As**, and **Cancel**. Never overwrite before an explicit choice. `Reload` must itself handle dirty state (discard/merge decision); do not silently lose edits.
5. Atomic write with a final expected-revision check, then update the document’s saved bytes/revision and recovery record only after successful completion.
6. On permission, disk-full, path-disappeared, or atomic-replace failure: keep the tab dirty, retain recovery data, show the native-error-derived message safely, and offer Save As. Never report success from a queued or failed write.

For a `Save As` target that already exists, use the platform’s overwrite confirmation and still run the app’s revision conflict check just before replacement. Preserve encoding, BOM, line endings, CSV raw-token behaviour, and Markdown source truth as verified in the audit.

### 5.3 External changes while open

MVP: compare revision on every explicit save and reload/open action. This is required and reliable.

Recommended follow-up: add native file watching only after the save path is stable. Debounce watcher notifications, ignore the app’s own atomic-write sequence by updating the saved revision first, and show a passive “changed in another application” state. Offer Reload / Compare (if the editor has one) / Keep Mine. A watcher is an early warning, **not** an authorisation to replace the save-time stat check.

If the target was renamed/moved/deleted, mark the binding stale and require Save As or an explicit locate/rebind interaction. Do not search arbitrary directories for a same-named file.

## 6. Finder association configuration

Configure `bundle.fileAssociations` for actual supported formats. Current Tauri can create macOS UTI metadata using `exportedType`, and current Tauri CLI releases added `contentType`/exported type support; validate against the installed schema because this area changed after early Tauri 2 releases. [Tauri configuration reference](https://v2.tauri.app/reference/config/).

Illustrative configuration only—use the exact generated schema and legal project UTI namespace:

```jsonc
"fileAssociations": [
  {
    "ext": ["md", "markdown"],
    "name": "Markdown document",
    "role": "Editor",
    "mimeType": "text/markdown",
    "contentType": "net.daringfireball.markdown",
    "exportedType": {
      "identifier": "<owned-identifier>.markdown-document",
      "description": "full Markdown Document",
      "conformsTo": ["public.plain-text"],
      "tags": { "extensions": ["md", "markdown"], "mimeTypes": ["text/markdown"] }
    }
  },
  {
    "ext": ["csv"],
    "name": "CSV document",
    "role": "Editor",
    "mimeType": "text/csv",
    "contentType": "public.comma-separated-values-text"
  }
]
```

Avoid claiming ownership of `.txt` unless product direction explicitly requires it: doing so changes a broad Finder association and is surprising. File associations are a request to LaunchServices, not a guarantee that full becomes the default application; verify “Open With” and association conflicts on a clean test Mac. Add custom document icons only after correct opening works.

## 7. Recovery and close handling

Keep full’s existing recovery store as the primary shared mechanism if it is browser storage and works under Tauri’s bundled origin. Do not create a second competing desktop recovery system. Audit its crash safety first.

Desktop additions:

- On opening a native document, persist recovery state immediately before parsing/rendering, including the opaque locator/path only if the privacy model permits it. Store current bytes/text and document metadata using the existing recovery policy; paths are sensitive data.
- Debounce autosave at the currently tested interval and flush best-effort on app background/close. Do not claim process-kill durability from a close event.
- Subscribe to `getCurrentWindow().onCloseRequested`. If dirty work exists, call `preventDefault()`, show the existing Save / Don’t Save / Cancel UI, await saves, and only then programmatically force-close through a guarded one-shot path to avoid a loop. The API explicitly supports preventing close to ask for save confirmation. [Window close API](https://v2.tauri.app/reference/javascript/api/namespacewindow/).
- Preserve recovery data until a save has actually succeeded or the user explicitly chooses Don’t Save/Discard. A failed save must leave it recoverable.
- On restart, show recovery records; do not silently re-open every document. A restored record with a former native path is not proof the current file remains unchanged; verify/rebind before any overwrite.
- Test actual forced termination (SIGKILL / Force Quit) separately from a normal window close. Do not rely on `beforeunload` alone.

If recovery currently uses IndexedDB, validate it in a packaged app—not only `tauri dev`—across app upgrades and in offline mode. If the audit finds its quota/reliability insufficient, migrate deliberately to a versioned native app-data store, with import/clear semantics and privacy documentation. That migration is a separate milestone with regression tests, not a Tauri scaffold side effect.

## 8. macOS UX and menus

Use standard macOS conventions:

- Provide native File/Edit/View menus or map them carefully to the existing command registry; keep every command accessible from full’s existing command palette/menu UI too.
- Cmd+O, Cmd+S, Cmd+Shift+S, Cmd+Z, Cmd+Shift+Z should call the same command handlers as buttons/palette, not parallel implementations.
- Do not globally intercept shortcuts when a text editor needs them unless the existing command policy intentionally does so.
- Use the existing application title/dirty indicator if present; otherwise make native-window title changes a small, separately tested enhancement.
- Ship a normal decorated, resizable window first. Custom title bars are out of scope for this milestone.

## 9. Offline, privacy, and security acceptance

The packaged release must work after network is disabled:

- Launch full, create/open/edit/save supported local files, use recovery, reopen through Finder, and render supported local content without a connection.
- Production frontend assets, workers, parsers and editor dependencies are bundled; no production dynamic imports point to the web deployment/CDNs.
- Desktop mode sends no document content to telemetry, error reporting, updater endpoints, remote images, or logs. Scrub paths and content from errors sent to UI/logs.
- Treat document content as untrusted. Retain the current Markdown sanitisation/content security behavior, and do not provide arbitrary `shell.open` / `openExternal` paths from document links.
- Document storage location, recovery retention/clear controls, and the fact recovery copies may be readable by the local OS user.

Performance traces and profiling artefacts must contain synthetic fixtures only, never users’ paths or document contents.

## 10. Implementation sequence

Commit small reviewable milestones. Every milestone runs the original web quality gate as well as its new desktop checks.

1. **Audit and contract:** create the audit, write the platform port interfaces, make existing web adapter conform with no behavioral changes, and add shared unit tests.
2. **Offline shell:** scaffold Tauri 2, configure build/dev correctly, bundle the existing frontend, set minimal capabilities, and prove the web deployment has no changed artifacts or behavior.
3. **Open/read:** implement narrow Rust grants and native dialog; open supported files into existing document flow; add native macOS drag/drop and Finder cold/warm-open routing.
4. **Save:** implement byte-oriented Save/Save As, atomic replacement, revision checks, conflict UI, failure handling, and shortcuts.
5. **Lifecycle/recovery:** close interception and force-quit recovery integration; test packaged build persistence.
6. **Finder package:** file associations, icons, application metadata, one-instance handling, Apple Silicon/Intel builds; manual clean-Mac verification.
7. **Hardening/release:** code signing, notarization, DMG distribution, privacy/readme updates, and a release candidate test matrix. Automatic updates only if intentionally scoped.

## 11. Tests and acceptance matrix

Reuse existing fixtures and add byte fixtures for every currently promised encoding/line-ending rule. Do not replace high-value browser tests with desktop-only tests.

| Area | Automated evidence | Manual packaged-app evidence |
|---|---|---|
| Web preservation | Existing test suite passes unchanged | Existing deployed/web smoke remains unchanged |
| Adapter | Unit tests: correct port selected; editors receive no path API | N/A |
| Open | Rust command tests validate extension/path errors and duplicate identity; frontend coordinator tests multiple/open-existing | Cmd+O; Finder drag/drop; multi-file drop; unsupported mixed drop |
| Finder association | Config/schema validation where possible | Clean macOS user: double-click `.md`, `.markdown`, `.csv`; cold and warm app behavior |
| Save | Command tests for no-op, success, permission/error, atomic-write cleanup | Cmd+S modifies original only after success; Cmd+Shift+S; extension handling |
| Conflict | Unit/integration test revision mismatch reaches exact choice model | Edit in TextEdit while full is open; each Reload/Overwrite/Save As/Cancel path |
| Recovery | Store tests plus forced process-termination test harness | Force Quit within the audited debounce window; relaunch; restore/discard/clear |
| Close | Window-close mock test verifies `preventDefault` and one-shot exit | Close dirty window: Cancel / Don’t Save / Save success / Save failure |
| Offline | Build test asserts no remote runtime URLs | Disable network before launch; all core flows work |
| Security | Capability/config review, malicious-path and symlink tests, no shell access | Inspect prompts/permissions and verify paths/content do not appear in user-visible generic errors |
| Performance | Release-build benchmark/trace records launch, open, type-under-autosave and save budgets | Repeat on the stated Apple Silicon/Intel reference Macs; inspect that long tasks are not introduced |
| Packaging | `tauri build` on macOS for x86_64 and aarch64 (or universal strategy) | Install DMG on a separate Mac, launch normally, Gatekeeper/signing/notarization result |

Minimum end-to-end scenarios required before calling the target complete:

1. Open a real Markdown and CSV document from Finder; save one edit; verify only intended bytes change according to full’s existing preservation contract.
2. Launch full by double-clicking a file while closed, then double-click a second file while it runs: one visible app/window and two correct tabs/documents.
3. Drop multiple supported and unsupported files from Finder; supported files open, unsupported files do not block the rest.
4. Modify the original externally between open and save; prove no overwrite happens before the chosen conflict action.
5. Cause a write failure (read-only destination or controlled command fault); prove document remains dirty and recovery remains available.
6. Force quit after an edit, relaunch offline, restore, then Save As; prove recovered content survives.
7. Build and launch with network disabled; capture that no content leaves the device.

## 12. Release requirements deliberately outside the first code change

The MVP can build an unsigned local `.app` for development. Distribution to other Macs requires a separate release checklist: stable owned bundle identifier, Developer ID Application certificate, hardened runtime, notarization, stapling, DMG signing, and test installation on a clean machine. Unsigned/ad-hoc builds can trigger macOS security warnings; Tauri documents the signing prerequisites in its [macOS signing guide](https://v2.tauri.app/distribute/sign/macos/).

Keep Windows/Linux portable by retaining the adapter and Rust command boundaries. Before enabling those builds, replace macOS-only assumptions: path conventions, file association metadata, drag/drop mode, atomic replacement semantics, signing/installers, and system menu conventions. Tauri supports platform configuration overlays, so each platform can carry only its own packaging settings.

Mobile is not part of this target. Shared document/domain code may be reusable later, but mobile filesystem security and editor interaction must be separately designed.

## 13. Definition of done

The desktop target is complete only when all are true:

- The repository audit is committed and every deviation from this report/historical spec is recorded.
- Existing web build, tests, deployment configuration, and browser file flows remain working and unchanged in behavior.
- A packaged macOS build contains the frontend and completes core workflows offline.
- Release-build performance evidence meets the stated launch/open/input/save budgets (or documents an owner-approved, measured exception) on the declared reference hardware.
- Native open/save/save-as, Cmd shortcuts, Finder associations, Finder drag/drop, cold/warm file opens, single-instance routing, conflict handling, and recovery work as specified and evidenced above.
- File writes are byte-oriented, conflict-checked, atomic where supported, narrowly authorised, and never falsely reported successful.
- No broad filesystem scope, shell escape, undocumented telemetry, or remote frontend dependency was introduced.
- The implementation README documents development, build, test, macOS packaging/signing status, recovery/privacy behavior, supported files, known limitations, and manual validation results.
- The release is not described as cross-platform until its Windows and Linux matrix has separately passed.

## 14. Authoritative references to consult during implementation

- [Tauri 2 configuration](https://v2.tauri.app/reference/config/)
- [Tauri dialog plugin and JavaScript API](https://v2.tauri.app/plugin/dialog/)
- [Tauri security permissions/capabilities](https://v2.tauri.app/learn/security/using-plugin-permissions/)
- [Tauri filesystem plugin reference](https://v2.tauri.app/plugin/file-system/)
- [Tauri native drag/drop API](https://v2.tauri.app/reference/javascript/api/namespacewebview/)
- [Tauri file association handling / `RunEvent::Opened`](https://v2.tauri.app/learn/mobile-file-associations/)
- [Tauri single-instance plugin](https://v2.tauri.app/plugin/single-instance/)
- [Tauri macOS packaging](https://v2.tauri.app/distribute/macos-application-bundle/)
- [Tauri macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/)

These are Tauri 2 references checked on 7 November 2026. Revalidate API names, generated schema, package compatibility, and security permissions after choosing the exact Tauri 2 versions, because those details evolve.
