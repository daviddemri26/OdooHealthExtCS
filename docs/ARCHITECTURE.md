# Architecture

## Runtime boundary

WXT generates Chrome/Chromium and Firefox Manifest V3 builds from one React and TypeScript codebase. Both content scripts match only `https://www.odoo.com/odoo*`. There is no background worker, remote executable code, external service, cookie permission, or host permission.

The isolated content script runs at `document_idle` and creates bounded Shadow DOM hosts. A low-layer panel host is appended directly to Odoo's active `.o_form_sheet`, so the compact Health, Industry, and Share controls share the form's scroll and stacking context. A sibling host extends the native Renew action into a split button, and a fixed overlay host contains the renewal popover. A separate fixed host contains the single shared status message. Interactive extension styles and React nodes stay inside those boundaries; the hosts ignore pointer events while interactive controls opt in. The read-only subscription-list preview is the narrow exception: it uses namespaced marker elements and one namespaced document style so it can decorate native Customer cells without intercepting input.

A separate script runs at `document_start` with `world: "MAIN"`. It shares the Odoo page's execution environment only so authenticated same-origin RPC requests use the active page session. It has no UI or extension API access. A versioned singleton replaces a stale listener after development reloads.

## Routing and lifecycle

`src/odoo/routes.ts` accepts only the exact `www.odoo.com` hostname and `/odoo` path prefix. It supports direct `/odoo/subscriptions/{id}` routes and nested routes whose active model segment is `sale.order/{id}`. A nested route ending in another model, such as `res.partner/{id}`, unmounts the subscription features.

Share Links has a separate route contract. It accepts roots under `/odoo/subscriptions/` and `/odoo/sales/`, plus Odoo's nested technical `/odoo/sale.order/` routes as renewal candidates. It requires the last active SPA candidate to be a rendered `sale.order` form with `partner_id` and binds every request to the exact target, record ID, and pathname. Server eligibility then requires `draft` or `sent`. Subscription and technical `sale.order` routes additionally require `subscription_state = 2_renewal`; Sales routes intentionally include every quotation in those states, including Success Packs.

Odoo is a single-page application. The entrypoint watches relevant DOM changes, URL changes, history events, viewport changes, and theme changes, then coalesces bursts into one idempotent render. Feature state resets when the active sale order changes. Form recognition is deliberately neutral: the rendered page must be an unambiguous `sale.order` subscription form containing `partner_id`. Each feature then applies its own eligibility policy instead of sharing a single business rule:

- Account Health accepts one exact visible English badge: **In Progress** or **Paused**.
- Industry independently accepts one exact visible English badge: **In Progress** or **Paused**.
- Renewals does not trust the badge for business eligibility. Its server preflight requires the exact technical state `3_progress`; `4_paused` is ineligible.

An absent, translated, duplicated, or otherwise ambiguous badge hides Health and Industry. Text-node observation lets those controls appear or disappear when Odoo changes the badge without navigating to another URL. The separate policies are intentionally retained even while their current accepted labels match.

The subscription-list preview does not use the URL as an eligibility gate. It requires an active `.o_list_view.o_view_controller.o_action`, a native Odoo list table containing `name`, `partner_id`, and `subscription_state`, plus at least one of `plan_id`, `next_invoice_date`, or `recurring_total`. It targets each `td[name="partner_id"]` independently of column order and ignores grouping and total rows. URL changes remain one signal for invalidating stale SPA state and rerunning the structural check.

The visual controls locate the visible native `[name="date_order"]` widget and contract title on each render. The preferred title anchor is `[name="client_order_ref"]`; the form's `h1` is a Firefox-tolerant fallback when Odoo omits that wrapper. The layout reader accepts both Odoo's paired `.o_cell` structure and flatter `sale.order` markup, using nearby labels and links only for typography rather than as hard eligibility requirements. The compact framed panel attaches to the top edge of the form sheet, begins 48 pixels after the rendered title, shrinks to its current content, and caps its right edge before the native `subscription_state` badge. Industry appears first and Health second. This keeps long industry names away from the status badge while still following chatter, zoom, responsive width, native scrolling, and SPA rerenders. If the essential anchors are absent or leave less than 260 pixels of safe width, the controls do not fall back to an unrelated position.

The panel uses a low local stack level and no top border, visually joining the form sheet boundary while remaining below Odoo sticky controls and dialogs. The Industry dropdown is layered only inside this local panel. The fixed status host uses a normal application-level stack instead of a maximum integer stack.

The compact frame fits its current content, while the Industry picker expands independently from the frame's left edge so complete option labels remain visible. The panel is not mounted with loading placeholders: it appears with a short fade only after every enabled feature has settled for the active record. Firefox sometimes reports the contract heading as a full-width block; positioning therefore measures the rendered title text, with a typography-based fallback, instead of trusting the block width.

`FeatureModule` defines the reusable lifecycle contract for future modules. The React implementation shares one mount while Health, Industry, and Renewals retain separate services, eligibility policies, and server contracts. This avoids coupling future rule changes merely because the current form anchors overlap.

## Odoo RPC

