# Odoo Compatibility Guide

## Supported baseline

The current release targets the `www.odoo.com` Odoo 19.3 web client and its current `sale.order` subscription forms and lists. Chrome/Chromium and Firefox Manifest V3 packages are built from the same source. Firefox 142 or later is required so the manifest can declare Mozilla's mandatory no-data-collection metadata.

The extension relies on stable model semantics rather than copied DOM values:

- `sale.order.tag_ids` is a writable many-to-many relation to `crm.tag`, which contains the three exact canonical health tag names.
- `sale.order.partner_id` is the subscription's customer many-to-one. Odoo can expose its persistent readable `res.partner` record with a signed nonzero safe-integer ID, which must be preserved exactly for partner reads and writes.
- `res.partner.industry_id` is a writable many-to-one.
- `res.partner.industry` supplies industry choices.
- `sale.order.subscription_state` exposes `3_progress` and `4_paused` for the closed Health and Industry mutation checks. Renewals require `3_progress`.
- `sale.order.plan_id` points to a recurring plan whose technical billing-period value and unit determine renewal eligibility.
- native subscription Renew, bound Copy actions, the sale-order Global Discount wizard, and the Share wizard retain the reviewed Odoo 19 contracts used by Renewals.
- authenticated JSON-RPC model calls remain available at `/web/dataset/call_kw` from the Odoo page's `MAIN` execution world.

The isolated UI never calls Odoo directly. A versioned page bridge accepts only the exact read contracts and closed Health, Industry, and Renewals operations documented in [ARCHITECTURE.md](ARCHITECTURE.md), validates them before fetch, and sanitizes results before returning them. Compatibility also requires Chrome and Firefox to preserve Manifest V3 `MAIN`-world content-script support.

The route and form checks use several signals so minor web-client layout changes do not automatically enable mutations on the wrong model. Health and Industry each accept only one unambiguous English **In Progress** or **Paused** badge. Renewals uses its own server-side technical-state check and remains unavailable on Paused. The list preview is read-only and requires the complete documented list-controller and technical-field signature instead of relying on URL text or column position.

## Future Odoo 19.x releases

For each 19.x release, run the complete QA checklist in both browsers. Confirm the bridge handshake, exact request and operation allow-list, direct and nested subscription routes, separate In Progress/Paused form policies, list-view structural signature, reordered columns, grouped rows, pagination and filters, field metadata, canonical tags, concurrent-tag preservation, linked-partner revalidation, signed nonzero partner-ID preservation, positive industry IDs, permission behavior, light/dark rendering, and SPA navigation. Confirm separately that Account Health loads from `tag_ids` alone.

For Renewals, confirm the technical plan interval/unit fields, exact server state, native Renew return, only the required bound Copy actions, template and line transformations, the native global-discount marker and wizard schema, Share-link shape, lineage, total verification, and run cleanup. The Copy labels are resolved under the reviewed English Odoo context and all loaded actions must retain the expected `sale.order` server-action metadata. If a DOM anchor changes but the model contract is intact, update the anchor selector without widening route or feature eligibility.

## Odoo 20

Treat Odoo 20 as unsupported until a controlled compatibility pass succeeds. Check the page-bridge handshake, read-only session endpoint, RPC and action endpoints, JSON-RPC envelope, model and field names, many-to-many command format, subscription states, recurring-plan interval, native Renew and Copy actions, discount and Share wizards, route structure, form markers, CSP behavior, and browser-store policies. Update the bridge allow-list only for reviewed, feature-required contracts and add sanitized synthetic tests for every change before declaring support.

## Failure policy

Unknown fields, wrong relations, malformed records, missing or duplicate canonical tag definitions, access denial, unsupported subscription states, unavailable Copy actions, ambiguous creation reconciliation, and unsupported responses fail closed. A partner ID may be signed but must be a nonzero safe integer; zero or unsafe partner IDs are rejected, and order, tag, industry, user, and all other relation IDs must remain positive. The affected feature becomes unavailable and exposes only a sanitized feature error; it does not overwrite the independent general connection status. Do not add fallback mutations based on visible labels or positional DOM scraping.

Record verified versions and dates in release notes. A successful build proves package integrity, not live Odoo compatibility; controlled noncritical record validation is required before the first store release and after material Odoo changes.
