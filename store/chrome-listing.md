# Chrome Web Store Listing

## Product title

OdooHealthExtCS

## Short summary

Faster account health and customer industry updates for authorized Odoo Customer Success users.

## Full description

OdooHealthExtCS adds two focused productivity controls to Odoo subscription records for authorized internal Customer Success users.

Set Account health to High, Medium, or Low from a compact Odoo-style field placed directly above Order Date. The extension identifies the canonical Odoo tags, preserves unrelated tags, removes duplicate health values on the next selection, and lets you clear the active value.

Click the Industry value directly above Health to open a compact searchable dropdown and update the exact linked customer without navigating away. Clear the field with No industry when appropriate.

Smooth light and dark interfaces explain the current value and show success, warning, or error feedback. Successful writes include a seven-second Undo action that first confirms the record has not changed elsewhere.

The popup lets each user enable or disable the extension, each feature, and Auto/Light/Dark appearance.

This is an internal productivity browser extension, not an installable Odoo module and not an official Odoo product. It runs only on `https://www.odoo.com/odoo*`, uses the user's current authenticated Odoo session, and sends no Odoo page data to external services.

## Single purpose

Make required account-health and customer-industry maintenance faster and safer from Odoo subscription records.

## Feature list

- High, Medium, Low, and clear account-health actions.
- Preservation of unrelated Odoo tags and safe duplicate cleanup.
- Searchable inline industry dropdown using the subscription's exact customer.
- No industry clearing option and current-value highlighting.
- Keyboard navigation, light/dark appearance, status feedback, and safe Undo.
- Per-feature controls and sanitized compatibility status.

## Permission justification

`storage`: saves only extension enablement, feature enablement, appearance preference, and a sanitized compatibility code/timestamp. It does not store Odoo records or session data.

Site access to `https://www.odoo.com/odoo*`: required to display the controls on Odoo subscription forms and perform user-requested same-origin reads/writes. The extension does not run on other Odoo pages, other Odoo hosts, or other websites.

## Privacy and data-use declarations

- Handles Odoo page/model data only to display current values and perform explicit user actions.
- Data is processed locally and through the existing same-origin Odoo session.
- No sale, advertising, analytics, tracking, profiling, or external data transfer.
- No storage of customer records, cookies, passwords, CSRF/session values, or raw server errors.
- No remotely hosted executable code.
- No use unrelated to the extension's single purpose.

## URLs

- Homepage: `https://daviddemri26.github.io/OdooHealthExtCS/`
- Privacy: `https://daviddemri26.github.io/OdooHealthExtCS/privacy.html`
- Support: `https://daviddemri26.github.io/OdooHealthExtCS/support.html`

## Recommendations

- Visibility: Unlisted/internal distribution.
- Category: Productivity.
- Language: English (United States).
