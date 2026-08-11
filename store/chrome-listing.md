# Chrome Web Store Listing

## Product title

OdooHealthExtCS

## Short summary

Faster account health and customer industry updates for authorized Odoo Customer Success users.

## Full description

OdooHealthExtCS adds focused productivity controls to In Progress Odoo subscription records for authorized internal Customer Success users. The interactive controls stay hidden on quotations, closed subscriptions, and every other status.

Set Account health to High, Medium, or Low from a compact Odoo-style field placed directly above Order Date. The extension identifies the canonical Odoo tags, preserves unrelated tags, removes duplicate health values on the next selection, and lets you clear the active value.

An independent, disabled-by-default setting can add a compact High, Medium, Low, or gray health indicator beside each customer in recognized Odoo subscription lists. A light placeholder reserves the layout while visible rows load, so customer names do not jump. The preview is read-only, follows moved Customer columns and Odoo SPA rerenders, and does not rely on the page URL to identify a subscription list.

Click the Industry value directly above Health to open a compact searchable dropdown and update the exact linked customer without navigating away. Clear the field with No industry when appropriate.

The interface updates immediately, rolls back visibly if Odoo rejects an action, and works in Odoo light and dark modes. Clear success, warning, and error feedback is shown in a compact status bar. Successful writes include a seven-second Undo action that first confirms the record has not changed elsewhere. Users may hide Health and Industry success confirmations independently from Settings or directly from the confirmation itself.

The popup lets each user enable or disable the extension, each feature, the independent subscription-list preview, and Auto/Light/Dark appearance. Its connection card shows the current Odoo user's name or login so the user can confirm which account is active; that label remains only in the active tab's memory and is never stored or shared.

This is an internal productivity browser extension, not an installable Odoo module and not an official Odoo product. It runs only on `https://www.odoo.com/odoo*`, uses the user's current authenticated Odoo session, and sends no Odoo page data to external services.

© DDEM

## Single purpose

Make required account-health and customer-industry maintenance faster and safer from Odoo subscription records.

## Feature list

- High, Medium, Low, and clear account-health actions.
- Optional read-only health-color indicators in recognized subscription lists.
- Preservation of unrelated Odoo tags and safe duplicate cleanup.
- Searchable inline industry dropdown using the subscription's exact customer.
- No industry clearing option and current-value highlighting.
- Keyboard navigation, optimistic updates, light/dark appearance, status feedback, and safe Undo.
- Per-feature controls and sanitized compatibility status.

## Permission justification

`storage`: saves only extension enablement, feature enablement, list-preview enablement, per-feature success-confirmation preferences, appearance preference, and a sanitized compatibility code/timestamp. It does not store Odoo records or session data.

Site access to `https://www.odoo.com/odoo*`: required to display the controls on Odoo subscription forms and perform user-requested same-origin reads/writes. The extension does not run on other Odoo pages, other Odoo hosts, or other websites.

## Privacy and data-use declarations

- Handles Odoo page/model data only to display current values, including visible subscription-list health, and perform explicit user actions.
- Handles the current Odoo user's display name or login only to show which account is connected in Settings.
- Data is processed locally and through the existing same-origin Odoo session.
- The connected-user label remains only in volatile tab memory and is never stored or sent to the developer or a third party.
- No sale, advertising, analytics, tracking, profiling, or external data transfer.
- No storage of customer records, cookies, passwords, CSRF/session values, or raw server errors.
- No remotely hosted executable code.
- No use unrelated to the extension's single purpose.

Chrome Privacy practices selection for the connected-user display:

- Select **Personally identifiable information** because Chrome includes names, usernames, and email addresses even when processed only locally.
- Declare that it is used only for the user-facing connected-account indicator.
- Declare no sale, external transfer, advertising, analytics, profiling, or storage of that label.
- Keep all three Limited Use certifications selected.

## URLs

- Homepage: `https://daviddemri26.github.io/OdooHealthExtCS/`
- Privacy: `https://daviddemri26.github.io/OdooHealthExtCS/privacy.html`
- Support: `https://daviddemri26.github.io/OdooHealthExtCS/support.html`

## Recommendations

- Visibility: Unlisted/internal distribution.
- Category: Productivity.
- Language: English (United States).
