# Firefox Add-ons Listing

## Name

OdooHealthExtCS

## Summary

Faster account health and customer industry updates for authorized Odoo Customer Success users.

## Description

OdooHealthExtCS version 1 is an internal productivity extension that adds focused account-health and customer-industry controls to In Progress Odoo subscription records. The controls stay hidden on quotations, closed subscriptions, and every other status.

The compact Odoo-style fields appear directly above Order Date. Account health sets High, Medium, or Low, clears the active value, preserves unrelated tags, and safely cleans duplicate health tags on the next selection. The inline Industry dropdown searches Odoo's live choices and updates the exact customer linked to the subscription without navigating away. Health and Industry success confirmations can be hidden independently while errors and warnings remain visible.

The interface supports keyboard navigation, immediate optimistic updates with visible rollback on failure, light and dark appearance, sanitized status messages, and a seven-second Undo that refuses to overwrite a later change. Users can disable the entire extension or either feature from the popup. The connection card can show the current Odoo user's name or login so the user can confirm which account is active; that label remains only in the active tab's memory and is never stored or shared.

It runs only on `https://www.odoo.com/odoo*`, uses the current Odoo session, and sends no Odoo page data to external services. It is not an installable Odoo module and is not an official Odoo product.

© DDEM

## Metadata recommendations

- Add-on ID: `odoo-health-ext-cs@daviddemri26.github.io`
- Category: Other or Productivity, depending on the current AMO taxonomy.
- License: MIT.
- Language: English (United States).
- Homepage: `https://daviddemri26.github.io/OdooHealthExtCS/`
- Support: `https://daviddemri26.github.io/OdooHealthExtCS/support.html`
- Privacy: `https://daviddemri26.github.io/OdooHealthExtCS/privacy.html`

## Data collection declaration

Required data collection: none.

The extension processes Odoo fields in the browser and sends user-requested changes only to `www.odoo.com` through the existing same-origin session. Settings may show the current Odoo user's name or login from the active tab, but that label remains inside the add-on and local browser, is not stored, and is not transmitted to the developer or any third party. The add-on contains no analytics, advertising, tracking, or remote executable code.

## Source-build instructions for AMO reviewers

The source archive is generated from the release tag and included with each listed submission.

Environment: Linux or macOS, Node.js 22 LTS, pnpm 10.

```bash
pnpm install --frozen-lockfile
pnpm package
```

The Firefox extension appears at `.output/firefox-mv3`; the unsigned submission ZIP is `artifacts/OdooHealthExtCS-vX.Y.Z-firefox.zip`. The build downloads npm dependencies during installation but fetches no build-time source from other locations. Generated JavaScript and CSS come from the versioned TypeScript, React, and CSS files. The exact dependency graph is in `pnpm-lock.yaml`.
