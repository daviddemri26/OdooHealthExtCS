# Odoo Compatibility Guide

## Supported baseline

The current release targets the `www.odoo.com` Odoo 19.3 web client and its current `sale.order` subscription forms and lists. Chrome/Chromium and Firefox Manifest V3 packages are built from the same source. Firefox 142 or later is required so the manifest can declare Mozilla's mandatory no-data-collection metadata.

The extension relies on stable model semantics rather than copied DOM values:

- `sale.order.tag_ids` is a writable many-to-many relation to `crm.tag`, which contains the three exact canonical health tag names.
- `sale.order.partner_id` is the subscription's customer many-to-one.
- `res.partner.industry_id` is a writable many-to-one.
- `res.partner.industry` supplies industry choices.
- authenticated JSON-RPC model calls remain available at `/web/dataset/call_kw` from the Odoo page's `MAIN` execution world.

The isolated UI never calls Odoo directly. A versioned page bridge accepts only the exact Health and Industry operations documented in [ARCHITECTURE.md](ARCHITECTURE.md), validates them before fetch, and sanitizes results before returning them. Compatibility also requires Chrome and Firefox to preserve Manifest V3 `MAIN`-world content-script support.

The route and form checks use several signals so minor web-client layout changes do not automatically enable writes on the wrong model. The list preview is read-only and requires the complete documented list-controller and technical-field signature instead of relying on URL text or column position.

## Future Odoo 19.x releases

For each 19.x release, run the complete QA checklist in both browsers. Confirm the bridge handshake, exact request allow-list, direct and nested subscription routes, list-view structural signature, reordered columns, grouped rows, pagination and filters, field metadata, canonical tags, industry relation, permission behavior, light/dark rendering, and SPA navigation. If a DOM anchor changes but the model contract is intact, update the anchor selector without widening route or list eligibility.

## Odoo 20

Treat Odoo 20 as unsupported until a controlled compatibility pass succeeds. Check the page-bridge handshake, read-only session endpoint, RPC endpoint, JSON-RPC envelope, model and field names, many-to-many command format, route structure, form markers, CSP behavior, and browser-store policies. Update the bridge allow-list only for reviewed, feature-required contracts and add sanitized synthetic tests for every change before declaring support.

## Failure policy

Unknown fields, wrong relations, malformed records, missing or duplicate canonical tag definitions, access denial, and unsupported responses fail closed. The affected feature becomes unavailable and exposes only a sanitized feature error; it does not overwrite the independent general connection status. Do not add fallback writes based on visible labels or positional DOM scraping.

Record verified versions and dates in release notes. A successful build proves package integrity, not live Odoo compatibility; controlled noncritical record validation is required before the first store release and after material Odoo changes.
