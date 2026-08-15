# QA Checklist

Use sanitized synthetic fixtures for automated and visual testing. Use an approved noncritical Odoo record only for the final controlled-write checks. Never save screenshots or captures containing customer data in this repository.

## Automated package

- [ ] `pnpm package` succeeds on Node 22 and pnpm 10.
- [ ] Unit and DOM tests pass.
- [ ] Renewal reconciliation stress tests pass repeatedly, including the zero-budget first-read scenario.
- [ ] Chrome and Firefox manifests are MV3, request only `storage`, and contain exactly two scripts matching only `https://www.odoo.com/odoo*`: isolated UI at `document_idle` and `MAIN` bridge at `document_start`.
- [ ] Firefox `web-ext lint` passes.
- [ ] Sensitive-data scan passes.
- [ ] Three deterministic ZIP files, checksums, and a release manifest exist; the manifest Git SHA and exact source entry list verify.
- [ ] The source ZIP contains only regular files returned by `git ls-files`; ignored keys/private notes and tracked or untracked symlinks cannot enter it.
- [ ] Generated icons have a pure white softly rounded square, remain crisp at 16 px, and match the canonical SVG.

## Routing and lifecycle

- [ ] No extension code runs on `https://www.odoo.com/`, portal, docs, shop, checkout, or any non-`/odoo` path.
- [ ] Direct subscription and nested `sale.order` routes mount once.
- [ ] Navigating to the linked contact unmounts subscription controls.
- [ ] Browser back/forward, Odoo breadcrumbs, record next/previous, and repeated rerenders do not duplicate UI.
- [ ] Health and Industry independently render for one exact `In Progress` or `Paused` badge and remain hidden for every other, missing, translated, or ambiguous badge.
- [ ] Renewals remains absent or ineligible on Paused, including when the server state changes after the menu opens but before Create.

## RPC bridge

- [ ] The isolated gateway completes one versioned bridge handshake and correlates concurrent requests independently.
- [ ] Foreign origins, sources, clients, versions, stale request IDs, and malformed responses are ignored.
- [ ] Every model, method, field, domain, and write shape outside the documented allow-list is rejected before fetch.
- [ ] Generic writes and arbitrary button/action calls are rejected; only closed Health, Industry, and Renewals operations can mutate Odoo.
- [ ] Successful responses contain only allow-listed fields; errors contain no raw Odoo message, response body, or stack trace.
- [ ] A signed nonzero safe-integer `sale.order.partner_id` is preserved in `res.partner` request IDs and sanitized response record IDs; zero and unsafe partner IDs are rejected.
- [ ] Sale-order, tag, industry, and user IDs, plus every non-partner relation value, remain positive and reject zero or negative values.
- [ ] Bridge unavailable, timeout, expired session, denied access, incompatible endpoint/response, network, and server failure are distinct.
- [ ] Read-only live traffic goes only to `https://www.odoo.com/web/dataset/call_kw/...`.

## Account health

- [ ] Not set, High, Medium, Low, and duplicate states are both visually and textually distinct.
- [ ] Form Health bootstrap reads only `sale.order.tag_ids`; an empty tag list resolves to Not set without depending on `partner_id` or `subscription_state` response values.
- [ ] Health controls appear in Low, Medium, High order as macOS red, yellow, and green circles without letters; the current state text appears to their right.
- [ ] Health circles keep exactly the same size on hover and focus; only the selected value has a surrounding ring.
- [ ] Selecting a state preserves every unrelated tag and leaves exactly one canonical health tag.
- [ ] A tag added concurrently after the form read is preserved by the closed mutation.
- [ ] Selecting the active state clears health.
- [ ] A later selection cleans duplicate health tags.
- [ ] Missing or ambiguous canonical tags disable writes.
- [ ] Access errors, expired session, missing fields, and failed writes are sanitized.
- [ ] Undo works within seven seconds and refuses after an external change.
- [ ] Navigating to another record while Health succeeds, fails, or awaits Undo never updates the new record's UI or shows an old toast/Undo.

## Subscription-list health preview

- [ ] The preview is disabled by default and can be enabled independently from the Account Health form shortcut.
- [ ] Only a structurally complete Odoo subscription list is accepted; generic lists, forms, Kanban views, and incomplete signatures are rejected.
- [ ] Customer columns in different positions receive exactly one 3-pixel marker; grouping and total rows remain untouched.
- [ ] A light gray marker reserves the layout before the bounded read completes, and the same element transitions to High, Medium, Low, or gray without shifting customer text.
- [ ] Not set, duplicate health tags, duplicate subscription names, missing records, and unsafe responses fail to the documented gray or closed state.
- [ ] Filters, sorting, pagination, grouping, Odoo SPA navigation, and row replacement refresh the visible markers without duplication.
- [ ] Disabling the setting, pausing the extension, leaving the list, or destroying the content script removes markers immediately.

## Industry

- [ ] Inline field reads the exact signed nonzero subscription `partner_id`, including contact/company distinctions, and preserves it through partner reads, writes, and safe Undo.
- [ ] Industry rejects a zero or unsafe partner ID and any non-positive industry ID.
- [ ] Choices load dynamically and sort correctly.
- [ ] Search, No industry, current highlighting, Tab, Enter, Arrow Up/Down, and Escape work.
- [ ] Set, clear, and Undo behave correctly; Undo refuses after an external change.
- [ ] The closed operation rejects a linked partner changed after the form read.
- [ ] Navigating to another record while Industry succeeds, fails, or awaits Undo never updates the new record's UI or shows an old toast/Undo.
- [ ] No navigation to the contact is required.

