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

*Full* is Catalan for "sheet", as in a sheet of paper. The mark is an F that is also that sheet, with one corner folded. The file is the whole point, and everything else stays out of its way.

| **All of it** | **Only it** | **Only yours** |
|:---|:---|:---|
| What you didn't change stays byte for byte: quotes, encoding, line endings, the lot. Editing a cell rewrites that one field. | The file fills the window. There are no toolbars or decoration, just quiet tones with one accent colour. | Files stay in your browser. There is no account and no upload, and an abrupt close doesn't lose your work. |

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/csv-dark.png">
  <img src="docs/screenshots/csv-light.png" alt="A CSV file in full's table view, with a row selected and its menu open">
</picture>

## What it does

- **Tables:** a CSV grid that handles 100,000 rows. Insert, delete and drag rows and columns. Semicolons, comma decimals and Windows-1252 from Spanish and Catalan Excel exports work with no configuration.
- **Markdown:** source and rendered views side by side, both editable, with one shared undo history. The source text is always the single source of truth.
- **Text:** a plain editor with line numbers, search and word wrap.
- **Faithful saving:** UTF-8, UTF-16 and Windows-1252 are detected and kept, along with any BOM and the line endings. A character the encoding can't hold stops the save and asks what to do.
- **Recovery:** up to 10 abruptly closed files wait for you at the next launch, with or without unsaved changes.
- **New files:** create Markdown, CSV or text files, even while others are waiting to be recovered.
- **Your colours:** light and dark themes that follow your system, and five accent tones.
- **Your language:** the interface is in English or Catalan, following your browser.

The few exceptions to "byte for byte" are listed under [Known limitations](#known-limitations). [docs/original-spec.md](docs/original-spec.md) is the original brief, written under the working name "Folio"; later decisions go beyond it. The product name lives only in [src/config.ts](src/config.ts).

## Keyboard

| Action | Keys |
|---|---|
| Command palette | Cmd/Ctrl+K |
| Save, Save As | Cmd/Ctrl+S, Cmd/Ctrl+Shift+S |
| Undo, Redo | Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z |
| Close file | Alt+W |
| Grid: edit a cell | Enter, F2, or start typing |
| Grid: new line inside a cell | Alt+Enter |
| Grid: select row, column, all | Shift+Space, Ctrl+Space, Cmd/Ctrl+A |
| Grid: move rows or columns | "Move selected…" commands in the palette |
| Grid: resize column | Alt+Shift+Left/Right |

Every command is in the palette and in the menu at the end of the tab bar. The start screen and the menu's tooltip both show the palette's shortcut, though touch screens don't get the start screen hint.

Create a Markdown, CSV or text file with "New file" on the start screen, or with its own command in the palette. A new CSV opens as a small table, using semicolons where the locale's decimal mark is a comma, plus CRLF and a UTF-8 BOM so that Excel reads it correctly. Files pending recovery stay in the list until you restore or discard them, so you can open or create other files first.

Choose an accent tone (violet, the default, or blue, green, orange or coral) with the dot in the status bar. It applies to both themes, the logo and the tab icon, and is remembered. Safari and installed-app icons stay violet, because they use fixed image files.

The app follows the system's light or dark setting. The half-circle button in the status bar switches to the other theme and remembers the choice. Switching back to the theme the system has returns to following the system, as does "Theme: follow system" in the palette.

The interface uses the first of your browser's languages that it has, English or Catalan, and English otherwise. To change it, click the language label (EN or CA) in the status bar, or use "Language: English" or "Language: Català" in the palette. The choice is remembered, and picking your browser's language returns to following the browser.

In the grid, click a row number or column letter to select it and open a menu to insert or delete. Press and drag it to move it to a new place, and press Escape to cancel the drag. Shift+click selects a range, and dragging from inside a selected range moves all of it.

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
scripts/in-docker.sh npm run build
scripts/in-docker.sh npm run test:e2e         # Chromium, Firefox, WebKit
scripts/in-docker.sh npm run test:perf        # timing targets, on an otherwise idle machine
```

Both Playwright commands test the production build through `vite preview`, under the real Content Security Policy, so build first. To check the deployed site instead:

```sh
BASE_URL=https://full.marcos-a.com scripts/in-docker.sh npx playwright test --project=chromium e2e/privacy.spec.ts
```

With Node installed, `npm run dev` starts a dev server. Over SSH, use a tunnel to `localhost` so that the page stays a secure context.

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

`build-env.sh` and `update-release-info.sh` are copies from the shared `app-build-info` convention, so change them there rather than here.

## Brand assets

The icons, logo and web manifest are in [public/](public/), and the standalone icon and wordmarks are in [docs/brand/](docs/brand/).

## Tests and manual checks

The Playwright suite covers each acceptance criterion in section 11 of the [original brief](docs/original-spec.md); test names start with its number, such as `AC14`. Tests tagged `@cross` also run on Firefox and WebKit.

Native file dialogs can't be automated, so the "overwrite the original" tests stub only the pickers and write through real `FileSystemFileHandle` objects from the browser's private file system. These checks need a real browser and are still to be run:

| Check | Steps | Result |
|---|---|---|
| Overwrite after permission | In Chrome or Edge: open a file with the button, edit, save, accept the prompt, then check the file on disk | Not yet run |
| Drop keeps its handle | In Chrome or Edge: drag a file from the desktop, edit, save, and check that it overwrites with no save dialog | Not yet run |
| Permission after restore | Restore a file after a crash and save: it should ask for permission, and fall back to Save As if refused | Passed in Edge: saving over the file after allowing, and the Save As fallback |
| Paste into spreadsheets | Copy a range and paste it into Excel, Google Sheets and Word; copy from Excel and paste it into the grid | Not yet run |
| Dead keys | On a Spanish or Catalan keyboard, type `à` straight into a selected grid cell. The test only simulates this | Not yet run |
| Real Safari | Repeat the main flow in Safari. Automated runs use Playwright's WebKit build | Not yet run |

## Known limitations

- **Mixed line endings:** files keep their exact bytes until edited. The first saved edit in a source editor may convert them to the dominant style, and the status bar warns about this. Grid edits don't convert them.
- **Multi-line CSV cells in raw view:** a CRLF file with LF inside quoted cells counts as mixed, so editing it in raw view may convert those. Editing it in the grid doesn't.
- **Rendered-side edits reformat:** they regenerate the file's Markdown, as the warning says. It doesn't appear for never-saved or empty files, which have no existing formatting to protect. Front matter and the final-newline state are kept, and undo restores the exact previous text.
- **Undo in CSV:** the grid and raw view have separate histories. Changes made in raw view arrive in the grid as one undo step, and leaving raw view clears its own history.
- **Moving columns in uneven rows:** a row shorter than the moved column stays as it is. Otherwise it gains only the empty fields needed to keep its values in the right columns.
- **Column widths after undo:** undoing a column change restores the content, but widths can stay where they were.
- **Undo after restoring:** undo history doesn't survive a restore or an encoding change.
- **Very large Markdown:** rendered-side edits serialize the whole document, so in a 1 MB file they lag behind typing, by design without ever losing text. Source-side typing isn't affected. Files over 100 KB parse section by section, and stay whole if they contain anything that can span sections, such as reference links or HTML comments.
- **Relative images and links:** relative image paths show a placeholder, because a browser page can't read neighbouring files. Relative links don't navigate.
- **Task checkboxes** in the rendered side are drawn with CSS, so they toggle by mouse only. Their text can be edited by keyboard, and so can the `[x]` in the source.
