# OdooHealthExtCS

OdooHealthExtCS is the internal browser extension for the Odoo Customer Success team in San Francisco. It adds focused, production-ready subscription and quotation shortcuts plus read-only list context without installing an Odoo module or adding server code.

The extension runs only on `https://www.odoo.com/odoo*`, applies a separate structural and server-side eligibility policy to each feature, uses the user's existing authenticated session, and sends no Odoo data to external services.

## Features

- Account health: read, set, replace, or clear the canonical `Health - High`, `Health - Medium`, and `Health - Low` tags while preserving unrelated tags.
- Subscription-list preview: optionally show a compact health-color indicator beside each visible customer in structurally recognized Odoo subscription lists.
- Industry quick picker: search and update the exact subscription customer's industry without leaving the subscription.
- Share Links: optionally copy Odoo's native Share URL in one click from eligible Renewal Quotations and Sales quotations, including Success Packs.
- Safe feedback: optimistic updates, light/dark status messages, optional success confirmations, and a seven-second Undo action that refuses to overwrite a later external change.
- Personal settings: master, feature, independent list-preview, per-feature success-confirmation, and appearance controls stored by the browser.

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

WXT, React, and TypeScript provide one Manifest V3 codebase for Chrome/Chromium and Firefox. Interactive UI runs in an isolated content script and lives in a Shadow DOM; the read-only list preview decorates only structurally verified native Customer cells with namespaced elements. A second, narrowly allow-listed `MAIN`-world bridge performs authenticated same-origin calls to `/web/dataset/call_kw`; it exposes no general-purpose RPC access. The `clipboardWrite` permission supports explicit copy actions only; the extension never reads the clipboard. The project contains no password, API key, cookie reader, analytics client, or remotely hosted executable code.

See [Architecture](docs/ARCHITECTURE.md), [Odoo compatibility](docs/ODOO_COMPATIBILITY.md), and [Troubleshooting](docs/TROUBLESHOOTING.md).

## Package and release

```bash
pnpm package
pnpm release:status
pnpm release -- minor
```

`pnpm package` validates, tests, builds, lints, scans, and creates browser and source archives plus checksums in `artifacts/`. Completed changes remain under `CHANGELOG.md` → `Unreleased` until a semantic release promotes them into a dated version.

The public store IDs and initial-publication statuses live in `store/release-state.json`. Chrome and Firefox have both completed their initial publication and are eligible for tagged automatic updates. Use `patch`, `minor`, or `major` to promote the accumulated Unreleased changes into the next version. `pnpm release` requires a clean, synchronized `main`.

Every push and pull request produces short-lived GitHub Actions packages. A `vX.Y.Z` tag creates a permanent GitHub Release and submits to each enabled store. Store jobs remain safely skipped until their protected environments are configured. Follow the [release runbook](docs/RELEASE.md).

## Privacy and support

- [Privacy policy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Contributing](CONTRIBUTING.md)

OdooHealthExtCS is an independent internal productivity extension. It is not an installable Odoo module and is not an official Odoo product.

© DDEM