`PageContextOdooGateway` keeps the typed read interface used for capability discovery and exposes closed business operations for mutations. It also exposes an internal read-only connection check that is independent from every feature. It exchanges versioned messages with the page bridge using random client and request IDs. Both sides require the exact `window` source, `https://www.odoo.com` origin, protocol version, client ID, and pending request ID. Concurrent calls are correlated independently; stale or foreign responses are ignored. A short handshake distinguishes a missing bridge from an Odoo timeout, and disposal rejects all pending calls.

On every allowed `https://www.odoo.com/odoo*` page, the isolated entrypoint asks the bridge to verify the current authenticated session through `/web/session/get_session_info`. This probe runs even when the page is not a subscription and does not depend on Health, Industry, record status, or enabled feature settings. A successful probe returns only `{ authenticated: true, userDisplayName? }`: the optional name or login is sanitized and bounded before crossing the bridge, while user IDs, cookies, session identifiers, and the raw session response never cross. The isolated script keeps the label only in volatile tab memory. When the popup opens, it uses the existing host access to request that live value from the active Odoo content script; no `tabs`, `identity`, or cookie permission is declared. The label is never written to local or synchronized storage. The probe repeats after Odoo SPA navigation and when the browser comes back online.

The bridge validates every request before contacting Odoo, then uses only reviewed same-origin Odoo endpoints with `credentials: same-origin`. Read-only capability discovery remains limited to:

- `sale.order`: field metadata for `tag_ids`; separate reads limited to either `tag_ids` or `partner_id`; and bounded list searches using only an exact `name in [...]` domain and returning only `id`, `name`, and `tag_ids`.
- `crm.tag`: an exact-name search for the three canonical health tags returning only `id` and `name`.
- `res.partner`: field metadata and reads limited to `industry_id`.
- `res.partner.industry`: the ordered industry search returning only `id` and `name`.

Generic `write`, `create`, `unlink`, arbitrary button calls, and arbitrary server actions are not part of the isolated gateway. Mutations use closed operation names whose runtime fixes the model, fields, context, commands, and response shape:

- `applyHealthState` and `undoHealthState` re-read the subscription state and current tags, preserve every unrelated tag, and replace only the canonical Health subset.
- `applyIndustry` and `undoIndustry` re-read the subscription state and linked partner, reject a changed partner, and update only that partner's `industry_id`.
- Renewal operations perform preflight, native Renew, the required native Copy actions, bounded native global-discount cleanup/application, Share-link retrieval, summary verification, and explicit run disposal.
- Share Link operations perform an exact current-route check, bounded `state` and `subscription_state` reads, and—only after a user click—the native `portal.share.default_get` call for the current quotation.

Every other model, method, field, domain, record batch, operation, or payload shape fails before fetch. Successful data is reduced to the closed result contracts before crossing back to the isolated script.

Record IDs remain positive safe integers except on the exact partner path. Odoo can expose a persistent readable `res.partner` record through `sale.order.partner_id` with a signed nonzero safe integer. The bridge accepts that value only as the `partner_id` relation and for `res.partner` request IDs and sanitized response record IDs, preserving it unchanged for Industry reads, writes, and safe Undo. Zero and unsafe integers are rejected. Sale-order, tag, industry, and user IDs, plus every other relation value, remain positive.

Before enabling mutations, services confirm the relevant field type and relation. The page runtime revalidates the technical subscription state immediately around the closed Health and Industry operation; only `3_progress` and `4_paused` are accepted. Responses are shape-checked. The general connection check reports only bridge absence, timeout, authentication, authorization, network, endpoint, response-shape, and server failures. Missing tags, missing fields, and other feature capability failures stay local to the affected feature and never change the global Odoo connection state. Raw Odoo error data is never forwarded, persisted, or shown.

## Account health

The health service discovers the relation behind `sale.order.tag_ids`, queries exact canonical names, and requires one unique ID for each state. Its form bootstrap reads only `tag_ids`; eligibility is provided independently by the rendered-form policy. A selection calls the closed Health operation. The page runtime re-reads current tags, removes only the three canonical Health IDs, appends the requested ID, and writes the complete result. Tags added concurrently by another user are therefore preserved. Selecting the active state sends no Health ID, which clears Health.

Duplicate health tags display a warning and an indeterminate textual state. The next selection cleans the duplicates. If canonical tags are missing or ambiguous, all health writes stay disabled.

When enabled independently, the list preview reads the visible subscription names in batches of at most 100 and maps their tag IDs to High, Medium, Low, Not set, or Ambiguous. A 3-pixel noninteractive marker is inserted at the left edge of each native Customer cell. A lighter gray loading marker reserves the final layout immediately; the same element transitions to the resolved color without shifting the customer text. Missing, duplicate, unsafe, or stale records fail closed, and navigation, view changes, setting changes, and teardown remove the markers immediately.

## Industry

