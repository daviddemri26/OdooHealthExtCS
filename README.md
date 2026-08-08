# OdooHealthExtCS

OdooHealthExtCS is the internal browser extension for the Odoo Customer Success team in San Francisco. Version 1 adds focused, production-ready shortcuts to Odoo subscription records without installing an Odoo module or changing the Odoo server.

The extension runs only on `https://www.odoo.com/odoo*`, shows its record controls only when the visible subscription badge is **In Progress**, uses the user's existing authenticated session, and sends no Odoo data to external services.

## Features

- Account health: read, set, replace, or clear the canonical `Health - High`, `Health - Medium`, and `Health - Low` tags while preserving unrelated tags.
- Industry quick picker: search and update the exact subscription customer's industry without leaving the subscription.
- Safe feedback: optimistic updates, light/dark status messages, optional success confirmations, and a seven-second Undo action that refuses to overwrite a later external change.
- Personal settings: master, feature, per-feature success-confirmation, and appearance controls stored by the browser.

## Screenshots

Public screenshots are intentionally pending. They must be captured from sanitized fixtures or an approved noncritical demo record and pass [the asset checklist](store/asset-checklist.md). Real customer screenshots and captured Odoo HTML must never be committed.

## Install a local build

Requirements: Node.js 22 LTS and pnpm 10.

```bash
pnpm install --frozen-lockfile
pnpm icons
pnpm package
```

The complete command produces validated Chrome, Firefox, and source ZIP files in `artifacts/`. For unpacked testing:

- Chrome/Chromium: open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `.output/chrome-mv3`.
- Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `.output/firefox-mv3/manifest.json`.

Officially distributed packages should come from the matching GitHub Release or configured browser store, never from an unverified third-party archive.

## Development

```bash
pnpm dev
pnpm dev:firefox
pnpm test
pnpm validate
```

WXT, React, and TypeScript provide one Manifest V3 codebase for Chrome/Chromium and Firefox. The UI runs in an isolated content script and lives in a Shadow DOM. A second, narrowly allow-listed `MAIN`-world bridge performs authenticated same-origin calls to `/web/dataset/call_kw`; it exposes no general-purpose RPC access. The project contains no password, API key, cookie reader, analytics client, or remotely hosted executable code.

See [Architecture](docs/ARCHITECTURE.md), [Odoo compatibility](docs/ODOO_COMPATIBILITY.md), and [Troubleshooting](docs/TROUBLESHOOTING.md).

## Package and release

```bash
pnpm package
pnpm release:status
pnpm release -- patch    # after at least one initial store version is published
```

`pnpm package` validates, tests, builds, lints, scans, and creates browser and source archives plus checksums in `artifacts/`. While the manually submitted 1.0.0 packages are under review, normal code changes continue under the unchanged 1.0.0 development version and are recorded in `CHANGELOG.md` under `Unreleased`.

The public store IDs and initial-publication statuses live in `store/release-state.json`. Packaging remains available while both stores are pending, but version increments and release tags stay blocked until at least one initial version is published. Each store is then eligible for automated updates independently: Chrome can receive 1.0.1 while Firefox remains skipped, and Firefox joins a later shared release after its own 1.0.0 publication. Use `patch`, `minor`, or `major` to promote the accumulated Unreleased changes into the next version. `pnpm release` requires a clean, synchronized `main`.

Every push and pull request produces short-lived GitHub Actions packages. A `vX.Y.Z` tag creates a permanent GitHub Release and submits to each enabled store. Store jobs remain safely skipped until their protected environments are configured. Follow the [release runbook](docs/RELEASE.md).

## Privacy and support

- [Privacy policy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Contributing](CONTRIBUTING.md)

OdooHealthExtCS is an independent internal productivity extension. It is not an installable Odoo module and is not an official Odoo product.

© DDEM
