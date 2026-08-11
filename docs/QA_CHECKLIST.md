# QA Checklist

Use sanitized synthetic fixtures for automated and visual testing. Use an approved noncritical Odoo record only for the final controlled-write checks. Never save screenshots or captures containing customer data in this repository.

## Automated package

- [ ] `pnpm package` succeeds on Node 22 and pnpm 10.
- [ ] Unit and DOM tests pass.
- [ ] Chrome and Firefox manifests are MV3, request only `storage`, and contain exactly two scripts matching only `https://www.odoo.com/odoo*`: isolated UI at `document_idle` and `MAIN` bridge at `document_start`.
- [ ] Firefox `web-ext lint` passes.
- [ ] Sensitive-data scan passes.
- [ ] Three deterministic ZIP files, checksums, and release manifest exist.
- [ ] Generated icons have a pure white softly rounded square, remain crisp at 16 px, and match the canonical SVG.

## Routing and lifecycle

- [ ] No extension code runs on `https://www.odoo.com/`, portal, docs, shop, checkout, or any non-`/odoo` path.
- [ ] Direct subscription and nested `sale.order` routes mount once.
- [ ] Navigating to the linked contact unmounts subscription controls.
- [ ] Browser back/forward, Odoo breadcrumbs, record next/previous, and repeated rerenders do not duplicate UI.

## RPC bridge

- [ ] The isolated gateway completes one versioned bridge handshake and correlates concurrent requests independently.
- [ ] Foreign origins, sources, clients, versions, stale request IDs, and malformed responses are ignored.
- [ ] Every model, method, field, domain, and write shape outside the documented allow-list is rejected before fetch.
- [ ] Successful responses contain only allow-listed fields; errors contain no raw Odoo message, response body, or stack trace.
- [ ] Bridge unavailable, timeout, expired session, denied access, incompatible endpoint/response, network, and server failure are distinct.
- [ ] Read-only live traffic goes only to `https://www.odoo.com/web/dataset/call_kw/...`.

## Account health

- [ ] Not set, High, Medium, Low, and duplicate states are both visually and textually distinct.
- [ ] Health controls appear in Low, Medium, High order as macOS red, yellow, and green circles without letters; the current state text appears to their right.
- [ ] Health circles keep exactly the same size on hover and focus; only the selected value has a surrounding ring.
- [ ] Selecting a state preserves every unrelated tag and leaves exactly one canonical health tag.
- [ ] Selecting the active state clears health.
- [ ] A later selection cleans duplicate health tags.
- [ ] Missing or ambiguous canonical tags disable writes.
- [ ] Access errors, expired session, missing fields, and failed writes are sanitized.
- [ ] Undo works within seven seconds and refuses after an external change.

## Subscription-list health preview

- [ ] The preview is disabled by default and can be enabled independently from the Account Health form shortcut.
- [ ] Only a structurally complete Odoo subscription list is accepted; generic lists, forms, Kanban views, and incomplete signatures are rejected.
- [ ] Customer columns in different positions receive exactly one 3-pixel marker; grouping and total rows remain untouched.
- [ ] A light gray marker reserves the layout before the bounded read completes, and the same element transitions to High, Medium, Low, or gray without shifting customer text.
- [ ] Not set, duplicate health tags, duplicate subscription names, missing records, and unsafe responses fail to the documented gray or closed state.
- [ ] Filters, sorting, pagination, grouping, Odoo SPA navigation, and row replacement refresh the visible markers without duplication.
- [ ] Disabling the setting, pausing the extension, leaving the list, or destroying the content script removes markers immediately.

## Industry

- [ ] Inline field reads the exact subscription `partner_id`, including contact/company distinctions.
- [ ] Choices load dynamically and sort correctly.
- [ ] Search, No industry, current highlighting, Tab, Enter, Arrow Up/Down, and Escape work.
- [ ] Set, clear, and Undo behave correctly; Undo refuses after an external change.
- [ ] No navigation to the contact is required.

## Interface matrix

- [ ] Latest Chrome and Firefox.
- [ ] Odoo light and dark modes; extension Auto, Light, and Dark.
- [ ] Desktop widths 1280, 1440, 1920, and a narrow 1024 layout.
- [ ] 100%, 125%, and 150% zoom.
- [ ] The framed Industry and Health panel is attached to the form-sheet top edge and horizontally tied to the contract number with chatter open/closed, at every tested width and zoom.
- [ ] The frame shrinks when a shorter industry is selected and expands only up to the safe native-layout limit for longer content.
- [ ] Long industry names truncate before the native subscription-state badge, while every dropdown option remains fully readable.
- [ ] The expanded Industry picker aligns with the left edge of the compact panel in Chrome and Firefox.
- [ ] Health and Industry selections update immediately and roll back visibly after a simulated failed write.
- [ ] Firefox positions the panel beside the visible contract number rather than beside the status badge.
- [ ] The panel scrolls with the Odoo form and stays below sticky action bars, user-preference dialogs, email composers, and other native modals.
- [ ] Industry hover changes only the link color and never adds an underline.
- [ ] Chrome shows no unused popup area and neither browser requires scrolling to read the popup footer.
- [ ] Invalid or unavailable browser storage falls back safely; the popup remains usable and reports a failed preference save without crashing.
- [ ] Success and error status messages use a colored outline, a prominent primary line, and dismiss automatically; Health confirmation explains the delayed native Tags-widget refresh.
- [ ] Hovering a status message pauses its dismissal timer; leaving resumes from the remaining time.
- [ ] Each feature's success toast is enabled by default, can be disabled in Settings, and can disable itself through “Don't show again” without suppressing errors or warnings.
- [ ] The independent list-preview setting appears in its own Account Health card between the form options and the save explanation.
- [ ] The inline panel remains absent during initial reads and fades in only after all enabled feature reads settle.
- [ ] The panel appears on equivalent Chrome and Firefox subscription forms, including forms where Odoo renders only the `h1` contract title.
- [ ] Success, error, warning, and info messages all disappear automatically at their documented durations.
- [ ] Enabled settings switches are green in Auto, Light, and Dark appearance modes.
- [ ] Visible focus, screen-reader labels, reduced motion, no Odoo click blocking, and no clipped dropdown/status UI.

## Release and privacy

- [ ] `pnpm release:status` matches the observed initial-publication state of both stores.
- [ ] The public Chrome and Firefox versions are checked before preparing a replacement release.
- [ ] Both store states are `published` and their protected publication variables are intentionally enabled before a shared tagged release.
- [ ] The Chrome preflight refuses to replace a pending review, staged upload, policy warning, or takedown.
- [ ] Final icon is legible at 16 px and the canonical SVG is approved.
- [ ] Public docs, screenshots, sources, and archives contain no captures, customer information, session data, secrets, or remote executable code.
- [ ] Pages URLs load and store copy matches current behavior.
- [ ] Tag, package, and both manifest versions match.
- [ ] GitHub Release assets are permanent; enabled store submissions are recorded.
- [ ] No tag or store submission is created until read-only checks pass in both browsers and any materially changed write path passes on an approved noncritical record.
