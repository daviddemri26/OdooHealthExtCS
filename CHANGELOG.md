# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Replaced isolated-world Odoo requests with a versioned, allow-listed `MAIN`-world bridge so Chrome and Firefox use the active authenticated page session reliably.
- Added distinct bridge, timeout, session, permission, endpoint, network, response, and server diagnostics without forwarding raw Odoo errors.

### Security

- Restricted the page bridge to the exact Health and Industry models, fields, domains, and write shapes, with sanitized responses and no new extension permissions.

### Added

- Initial cross-browser WXT, React, TypeScript, and Manifest V3 implementation.
- Subscription account-health controls with canonical tag validation, duplicate cleanup, clearing, and safe Undo.
- Subscription customer industry drawer with dynamic choices, search, keyboard navigation, clearing, and safe Undo.
- Versioned settings popup, compatibility status, Shadow DOM isolation, and shared status messages.
- Deterministic packaging, privacy scanning, GitHub Actions releases, optional store submission, and GitHub Pages policies.
- Complete English repository, support, privacy, release, QA, compatibility, troubleshooting, and store documentation.

## [0.1.0] - 2026-08-05

### Added

- Initial development version.
