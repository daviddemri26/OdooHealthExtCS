# Architecture

## Runtime boundary

WXT generates Chrome/Chromium and Firefox Manifest V3 builds from one React and TypeScript codebase. Both content scripts match only `https://www.odoo.com/odoo*`. There is no background worker, remote executable code, external service, cookie permission, or host permission.

The isolated content script runs at `document_idle` and creates two open Shadow DOM hosts. A low-layer panel host is appended directly to Odoo's active `.o_form_sheet`, so the compact controls share the form's scroll and stacking context. A separate fixed host contains only transient status messages. All extension styles and React nodes stay inside those boundaries; the hosts ignore pointer events while interactive controls opt in.

A separate script runs at `document_start` with `world: "MAIN"`. It shares the Odoo page's execution environment only so authenticated same-origin RPC requests use the active page session. It has no UI or extension API access. A versioned singleton replaces a stale listener after development reloads.

## Routing and lifecycle

`src/odoo/routes.ts` accepts only the exact `www.odoo.com` hostname and `/odoo` path prefix. It supports direct `/odoo/subscriptions/{id}` routes and nested routes whose active model segment is `sale.order/{id}`. A nested route ending in another model, such as `res.partner/{id}`, unmounts the subscription features.

Odoo is a single-page application. The entrypoint watches DOM changes, URL changes, history events, viewport changes, and theme changes, then schedules an idempotent render. Feature state resets when the active sale order changes. The UI mounts only when a rendered Odoo form includes `partner_id` and either a subscription route or `subscription_state`.

The visual controls locate the visible native `[name="date_order"]` widget and contract title on each render. The preferred title anchor is `[name="client_order_ref"]`; the form's `h1` is a Firefox-tolerant fallback when Odoo omits that wrapper. The layout reader accepts both Odoo's paired `.o_cell` structure and flatter `sale.order` markup, using nearby labels and links only for typography rather than as hard eligibility requirements. The compact framed panel attaches to the top edge of the form sheet, begins 48 pixels after the rendered title, shrinks to its current content, and caps its right edge before the native `subscription_state` badge. Industry appears first and Health second. This keeps long industry names away from the status badge while still following chatter, zoom, responsive width, native scrolling, and SPA rerenders. If the essential anchors are absent or leave less than 260 pixels of safe width, the controls do not fall back to an unrelated position.

The panel uses a low local stack level and no top border, visually joining the form sheet boundary while remaining below Odoo sticky controls and dialogs. The Industry dropdown is layered only inside this local panel. The fixed status host uses a normal application-level stack instead of a maximum integer stack.

The compact frame fits its current content, while the Industry picker can expand independently so complete option labels remain visible. Firefox sometimes reports the contract heading as a full-width block; positioning therefore measures the rendered title text, with a typography-based fallback, instead of trusting the block width.

`FeatureModule` defines the reusable eligibility and lifecycle contract for future modules. The initial React implementation shares one mount while the health and industry services remain independently enabled and isolated.

## Odoo RPC

`PageContextOdooGateway` keeps the typed `read`, `fieldsGet`, `searchRead`, and `write` interface used by features. It exchanges versioned messages with the page bridge using random client and request IDs. Both sides require the exact `window` source, `https://www.odoo.com` origin, protocol version, client ID, and pending request ID. Concurrent calls are correlated independently; stale or foreign responses are ignored. A short handshake distinguishes a missing bridge from a 15-second Odoo timeout, and disposal rejects all pending calls.

The bridge validates every request before contacting Odoo, then uses the absolute same-origin `/web/dataset/call_kw/{model}/{method}` URL with `credentials: same-origin`. Its allow-list is limited to:

- `sale.order`: field metadata for `tag_ids`; reads of `tag_ids`, `partner_id`, and `subscription_state`; and writes containing only a complete `tag_ids` many-to-many replacement command.
- `crm.tag`: an exact-name search for the three canonical health tags returning only `id` and `name`.
- `res.partner`: field metadata, reads, and writes limited to `industry_id`.
- `res.partner.industry`: the ordered industry search returning only `id` and `name`.

Every other model, method, field, domain, record batch, or write shape fails before fetch. Successful data is reduced to the allowed fields before crossing back to the isolated script.

Before enabling writes, services confirm the relevant field type and relation. Responses are shape-checked. Bridge absence, timeout, authentication, authorization, network, endpoint, missing-field, incompatibility, and general server failures become distinct sanitized compatibility codes and user messages; raw Odoo error data is never forwarded, persisted, or shown.

## Account health

The health service discovers the relation behind `sale.order.tag_ids`, queries exact canonical names, and requires one unique ID for each state. A selection filters all three health IDs from the current array, appends exactly the chosen ID, and writes the full many-to-many replacement command. Other tags are preserved. Selecting the active state sends no health ID, which clears health.

Duplicate health tags display a warning and an indeterminate textual state. The next selection cleans the duplicates. If canonical tags are missing or ambiguous, all health writes stay disabled.

## Industry

The industry service validates `res.partner.industry_id`, reads `sale.order.partner_id`, and uses that exact ID for all reads and writes. Choices come dynamically from `res.partner.industry`; clearing writes `false`. The current value appears as an Odoo-style link above Health. Clicking it opens a compact anchored dropdown with search, outside-click dismissal, native Tab behavior, explicit Arrow Up/Down option movement, Enter selection, Escape to close, and current-selection semantics.

## Settings and compatibility

`ExtensionSettings` has schema version 1 and stores only the master switch, two feature switches, and appearance preference in browser synchronized storage. A sanitized compatibility code and timestamp are stored locally. Migrations normalize absent or unknown settings to safe defaults.

## Status and Undo

`StatusMessage` supports success, error, warning, info, an optional secondary detail, and an optional asynchronous action. Each message uses a kind-specific outline and a prominent primary line. Every kind closes automatically: success after seven seconds, errors and warnings after eight seconds, and informational messages after six seconds. The countdown pauses while the pointer remains over the message and resumes with the remaining time. Health confirmations explain on separate detail lines that the extension indicator is current immediately while Odoo's native Tags widget refreshes on the next page reload. Before Undo writes a previous value, the service re-reads the record and compares it with the value originally applied. If anything changed externally, Undo stops and warns the user.

Health and Industry selections update the local interface before the allow-listed RPC completes. A failed write restores the exact previous snapshot and reports the sanitized error.

## Adding a feature

Create a service under `src/features`, use only the typed gateway, define route eligibility, add settings behind a schema-compatible switch, and expose UI through the shared Shadow DOM. Tests must cover capability detection, data preservation, errors, repeated SPA renders, and external-change-safe Undo.
