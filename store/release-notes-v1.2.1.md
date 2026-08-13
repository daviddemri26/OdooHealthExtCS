# OdooHealthExtCS v1.2.1

Version 1.2.1 is a compatibility hotfix for Account Health and customer Industry on Odoo subscription forms.

## What changed

- Restore Industry when Odoo exposes the subscription's persistent readable `res.partner` record with a signed nonzero ID.
- Preserve that exact partner ID through the allow-listed partner read, write, and safe Undo paths.
- Load Account Health from `sale.order.tag_ids` alone, so variations in unused partner or subscription-state response fields do not disable Health.
- Keep zero and unsafe partner IDs rejected, while requiring order, tag, industry, user, and every other relation ID to remain positive.

## Privacy and permissions

- No new browser permission or external service.
- No new data collection or persistence.
- The bridge remains fail-closed and expands numeric compatibility only for the exact partner path.
