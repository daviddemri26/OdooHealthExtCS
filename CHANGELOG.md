# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Replaced isolated-world Odoo requests with a versioned, allow-listed `MAIN`-world bridge so Chrome and Firefox use the active authenticated page session reliably.
- Added distinct bridge, timeout, session, permission, endpoint, network, response, and server diagnostics without forwarding raw Odoo errors.
- Replaced the floating Health card and right-edge Industry drawer with compact Odoo-style rows anchored directly above the native Order Date field.
- Moved the compact Health and Industry panel beside the contract number, clear of Odoo's subscription-state badge, with a subtle adaptive frame.
- Fixed Chrome popup overflow and the unnecessary Firefox footer scroll by applying explicit cross-browser popup dimensions.
- Made error status messages expire automatically and clarified that Odoo's native Tags widget refreshes after the next page reload.
- Mounted the compact data panel inside Odoo's form sheet so it scrolls with the record and remains below native sticky controls and dialogs.
- Added a Firefox-tolerant contract-title anchor, fixed-size Health circles, outline-only selection, and native color-only Industry hover feedback.
- Added explicit Arrow Up/Down plus Enter Industry selection and pause-on-hover status timers.
- Reworked status messages with a prominent primary line, optional secondary detail, and a kind-specific colored outline instead of a small indicator dot.
- Made every status kind expire automatically while preserving pause-on-hover, including duplicate-health warnings.
- Relaxed the visual-anchor contract for Firefox's flatter `sale.order` markup and selected the visible Odoo fields across duplicate responsive nodes.
- Made the inline panel shrink to its current Industry and Health content up to the safe native-layout limit.
- Changed enabled settings switches to a conventional green state.
- Expanded the Industry picker independently from the compact field frame so every option remains readable.
- Added optimistic Health and Industry updates with automatic rollback when Odoo rejects a write.
- Corrected Firefox positioning by measuring the visible contract text instead of its full-width heading container.
- Left-aligned the expanded Industry picker with the compact field panel while preserving its independent width.
- Hid the inline panel until enabled data finishes loading, then added a short fade-in instead of visible loading placeholders.

### Security

- Restricted the page bridge to the exact Health and Industry models, fields, domains, and write shapes, with sanitized responses and no new extension permissions.

### Added

- Initial cross-browser WXT, React, TypeScript, and Manifest V3 implementation.
- Subscription account-health controls with canonical tag validation, duplicate cleanup, clearing, and safe Undo.
- Subscription customer industry field with a compact searchable dropdown, keyboard navigation, clearing, and safe Undo.
- Versioned settings popup, compatibility status, Shadow DOM isolation, and shared status messages.
- Per-feature success-toast preferences, enabled by default, with a direct “Don't show again” action in Health and Industry confirmations.
- Deterministic packaging, privacy scanning, GitHub Actions releases, optional store submission, and GitHub Pages policies.
- Complete English repository, support, privacy, release, QA, compatibility, troubleshooting, and store documentation.

## [0.1.0] - 2026-08-05

### Added

- Initial development version.
