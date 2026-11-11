# TODO

Concrete next steps. The [roadmap](ROADMAP.md) has the goals, order and reasons. This file only details the current milestone, so tasks for each milestone get added when the one before is nearly done. Delete tasks once they're done and their result is recorded.

## Where things stand

Last updated 11 November 2026.

- **Done:** M1 is live on the website. The M0 spike is finished, and the [audit](docs/desktop/repository-audit.md#m0-spike-results) has its results. M2, the committed shell, is on `main`, with its [results](docs/desktop/repository-audit.md#m2-shell-results) in the audit too. M3, open, is finished, with its [results](docs/desktop/repository-audit.md#m3-open-results) there as well. M4, save, is finished, with its [results](docs/desktop/repository-audit.md#m4-save-results) there too. M5, close, quit and recovery, is finished, with its [results](docs/desktop/repository-audit.md#m5-close-results) there as well. M6, Finder and packaging, is finished, with its [results](docs/desktop/repository-audit.md#m6-finder-and-packaging-results) there too.
- **Next:** v0.1.0, the first public download of the Mac app, without Apple's signature. The tasks are below. Signing and notarization, the rest of M7, stay postponed.

If you're picking this up in a new chat:

1. Read this file, then the [roadmap](ROADMAP.md). The [audit](docs/desktop/repository-audit.md) overrides the [report](docs/desktop/implementation-report.md) where they disagree.
2. Other sessions may be editing `/srv/apps/full` at the same time. Run `git status` first and leave changes you didn't make alone. For anything larger than a small edit, work in a sibling `git worktree` and rebase onto `origin/main` before merging.

## Decisions

None is waiting. Joining the Apple Developer Program is still postponed: see the [roadmap](ROADMAP.md#decisions).

## v0.1.0, first public download

Ad hoc signed, made checkable by an immutable release and a build attestation, as the [README](README.md#checking-the-download) describes. Builds run on GitHub Actions, in the [Desktop build workflow](.github/workflows/desktop.yml). In this order:

- [ ] Screenshots of the Mac app, light and dark, in `docs/screenshots/`, shown in the README's Mac app section in both languages.
- [ ] Before making the repository public, check its history for secrets and for anything personal. Commit author emails become visible.
- [ ] Turn on "Enable release immutability" in the repository's settings, then make the repository public.
- [ ] Merge the docs, then run the workflow on `main` with version `v0.1.0`. It checks the release itself once it's published.
- [ ] On the Mac, download the DMG and follow the README's checking and installing steps as a user would.
- [ ] Run `scripts/write-build-info.sh` on the server, so that the website's status bar shows the release too.

## M7 Signing (postponed)

For when Gatekeeper warnings are no longer acceptable.

- [ ] Decide on the Apple Developer Program, then add a Developer ID certificate and the notarization credentials to GitHub's secrets.
- [ ] Sign with Developer ID and the hardened runtime, notarize, and staple the DMG in CI.
- [ ] Install the downloaded DMG on a separate Mac and check that Gatekeeper opens it with no warning.
- [ ] Remove the README's quarantine step once that holds.

## Not desktop

Already open, and tracked in the [README](README.md#tests-and-manual-checks). All of these need a real browser:

- [ ] Overwrite after permission, in Chrome or Edge. Do this one first: M1 moved this code, and so far only tests with stubbed file pickers have covered the move.
- [ ] Drop keeps its handle, in Chrome or Edge.
- [ ] Paste into and from Excel, Google Sheets and Word.
- [ ] The main flow in real Safari.

And one to consider:

- [ ] Add more tests to the `@cross` set. The whole suite passes on WebKit in 2.6 minutes, while the regular run covers only about 42 of its 151 tests. Running it all would catch WebKit regressions before they reach the Mac app.
