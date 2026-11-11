<p align="center">
  <a href="https://full.marcos-a.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="public/logo-lockup-on-dark.svg">
      <img src="public/logo-lockup-on-light.svg" alt="full" width="230">
    </picture>
  </a>
</p>

<h3 align="center">The whole file, exactly as you left it.</h3>

<p align="center">
  Open, read, edit and save CSV, Markdown and text files, right in your browser.<br>
  <a href="https://full.marcos-a.com"><strong>Open the app</strong></a>
</p>

<p align="center">
  <strong>English</strong> · <a href="README.ca.md">Català</a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/markdown-dark.png">
  <img src="docs/screenshots/markdown-light.png" alt="A Markdown file in full, with its source on the left and the rendered document on the right">
</picture>

<br>

## Why "full"

**full** — Catalan for *sheet*: *un full* for your notes, *un full de càlcul* for your spreadsheets. The mark is an F that is also that sheet, with one corner folded. The file is the whole point, and everything else stays out of its way.

| **All of it** | **Only it** | **Only yours** |
|:---|:---|:---|
| What you didn't change stays byte for byte: quotes, encoding, line endings, the lot. Editing a cell rewrites that one field. | The file fills the window. There are no toolbars or decoration, just quiet tones with one accent colour. | Files stay in your browser. There is no account and no upload, and an abrupt close doesn't lose your work. |

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/csv-dark.png">
  <img src="docs/screenshots/csv-light.png" alt="A CSV file in full's table view, with a row selected and its menu open">
</picture>

## What it does

- **Tables:** a CSV grid that handles 100,000 rows. Select, resize, fit, insert, delete and drag rows and columns as you would in a spreadsheet. Semicolons, comma decimals and Windows-1252 from Spanish and Catalan Excel exports work with no configuration.
- **Markdown:** source and rendered views side by side, both editable, with one shared undo history. The source text is always the single source of truth.
- **Text:** a plain editor with line numbers, search and word wrap.
- **Code:** Python, JavaScript, TypeScript, HTML, CSS, C, C++, Java, Rust, Go, PHP, JSON, YAML, XML, SVG and shell scripts open in colour, chosen from the file's extension. In HTML, XML, SVG and PHP, typing `</` finishes the closing tag. Very large files, and files with very long lines such as minified ones, open plain to keep typing instant.
- **Faithful saving:** UTF-8, UTF-16 and Windows-1252 are detected and kept, along with any BOM and the line endings. A character the encoding can't hold stops the save and asks what to do.
- **Recovery:** up to 10 abruptly closed files wait for you at the next launch, with or without unsaved changes.
- **Deleted files:** in Chrome, Edge and the Mac app, if a file you have open is deleted from disk, its tab goes back to unsaved within a couple of seconds, closing it asks first, and Save puts it back where it was.
- **New files:** start writing at once in an unnamed file, and choose its name and type only when you save it, even while others are waiting to be recovered.
- **Your colours:** light and dark themes that follow your system, and five accent tones.
- **Your language:** the interface is in English or Catalan, following your browser.

