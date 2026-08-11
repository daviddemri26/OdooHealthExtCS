# OdooHealthExtCS v1.2.0

Version 1.2 adds an optional account-health preview directly to recognized Odoo subscription lists.

## What changed

- Show High, Medium, Low, unset, or ambiguous health beside each visible Customer value.
- Detect subscription lists from stable Odoo view and field structure instead of URL paths or column positions.
- Follow filters, pagination, grouping, reordered columns, row replacement, and Odoo SPA navigation.
- Reserve the indicator space immediately with a light loading marker, then transition the same marker to its resolved color without shifting customer names.
- Control the preview independently from the Account Health form shortcut; the new setting is disabled by default.

## Privacy and permissions

- No new browser permission or write access.
- Reads only `id`, `name`, and `tag_ids` for the visible subscription names through a strictly allow-listed, bounded Odoo request.
- Sends no Odoo data to the developer or external services.
