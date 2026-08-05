# Architecture

## Runtime boundary

WXT generates Chrome/Chromium and Firefox Manifest V3 builds from one React and TypeScript codebase. The only content script matches `https://www.odoo.com/odoo*`. There is no background worker, injected page script, remote executable code, or separate service.

The content script creates one fixed host and attaches an open Shadow DOM. All extension styles and React nodes stay inside that boundary; the host itself ignores pointer events while interactive controls opt in.

## Routing and lifecycle

`src/odoo/routes.ts` accepts only the exact `www.odoo.com` hostname and `/odoo` path prefix. It supports direct `/odoo/subscriptions/{id}` routes and nested routes whose active model segment is `sale.order/{id}`. A nested route ending in another model, such as `res.partner/{id}`, unmounts the subscription features.

Odoo is a single-page application. The entrypoint watches DOM changes, URL changes, history events, viewport changes, and theme changes, then schedules an idempotent render. Feature state resets when the active sale order changes. The UI mounts only when a rendered Odoo form includes `partner_id` and either a subscription route or `subscription_state`.

`FeatureModule` defines the reusable eligibility and lifecycle contract for future modules. The initial React implementation shares one mount while the health and industry services remain independently enabled and isolated.

## Odoo RPC

`SameSessionOdooGateway` implements typed `read`, `fieldsGet`, `searchRead`, and `write` calls. Requests use relative `/web/dataset/call_kw/{model}/{method}` URLs, JSON-RPC bodies, `credentials: same-origin`, timeouts, and no stored credentials.

Before enabling writes, services confirm the relevant field type and relation. Responses are shape-checked. Authentication, authorization, network, missing-field, incompatibility, and general server failures become sanitized compatibility codes and user messages; raw Odoo error data is never persisted or shown.

## Account health

The health service discovers the relation behind `sale.order.tag_ids`, queries exact canonical names, and requires one unique ID for each state. A selection filters all three health IDs from the current array, appends exactly the chosen ID, and writes the full many-to-many replacement command. Other tags are preserved. Selecting the active state sends no health ID, which clears health.

Duplicate health tags display a warning and an indeterminate textual state. The next selection cleans the duplicates. If canonical tags are missing or ambiguous, all health writes stay disabled.

## Industry

The industry service validates `res.partner.industry_id`, reads `sale.order.partner_id`, and uses that exact ID for all reads and writes. Choices come dynamically from `res.partner.industry`; clearing writes `false`. The drawer provides search, native Tab/Enter behavior, Arrow Up/Down option movement, Escape to close, and current-selection semantics.

## Settings and compatibility

`ExtensionSettings` has schema version 1 and stores only the master switch, two feature switches, and appearance preference in browser synchronized storage. A sanitized compatibility code and timestamp are stored locally. Migrations normalize absent or unknown settings to safe defaults.

## Status and Undo

`StatusMessage` supports success, error, warning, info, and an optional asynchronous action. Successful writes show Undo for seven seconds. Before Undo writes a previous value, the service re-reads the record and compares it with the value originally applied. If anything changed externally, Undo stops and warns the user.

## Adding a feature

Create a service under `src/features`, use only the typed gateway, define route eligibility, add settings behind a schema-compatible switch, and expose UI through the shared Shadow DOM. Tests must cover capability detection, data preservation, errors, repeated SPA renders, and external-change-safe Undo.