The few exceptions to "byte for byte" are listed under [Known limitations](#known-limitations). [docs/original-spec.md](docs/original-spec.md) is the original brief; later decisions go beyond it. The product name lives only in [src/config.ts](src/config.ts).

## Keyboard

| Action | Keys |
|---|---|
| Command palette | Cmd/Ctrl+K |
| Open file | Cmd/Ctrl+O |
| New file | Alt+N, and also Cmd+N in the Mac app |
| New Markdown, CSV or text file | Alt+M, Alt+C, Alt+T |
| Save, Save As | Cmd/Ctrl+S, Cmd/Ctrl+Shift+S |
| Undo, Redo | Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z |
| Select all text | Cmd/Ctrl+A |
| Close file | Alt+W |
| Grid: edit a cell | Enter, F2, or start typing |
| Grid: new line inside a cell | Alt+Enter |
| Grid: select row, column, all | Shift+Space, Ctrl+Space, Cmd/Ctrl+A |
| Grid: move rows or columns | "Move selected…" commands in the palette |
| Grid: resize column or row | Alt+Shift+Arrow keys, or drag its edge |
| Grid: fit column or row to its content | Double-click its edge |
| Grid: insert or delete selected rows or columns | Cmd/Ctrl+Alt+=, Cmd/Ctrl+Alt+- |

Every command is in the palette and in the menu at the end of the tab bar. The start screen and the menu's tooltip both show the palette's shortcut, though touch screens don't get the start screen hint.

The + button at the end of the tab bar lists the ways to open or create a file. A new file opens without asking anything: "New file", on the start screen, in that menu or in the palette, gives you an empty tab called "untitled" to type in. It stays there, protected by recovery, until you save it or discard it. The extension you give it when saving decides whether it carries on as Markdown, CSV or text. In a browser, saving with no extension shows a warning you can go past or turn off, and any text file opens, as plain text if its extension is missing or unfamiliar. Binary files such as images are refused. The Mac app adds `.txt` instead of saving without an extension, and only opens CSV, Markdown and text files, for security. To start with a type already chosen, use "New Markdown file", "New CSV file" or "New text file". A new CSV opens as a small table, using semicolons where the locale's decimal mark is a comma, plus CRLF and a UTF-8 BOM so that Excel reads it correctly. Files pending recovery stay in the list until you restore or discard them, so you can open or create other files first.

Choose an accent tone (violet, the default, or blue, green, orange or coral) with the dot in the status bar. It applies to both themes, the logo, the tab icon and the colours of Markdown files, and is remembered. Safari and installed-app icons stay violet, because they use fixed image files.

The app follows the system's light or dark setting. The half-circle button in the status bar switches to the other theme and remembers the choice. Switching back to the theme the system has returns to following the system, as does "Theme: follow system" in the palette.

The interface uses the first of your browser's languages that it has, English or Catalan, and English otherwise. To change it, click the language label (EN or CA) in the status bar, or use "Language: English" or "Language: Català" in the palette. The choice is remembered, and picking your browser's language returns to following the browser.

In the grid, click a row number or column letter to select it, and drag across several to select them. Shift+click extends the selection and Cmd/Ctrl+click adds or removes separate rows or columns. Drag from inside a selection to move all of it, and press Escape to cancel. With several selected, dragging or double-clicking the edge of any of them resizes them all. Right-click for a menu to insert, delete, fit or set an exact size; on a touch screen, tap. Row heights and column widths only change the view and are never saved in the file, and undo takes a resize back like any other change.

## Browser support

| Browser | Save | Save As |
|---|---|---|
| Chrome, Edge | Overwrites the original file | Native save dialog |
| Safari, Firefox | Downloads a copy, labelled "Download" | Download with an editable name |

HTTPS or `localhost` is required: saving over files, Web Locks and the async clipboard only work in a secure context.

## Privacy and shared computers

The app makes no requests containing file content, and has no analytics or external error reporting. Remote images in Markdown are blocked until you run "Load remote images" for that file, because loading them reveals your IP address to those hosts.

**Recovery data is stored unencrypted in the browser profile**, including files you never edited. On a shared computer, run "Clear all recovery data" from the recovery list when you finish, which removes it entirely. Files still open in another tab are not affected until that tab closes.

---

## Development

Node and browsers aren't needed on the host: [scripts/in-docker.sh](scripts/in-docker.sh) runs any command in the Playwright image.

```sh
scripts/in-docker.sh sh -c 'mkdir -p /tmp/home && npm ci'
scripts/in-docker.sh npm test                 # unit tests (Vitest)
scripts/in-docker.sh npm run test:e2e         # Chromium, Firefox, WebKit
scripts/in-docker.sh npm run test:perf        # timing targets, on an otherwise idle machine
```

Both Playwright commands build first, then test that production build through `vite preview`, under the real Content Security Policy. They start their own servers and stop if the ports are already in use, so they can't end up testing another checkout. To check the deployed site instead:

```sh
BASE_URL=https://full.marcos-a.com scripts/in-docker.sh npx playwright test --project=chromium e2e/privacy.spec.ts
```

`test:e2e` also runs the save flows on WebKit against a stand-in for the desktop app's native file access. `npm run build` compiles it into a separate `dist-native-fake/` bundle, which never reaches the website.

The Mac app is in progress; see the [roadmap](ROADMAP.md). It uses Tauri 2 and the same frontend as the website: the native side is in `src-tauri/` and its entry point in `src/desktop/`. Its bundle goes to `dist-desktop/`, which never reaches the website, and is packaged inside the app, so the app never loads the deployed site.

The Mac app is a universal build, for Apple Silicon and Intel Macs, and needs macOS 15 or later. It has only been tried by hand on Apple Silicon. Finder offers it for Markdown and CSV files, and under Open With for `.txt` files, without making it the default for plain text. Its menus run the same commands as the palette, in English or Catalan to match the app.

For a small private beta, the DMG from CI can be passed around as it is. It has an ad hoc signature, so macOS refuses to open a downloaded copy until it's notarized in M7. Testers drag `full.app` into Applications and then run `xattr -dr com.apple.quarantine /Applications/full.app` in Terminal, which tells macOS to skip that check for this app only. They should only do this for a build they got from you.

In the Mac app, closing the window, Cmd+Q, Dock Quit and logout all ask about unsaved files first. Force Quit, a crash or a power cut can't be held back, and recovery covers those: it has everything up to half a second after you stop typing, and at most 3 seconds behind during steady typing. To save a restored file back over the original, the app asks with a native confirmation naming the path. For that it keeps a list of the paths of files it has opened in `~/Library/Application Support/com.marcos-a.full/`, in plain text.

Builds run on GitHub Actions in [desktop.yml](.github/workflows/desktop.yml), on every push to a `desktop-*` branch, or from the Actions page once the workflow is on `main`. It tests the native code, builds a universal DMG and checks that the built app starts, under Rosetta too. It also asks macOS which file types it would offer the app for. It produces `full-dmg-<commit>`, and `full-inspector-dmg-<commit>`, the same app named "full inspector" with Web Inspector on, for reading console errors on a Mac. Both have an ad hoc signature, so they're for testing only. The DMG names end with the commit too, so an old download can't pass for a new one.

On a Mac with Rust and the Xcode tools, use `npm run desktop:dev`, `desktop:build` and `desktop:test`.

With Node 24 or later installed, `npm run dev` starts a dev server. Use the same versions for tests: older Node releases such as 22.16 decode Windows-1252 wrongly, which fails the encoding tests even though browsers are fine. Over SSH, use a tunnel to `localhost` so that the page stays a secure context.

README screenshots come from the current build and use sample data, so retake them whenever the interface changes:

```sh
scripts/in-docker.sh npm run docs:screenshots
```

The Playwright version in `package.json` and the image tag in `scripts/in-docker.sh` must match.

## Deployment

The site runs as an nginx container that serves the built files, bound to a localhost port behind the host's reverse proxy, which handles TLS. The image is built entirely in Docker.

| Setting | Default | Variable |
|---|---|---|
| Host port | `8098` | `HOST_PORT` |
| Container name | `full-web` | `CONTAINER_NAME` |
| Image | `full-web:local` | `IMAGE_NAME` |

**First deployment:** point the reverse proxy at the port, for example with Caddy:

```caddyfile
full.marcos-a.com {
	reverse_proxy 127.0.0.1:8098
}
```

**Deploy or update:**

```sh
git pull
scripts/deploy_production.sh
```

The script refuses uncommitted changes, builds the image with the commit SHA, starts the container, writes the build metadata and checks that the container answers. Security and cache headers are set in [deploy/nginx.conf](deploy/nginx.conf) and [deploy/security-headers.conf](deploy/security-headers.conf).

**Roll back:**

```sh
git checkout <commit>
scripts/deploy_production.sh
git checkout main
```

**Keep the origin stable.** Recovery data belongs to the origin, so changing the domain, subdomain or port leaves it behind.

## Build information

The status bar shows the deployed commit, such as `Build 05f2e39`, or `v1.0.0 · 05f2e39` once a release exists. If the metadata is missing it shows `Build unknown`, and the app works normally. The full metadata is at `/build-info.json`.

The deploy script writes that file to `build-meta/` on the host, which the container mounts read-only. Deployments don't create releases. After publishing a GitHub release, update what's shown without rebuilding:

```sh
scripts/write-build-info.sh "$(git rev-parse HEAD)"
```

The Mac app's build writes the same file into its bundle, with `desktop` as the environment and no release until the app has one published. Its version number, `0.1.0` for now, comes from `package.json` and shows in Finder.

`build-env.sh` and `update-release-info.sh` are copies from the shared `app-build-info` convention, so change them there rather than here.

## Brand assets

The icons, logos, wordmarks and web manifest are in [public/](public/).

## Tests and manual checks

The Playwright suite covers each acceptance criterion in section 11 of the [original brief](docs/original-spec.md); test names start with its number, such as `AC14`. Tests tagged `@cross` also run on Firefox and WebKit.

Native file dialogs can't be automated, so the "overwrite the original" tests stub only the pickers and write through real `FileSystemFileHandle` objects from the browser's private file system. These checks need a real browser and are still to be run:

| Check | Steps | Result |
|---|---|---|
| Overwrite after permission | In Chrome or Edge: open a file with the button, edit, save, accept the prompt, then check the file on disk | Not yet run |
| Drop keeps its handle | In Chrome or Edge: drag a file from the desktop, edit, save, and check that it overwrites with no save dialog | Not yet run |
| Permission after restore | Restore a file after a crash and save: it should ask for permission, and fall back to Save As if refused | Passed in Edge: saving over the file after allowing, and the Save As fallback |
| Paste into spreadsheets | Copy a range and paste it into Excel, Google Sheets and Word; copy from Excel and paste it into the grid | Not yet run |
| Dead keys | On a Spanish or Catalan keyboard, type `à` straight into a selected grid cell. The test composes text through Chromium and sends no real key | Passed on a real keyboard in Safari, Chrome and the Mac spike |
| Real Safari | Repeat the main flow in Safari. Automated runs use Playwright's WebKit build | Not yet run |
| Mac app shell | With the network off, start the Mac app; in the inspector build, check the Console for CSP violations; click web and mail links | Passed on macOS 26.7.1, build `fd4494c` |
| Mac app open | With the Open panel, Finder drops and `open -a`, open supported, unsupported and already open files; from the inspector build's Console, try to read a path | Passed on the M4, build `b819dad`. A real double-click and Open With passed in M6 |
| Mac app save | Edit and save over originals, including in an iCloud folder; change a file from another app and try each conflict choice; save a read-only and a locked file; check that mode, tags and creation date survive | Passed on the M4, build `8906b37` |
| Mac app close and quit | With the red button, Cmd+Q and Dock Quit, try Cancel, Don't save, Save and a failed Save; log out with unsaved work; check Cmd+W and Option+W; Force Quit, restore offline and save; install a higher version over it and restore | Passed on the M4, builds `461ec0a` and `0ccf8f4`, and `2a77728` for the update |
| Mac app in Finder | In a new macOS user with Wi-Fi off, double-click a file with the app closed and another with it open; use Open With, cold and warm; check that `.txt` offers the app without it being the default, and `.py` doesn't; drop supported and unsupported files together; save | Passed on the M4, build `52a2de0` |
| Mac app menus | Use every File, View, Table, Edit and Window item, including Select All on a table and in a cell; switch the app to Catalan; check that Cmd+W, Cmd+Q and Dock Quit still ask | Passed on the M4, builds `52a2de0` and `563745f` |
| Deleted file | With a saved file open in the Mac app and in Chrome or Edge, delete it, move it to the Trash and rename it, with the app in front and behind. The tab should go unsaved, closing should ask, and Save should put it back. In Chrome, check whether it comes back at the same path or goes to Save As | Not yet run |

## Known limitations

- **Mixed line endings:** files keep their exact bytes until edited. The first saved edit in a source editor may convert them to the dominant style, and the status bar warns about this. Grid edits don't convert them.
- **Multi-line CSV cells in raw view:** a CRLF file with LF inside quoted cells counts as mixed, so editing it in raw view may convert those. Editing it in the grid doesn't.
- **Rendered-side edits reformat:** they regenerate the file's Markdown, as the warning says. It doesn't appear for never-saved or empty files, which have no existing formatting to protect. Front matter and the final-newline state are kept, and undo restores the exact previous text.
- **Undo in CSV:** the grid and raw view have separate histories. Changes made in raw view arrive in the grid as one undo step, and leaving raw view clears its own history.
- **Moving columns in uneven rows:** a row shorter than the moved column stays as it is. Otherwise it gains only the empty fields needed to keep its values in the right columns.
- **Undo after restoring:** undo history doesn't survive a restore or an encoding change.
- **Very large Markdown:** rendered-side edits serialize the whole document, so in a 1 MB file they lag behind typing, by design without ever losing text. Source-side typing isn't affected. Files over 100 KB parse section by section, and stay whole if they contain anything that can span sections, such as reference links or HTML comments.
- **Relative images and links:** relative image paths show a placeholder, because a browser page can't read neighbouring files. Relative links don't navigate.
- **Task checkboxes** in the rendered side are drawn with CSS, so they toggle by mouse only. Their text can be edited by keyboard, and so can the `[x]` in the source.
