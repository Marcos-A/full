# full

A browser app for opening, viewing, editing and saving CSV, Markdown and text files, at <https://full.marcos-a.com>.

Drop a file on the page, see it rendered, copy from it, edit it and save it. It is a static site with no backend: file contents stay in your browser and are never sent to the server. If a tab or the browser closes before a file was closed in the app, the file is offered for recovery at the next launch.

The rule behind every decision is **never change what the user did not change**. Saving a file you edited changes only what you edited, apart from the exceptions listed under [Known limitations](#known-limitations).

[SPEC.md](SPEC.md) is the original specification, written under the working name "Folio". The product name lives only in [src/config.ts](src/config.ts).

## Features

- **File types:** `.csv`, `.md`, `.markdown` and `.txt`, in any letter case.
- **Encodings:** UTF-8, UTF-16 LE/BE and Windows-1252, detected on opening and kept on saving, along with any BOM and the line endings. A character the encoding can't hold stops the save and asks what to do.
- **CSV:** a virtual-scrolling grid that handles 100,000 rows. It keeps each field's raw text, so editing a cell rewrites only that field. Semicolon delimiters, comma decimals and Windows-1252 from Spanish and Catalan Excel exports work with no configuration.
- **Markdown:** source and rendered views side by side. Both can be edited and share one undo history. The source text is the single source of truth.
- **Text:** a plain source editor with line numbers, search and word wrap.
- **Recovery:** up to 10 abruptly closed files are kept, with or without unsaved changes.

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

Every command is in the palette and in the menu at the end of the tab bar.

The app follows the system's light or dark setting. The half-circle button in the status bar switches to the other theme and remembers the choice; "Theme: follow system" in the palette goes back to following the system.

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

## Tests and manual checks

The Playwright suite covers each acceptance criterion in section 11 of the spec; test names start with its number, such as `AC14`. Tests tagged `@cross` also run on Firefox and WebKit.

Native file dialogs can't be automated, so the "overwrite the original" tests stub only the pickers and write through real `FileSystemFileHandle` objects from the browser's private file system. These checks need a real browser and are still to be run:

| Check | Steps | Result |
|---|---|---|
| Overwrite after permission | In Chrome or Edge: open a file with the button, edit, save, accept the prompt, then check the file on disk | Not yet run |
| Drop keeps its handle | In Chrome or Edge: drag a file from the desktop, edit, save, and check that it overwrites with no save dialog | Not yet run |
| Permission after restore | Restore a file after a crash and save: it should ask for permission, and fall back to Save As if refused | Save As fallback confirmed in Edge; saving over the file after allowing not yet confirmed |
| Paste into spreadsheets | Copy a range and paste it into Excel, Google Sheets and Word; copy from Excel and paste it into the grid | Not yet run |
| Dead keys | On a Spanish or Catalan keyboard, type `à` straight into a selected grid cell. The test only simulates this | Not yet run |
| Real Safari | Repeat the main flow in Safari. Automated runs use Playwright's WebKit build | Not yet run |

## Known limitations

- **Mixed line endings:** files keep their exact bytes until edited. The first saved edit in a source editor may convert them to the dominant style, and the status bar warns about this. Grid edits don't convert them.
- **Multi-line CSV cells in raw view:** a CRLF file with LF inside quoted cells counts as mixed, so editing it in raw view may convert those. Editing it in the grid doesn't.
- **Rendered-side edits reformat:** they regenerate the file's Markdown, as the warning says. Front matter and the final-newline state are kept, and undo restores the exact previous text.
- **Undo in CSV:** the grid and raw view have separate histories. Changes made in raw view arrive in the grid as one undo step, and leaving raw view clears its own history.
- **Moving columns in uneven rows:** a row shorter than the moved column stays as it is. Otherwise it gains only the empty fields needed to keep its values in the right columns.
- **Column widths after undo:** undoing a column change restores the content, but widths can stay where they were.
- **Undo after restoring:** undo history doesn't survive a restore or an encoding change.
- **Very large Markdown:** rendered-side edits serialize the whole document, so in a 1 MB file they lag behind typing, by design without ever losing text. Source-side typing isn't affected. Files over 100 KB parse section by section, and stay whole if they contain anything that can span sections, such as reference links or HTML comments.
- **Relative images and links:** relative image paths show a placeholder, because a browser page can't read neighbouring files. Relative links don't navigate.
- **Task checkboxes** in the rendered side are drawn with CSS, so they toggle by mouse only. Their text can be edited by keyboard, and so can the `[x]` in the source.
