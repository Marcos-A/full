# TODO

Concrete next steps. The [roadmap](ROADMAP.md) has the goals, order and reasons. This file only details the current milestone, so tasks for M2 onward get added when M0 is nearly done. Delete tasks once they're done and their result is recorded.

## Decisions

The remaining decisions, and when each is needed, are in the [roadmap](ROADMAP.md#decisions). None is needed yet.

## M0 Spike on a real Mac

On Marcos's M4. Use a throwaway branch or folder, with the latest stable Tauri 2 (2.11.1 or later, not the 3.0 alphas). Point `frontendDist` at the unmodified `dist/`, use a packaged build rather than `tauri dev`, and record each answer in the [audit](docs/desktop/repository-audit.md).

### Platform

- [ ] Is `window.isSecureContext` true? Are `crypto.randomUUID`, `navigator.locks`, `navigator.clipboard` and `navigator.storage.persist` available?
- [ ] Does the app start at all? `navigator.locks` isn't guarded at startup.
- [ ] Does the CSP work with `style-src` excluded from Tauri's changes, and what breaks without it?
- [ ] Does the module worker load, opening a CSV over 5 MB under the CSP?

### Recovery

- [ ] Does IndexedDB survive a normal quit, a Force Quit and `kill -9`, within and after the 500 ms debounce? This is the stop-and-rethink question.
- [ ] Does it survive replacing the app with a rebuilt one using the same identifier?
- [ ] After a Force Quit, are records offered for recovery? This checks that the Web Lock is released.
- [ ] What happens if the web content process dies while the app stays open?

### Input

- [ ] With the default menu: do Cmd+C, X, V and A work in the source editor, rendered side and grid?
- [ ] Do Cmd+Z and Cmd+Shift+Z reach the app's handler rather than the native undo? Do Cmd+S, Cmd+K and Alt+W work? Does each fire once?
- [ ] Do dead keys work when typing `à` in a selected grid cell?
- [ ] Do row, column and split-pane drags work with `dragDropEnabled` on?
- [ ] Does a drop from Finder arrive natively, and does the HTML5 drop handler stay out of the way?

### Close and quit

- [ ] Which events do closing the window, Cmd+Q, Dock quit and logout each fire? Can each be held back while a dialog is open?

### Measure

- [ ] Cold and warm launch to interactive, against the report's budgets.
- [ ] Open a 1 MB Markdown file and a 100,000-row CSV. Type in the Markdown file. Compare with the [Linux baseline](docs/desktop/repository-audit.md#6-baseline-quality-gate).
- [ ] Open a 50 MB file and type, watching for pauses from `refreshRecovery` and persisting.

### Wrap up

- [ ] Guard the startup use of `navigator.locks` in shared code, if the answers call for it. M1 is done and left this open.
- [ ] Update the audit and revise the effort estimates from the answers. Throw away the shell.

## Not desktop

Already open, and tracked in the [README](README.md#tests-and-manual-checks). All of these need a real browser:

- [ ] Overwrite after permission, in Chrome or Edge.
- [ ] Drop keeps its handle, in Chrome or Edge.
- [ ] Paste into and from Excel, Google Sheets and Word.
- [ ] Dead keys on a Spanish or Catalan keyboard.
- [ ] The main flow in real Safari. It also covers much of what M0 needs, so do it on the same Mac.

And one to consider:

- [ ] Add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