## Multi-year renewals

- [ ] Renewals is disabled by default and appears only after server preflight confirms `3_progress` and a supported technical billing period.
- [ ] Monthly/Yearly, 13-month, two-, three-, four-, five-, and over-five-year contracts show exactly the documented equal-or-longer choices.
- [ ] The plan never creates a shorter quote: monthly uses a technical annual base; an existing multi-year source copies directly from its same-duration renewal.
- [ ] Only Copy years required by the current plan are resolved; a missing unrelated action does not block, while a missing required action fails before Renew.
- [ ] All target copies are created from the verified clean base before any target discount is applied.
- [ ] Only owned native global-discount lines carrying the reviewed Odoo marker may be removed; commercial discount lines are preserved.
- [ ] Zero percent creates no line; positive half-point discounts use Global Discount with an empty description and verify line/tax/total effects.
- [ ] Quote plan, template, commercial identity, lineage, currency, lines, totals, and Share URL are verified after each relevant step.
- [ ] First error stops the queue; confirmed results remain available; timeout/validation failures reconcile read-only without automatic retry.
- [ ] Post-commit timeout tests cover no candidate, one candidate, ambiguous candidates, and a late candidate.
- [ ] `finishRenewalRun` executes in `finally`, destroys runtime ownership and resolved actions, and causes later operations with the old run ID to fail closed.
- [ ] Multiple runs on the same record do not double-count quote IDs or retain an earlier run's runtime registry.
- [ ] The native Renewal Quote counter updates only when Odoo already rendered the smart button; no synthetic button appears at zero.
- [ ] Share links stay only in tab memory and never appear in logs, storage, toast details, telemetry, or persisted test artifacts.
- [ ] Copy link, Copy all, Open quote, and Open all run only from user clicks; blocked tabs are excluded from the success count and trigger a warning.
- [ ] The split button and popover work in light/dark themes, with keyboard navigation, SPA rerenders, reduced motion, and the native Renew click preserved.

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
- [ ] The popup is inert, noninteractive, and `aria-busy` before settings hydration; no pointer or keyboard change can be lost during startup.
- [ ] Field-scoped settings patches preserve independent changes even when popup and content-script writes complete out of order; an open popup reflects external changes.
- [ ] Every legacy or malformed nonzero one-year preset normalizes to zero; only two- through five-year defaults are stored as editable presets.
- [ ] Success and error status messages use a colored outline, a prominent primary line, and dismiss automatically; Health confirmation explains the delayed native Tags-widget refresh.
- [ ] Hovering a status message pauses its dismissal timer; leaving resumes from the remaining time.
- [ ] Keyboard focus inside a status message also pauses the timer; blur resumes from the remaining time.
- [ ] Each feature's success toast is enabled by default, can be disabled in Settings, and can disable itself through “Don't show again” without suppressing errors or warnings.
- [ ] The independent list-preview setting appears in its own Account Health card between the form options and the save explanation.
- [ ] The inline panel remains absent during initial reads and fades in only after all enabled feature reads settle.
- [ ] The panel appears on equivalent Chrome and Firefox subscription forms, including forms where Odoo renders only the `h1` contract title.
- [ ] Success, error, warning, and info messages all disappear automatically at their documented durations.
- [ ] Enabled settings switches are green in Auto, Light, and Dark appearance modes.
- [ ] Visible focus, screen-reader labels, reduced motion, no Odoo click blocking, and no clipped dropdown/status UI.

## Release, supply chain, and privacy

- [ ] `pnpm release:status` matches the observed state of both stores, but live store dashboards are treated as authoritative.
- [ ] The public Chrome and Firefox versions are checked before preparing a replacement release.
- [ ] Chrome and Firefox both load Health and Industry on approved In Progress and Paused records without an unsupported-response toast; no Paused mutation is performed without an explicitly approved noncritical record.
- [ ] If Renewals materially changed, any controlled live check uses only the explicitly approved subscriptions `7199004` and `6690030`.
- [ ] Both store states are `published` and their protected publication variables are intentionally enabled before a shared tagged release.
- [ ] The Chrome preflight refuses to replace a pending review, staged upload, policy warning, or takedown.
- [ ] Before Firefox environment approval, AMO Developer Hub confirms no existing `2.0.0` and no pending submission; an operator records this manual gate privately.
- [ ] Every external action in privileged release workflows is pinned to a reviewed commit SHA and each job has only its required permissions.
- [ ] Firefox signs the exact verified Firefox ZIP content from the release artifact; neither automatic nor recovery submission rebuilds it.
- [ ] Recovery verifies tag/commit identity, checksums, exact source manifest, and GitHub provenance attestations before signing.
- [ ] Final icon is legible at 16 px and the canonical SVG is approved.
- [ ] Public docs, listings, screenshots, sources, and archives contain no captures, customer information, session data, secrets, or remote executable code.
- [ ] For the silent 2.0.0 release, `docs/public/**`, Chrome/Firefox listings, public descriptions, and public release notes have no diff.
- [ ] Firefox update metadata contains only private reviewer `approval_notes`; if a store requires a public metadata change, submission stops for explicit approval.
- [ ] Tag, package, and both manifest versions match.
- [ ] GitHub Release assets are permanent; enabled store submissions are recorded.
- [ ] GitHub Release contains only the title, tag, and artifacts, with no generated or authored public body.
- [ ] No tag or store submission is created until read-only checks pass in both browsers and any materially changed write path passes on an approved noncritical record.
