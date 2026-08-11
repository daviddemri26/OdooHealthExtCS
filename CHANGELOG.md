# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Added a protected Firefox recovery workflow that verifies and submits immutable GitHub Release assets to the approved AMO listing without moving a tag or affecting Chrome.
- Added direct Chrome Web Store and Firefox Add-ons download buttons to the public product page.
- Added an optional account-health preview to recognized Odoo subscription lists, with High, Medium, Low, unset, and ambiguous indicators beside the Customer value.
- Added an independent, disabled-by-default Account Health setting for the subscription-list preview.

### Changed

- Marked the approved Firefox 1.0.0 listing as eligible for automatic updates from future version tags.
- Detect subscription lists from stable Odoo view and field structure instead of URL paths, including reordered Customer columns, grouped lists, pagination, filters, and SPA rerenders.
- Reserve the list-indicator space immediately with a light loading marker, then transition the same marker to its resolved color without shifting customer names.

### Security

- Extended the Odoo bridge with a strictly allow-listed, bounded `sale.order.search_read` contract that returns only `id`, `name`, and `tag_ids` for visible subscription names.

## [1.1.0] - 2026-08-08

### Changed

- Added a live connected-user indicator to the dedicated Odoo Connection page without persisting the name or login or requesting any new browser permission.
- Generalized the Odoo connection check to every allowed workspace page with a read-only session probe, independently from subscription routes, record status, Account Health, and Industry.
- Separated global session diagnostics from feature-specific capability and write errors, and updated the popup with generic connection and recovery messages.
- Redesigned the popup as a scalable control panel with dedicated Connection, Settings, Account Health, and Industry pages; Connection groups session status, privacy, and scope while Settings contains appearance and product information.
- Consolidated version, copyright, Odoo scope, and product website details inside the popup's Private by design card.
- Limited the inline Health and Industry controls to subscription forms whose visible status badge reads exactly In Progress.
- Attenuated unset Health and Industry values to make incomplete account data easier to recognize.
- Standardized the official extension icon across the public site and added discreet © DDEM attribution to the popup, public pages, documentation, and store copy.
- Approved the sanitized Chrome promotional image by exact checksum so replacement raster files still fail the privacy scan.
- Kept development builds on version 1.0.0 while the initial Chrome and Firefox submissions are under review.
- Added independent, versioned store gates so Chrome can receive automated updates as soon as its initial listing is published while Firefox remains blocked until its own approval.
- Moved the public Chrome item ID into the repository release state while keeping publication authorization in protected GitHub environments.
- Required future releases to promote documented Unreleased changes into a new patch, minor, or major version.

## [1.0.0] - 2026-08-05

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
- Hardened settings and compatibility-status deserialization, made diagnostic storage nonblocking, and reduced unnecessary Odoo SPA rerenders.
- Added graceful popup fallbacks when browser storage is temporarily unavailable.

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
- Official white rounded-square icon treatment and version 1 store, policy, website, and release copy.

## [0.1.0] - 2026-08-05

### Added

- Initial development version.