The industry service validates `res.partner.industry_id`, reads `sale.order.partner_id`, and uses that exact signed nonzero ID for all `res.partner` reads and closed mutations. The ID is never normalized or replaced; only the partner path permits a negative value. The page runtime re-reads `sale.order.partner_id` immediately before mutation and refuses to update a different partner. Choices and their IDs come dynamically from `res.partner.industry` and remain positive; clearing writes `false`. The current value appears as an Odoo-style link above Health. Clicking it opens a compact anchored dropdown with search, outside-click dismissal, native Tab behavior, explicit Arrow Up/Down option movement, Enter selection, Escape to close, and current-selection semantics.

## Multi-year renewals

Renewals is disabled by default. After a server preflight confirms `3_progress`, the split-button menu reads the technical recurring-plan billing period, converts it to months, and offers only one- through five-year targets whose duration is equal to or longer than the current contract. Names, `Until`, age, and remaining duration are not used. Invalid, inaccessible, unsupported, or longer-than-five-year periods fail closed.

The planner mirrors native Odoo behavior. It creates one native renewal at the current duration. A sub-year source is copied to an annual technical base; an annual or multi-year source uses its renewal directly. Every longer target is copied from the clean common base before discounts are applied. Only native global-discount lines carrying Odoo's bounded technical marker on quotes owned by the current run may be removed. A positive editable discount uses Odoo's native Global Discount wizard with an empty description; zero creates no line. Plans, templates, lineage, commercial identity, lines, totals, currency, and discount effects are verified between steps.

The content-script controller runs the short sequence while the source tab remains open. It stops at the first failure, performs read-only reconciliation for uncertain post-commit outcomes, never retries a mutation automatically, and exposes confirmed partial results. Its internal mutation timeout is 45 seconds; reconciliation waits 1.5 seconds and polls for up to 10 seconds; the gateway timeout is 75 seconds, preserving at least a 15-second outer safety margin. A `finally` operation destroys the run's page-side fingerprints, resolved Copy actions, and mutation authority. Quote results and tokenized Share URLs remain only in volatile tab memory.

Links are obtained through the native Share flow without sending email. Clipboard writes occur only from an explicit user click through `navigator.clipboard.writeText`; the extension never reads the clipboard and declares only `clipboardWrite`. Opening quotes uses validated same-origin Share URLs and reports browser-blocked tabs. The extension updates the count of an already-rendered native Renewal Quote smart button, but never synthesizes a missing button.

## Share Links shortcut

Share Links is disabled by default. Enabling it preselects Renewal Quotations, Sales Quotations, and the optional success confirmation. The compact Share icon remains hidden until the closed server preflight confirms the current record. A click performs one link request, validates the exact native Odoo URL, and writes it to the clipboard. Duplicate clicks are blocked while pending; a SPA route change invalidates completion, and errors remain visible even when success confirmations are disabled. Links and access tokens are never persisted, logged, or included in toast content.

## Settings and compatibility

`ExtensionSettings` has schema version 5 and stores only the master switch, four feature switches, two Share Link target switches, the independent list-preview switch, four per-feature success-toast preferences, four editable two- through five-year discount presets, and appearance preference in browser synchronized storage. Renewals, Share Links, and the list preview default to disabled. The one-year preset is normalized to zero on every load and migration. Earlier schemas and V4 field-scoped preferences migrate without changing valid existing feature or appearance choices.

Preference changes are field-scoped patches. A per-context queue re-reads the newest synchronized value before each write, so a popup edit and a content-script toast suppression do not overwrite independent fields. Open popups subscribe to external changes. All controls stay inert, disabled, and `aria-busy` until hydration completes. A sanitized general connection code and timestamp are stored locally. The optional connected-user label is explicitly excluded from storage and is available only through the active tab's live message listener. Runtime validation rejects malformed types, unknown connection codes, legacy feature-specific diagnostic codes, and malformed live identity responses. Storage failures fall back safely in the UI, and connection-status storage can never block any feature controls.

## Status and Undo

`StatusMessage` supports success, error, warning, info, an optional secondary detail, an optional asynchronous action, and an optional suppression action. A single owned status store prevents stacked or cross-feature notifications. Each message uses a kind-specific outline and a prominent primary line. Every kind closes automatically: success after seven seconds, errors and warnings after eight seconds, and informational messages after six seconds. The countdown pauses while the pointer or keyboard focus remains inside the message and resumes with the remaining time. Health and Industry success confirmations place Undo and dismissal on the upper right and “Don't show again” beneath them; that action disables only the matching feature's future success confirmations. Errors, warnings, renewal progress, and informational messages remain enabled. Health confirmations explain on separate detail lines that the extension indicator is current immediately while Odoo's native Tags widget refreshes on the next page reload. Before Undo writes a previous value, the closed operation re-reads the record and compares it with the value originally applied. If anything changed externally, Undo stops and warns the user.

Health and Industry selections update the local interface before the closed RPC completes. Every mutation is associated with the active record and a route generation. A failed operation restores the exact previous snapshot only while that record still owns the UI; completion, errors, toasts, and Undo from an old record are discarded after SPA navigation.

## Adding a feature

Create a service under `src/features`, use only the typed gateway, define route eligibility, add settings behind a schema-compatible switch, and expose UI through the shared Shadow DOM. Tests must cover capability detection, data preservation, errors, repeated SPA renders, and external-change-safe Undo.
