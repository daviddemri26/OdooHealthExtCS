# Troubleshooting

## Controls do not appear

Confirm the URL starts exactly with `https://www.odoo.com/odoo`, the active page is a subscription form, and the popup's master and feature switches are enabled. Reload the tab after install/update. The extension intentionally stays absent on contacts, portal, documentation, commerce, and other hosts or paths.

## Session expired

Sign in to Odoo again in the same tab and reload the subscription. The extension does not store or refresh sessions and cannot ask for credentials.

## Permission or access denied

Your Odoo user may read the record but lack write access to the relevant field. Verify the same change can be made through Odoo's native interface. Request the correct Odoo access through normal internal channels; do not grant the extension broader browser permissions.

## Health is unavailable

The extension requires one unique exact match for each canonical tag: `Health - High`, `Health - Medium`, and `Health - Low`. A missing tag or multiple records with the same canonical name disables writes. Correct the Odoo tag configuration, then reload. Do not rename tags in code or select a visually similar tag.

## Industry is unavailable or empty

Confirm the subscription has a valid `partner_id`, `res.partner.industry_id` exists and is accessible, and industry records are readable. The list is loaded dynamically from Odoo. A missing field or changed relation is treated as a compatibility problem.

## Write failed

Keep the error visible, confirm connectivity and Odoo permissions, reload the record to see its authoritative value, and retry once. If the value changed elsewhere, the safe Undo will refuse to overwrite it. Do not repeatedly click while a write is pending.

## Compatibility warning after an Odoo update

Record the extension version, Odoo version, browser/version, sanitized compatibility code, and steps using a demo record. Follow the Odoo 19.x or 20 validation process in [ODOO_COMPATIBILITY.md](ODOO_COMPATIBILITY.md). Never attach raw network responses or real customer data.

## Build or packaging failure

Use Node 22 LTS and pnpm 10, run `pnpm install --frozen-lockfile`, and retry `pnpm package`. An icon failure means the approved SVG is absent or invalid. Manifest failures indicate widened permissions or URL scope. Sensitive-scan failures must be removed at the source, not excluded without security review.
