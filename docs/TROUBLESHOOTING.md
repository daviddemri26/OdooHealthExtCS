# Troubleshooting

## Controls do not appear

Confirm the URL starts exactly with `https://www.odoo.com/odoo`, the active page is a subscription form, and the popup's master and feature switches are enabled. Reload the tab after install/update. The extension intentionally stays absent on contacts, portal, documentation, commerce, and other hosts or paths.

## Session expired

Sign in to Odoo again in the same browser and reload any page under `https://www.odoo.com/odoo`. The extension does not store or refresh sessions and cannot ask for credentials.

## Extension connection unavailable

This status means the isolated interface could not complete its versioned handshake with the `MAIN`-world page bridge. It is independent from Health, Industry, and subscription records. Reload the current Odoo page after installing or reloading the extension. If it persists, disable and re-enable the extension in the browser's extension manager, then reload the Odoo page. Do not broaden site permissions or enable cookie access.

## Request timed out or network unavailable

A timeout means the page bridge started correctly but Odoo did not complete the read-only session check within 15 seconds. A network status means the browser could not reach the same-origin Odoo endpoint. Confirm the Odoo page itself still works, reload any Odoo workspace page, and record only the sanitized connection code if support is needed.

## Permission or access denied

For a general connection status, confirm that the current account can access the internal Odoo workspace, then sign in again or contact an Odoo administrator. A feature can separately report a record or field permission failure even while the general connection remains ready. Verify that feature action through Odoo's native interface and request the correct Odoo access through normal internal channels; do not grant the extension broader browser permissions.

## Health is unavailable

The extension requires one unique exact match for each canonical tag: `Health - High`, `Health - Medium`, and `Health - Low`. A missing tag or multiple records with the same canonical name disables writes. Correct the Odoo tag configuration, then reload. Do not rename tags in code or select a visually similar tag.

## Subscription-list health colors do not appear

The list preview is disabled by default. Open Account Health settings, enable **Show health in subscription lists**, and reload the Odoo tab after installing or updating the extension. The preview appears only in a native Odoo list controller containing the technical fields `name`, `partner_id`, `subscription_state`, and at least one recognized subscription field. It intentionally stays absent from generic lists, forms, Kanban views, grouped headers, and total rows. A very light gray marker may appear briefly while the visible subscriptions are read; if Odoo denies or returns an unsafe response, the preview fails closed.

## Industry is unavailable or empty

Confirm the subscription has a valid `partner_id`, `res.partner.industry_id` exists and is accessible, and industry records are readable. The list is loaded dynamically from Odoo. A missing field or changed relation is treated as a compatibility problem.

## Write failed

Keep the error visible, confirm connectivity and Odoo permissions, reload the record to see its authoritative value, and retry once. If the value changed elsewhere, the safe Undo will refuse to overwrite it. Do not repeatedly click while a write is pending.

## Compatibility warning after an Odoo update

An incompatible-endpoint connection status means the Odoo session endpoint no longer matches the bridge contract. An incompatible-response connection status means Odoo returned session information in a shape the extension cannot safely verify. Feature-specific compatibility errors remain inside the affected feature instead of replacing the general connection state. Record the extension version, Odoo version, browser/version, sanitized connection code, and steps using a demo record. Follow the Odoo 19.x or 20 validation process in [ODOO_COMPATIBILITY.md](ODOO_COMPATIBILITY.md). Never attach raw network responses or real customer data.

## Build or packaging failure

Use Node 22 LTS and pnpm 10, run `pnpm install --frozen-lockfile`, and retry `pnpm package`. An icon failure means the approved SVG is absent or invalid. Manifest failures indicate widened permissions or URL scope. Sensitive-scan failures must be removed at the source, not excluded without security review.

## Settings show “Not saved”

The popup could not write the preference to browser storage. Confirm the extension is enabled, reload it from the browser's extension manager, reopen the Odoo tab, and try once more. The on-page controls continue with safe defaults, but the failed preference may not survive the next browser session. If the message repeats, report the browser/version and extension version without including Odoo record or session data.
