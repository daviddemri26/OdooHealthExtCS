# Privacy Policy

Effective date: August 11, 2026

OdooHealthExtCS is an internal browser productivity extension for authorized Odoo Customer Success users. It is not an installable Odoo module and is not an official Odoo product.

## Data processed

On every matching `https://www.odoo.com/odoo*` workspace page, the extension performs a read-only same-origin session check so its control panel can report whether the current Odoo connection is ready. When the settings popup is opened from an active Odoo workspace tab, it may also display the current Odoo user's name or login so the user can confirm which account is connected. This label is sanitized, kept only in the active tab's memory, and is never written to browser storage. User IDs, cookies, session identifiers, and the raw session response do not leave the page bridge.

When an authorized user opens a matching Odoo subscription form whose visible status badge is **In Progress** and enables a feature, the extension reads only the fields needed to show account health and the linked customer's industry. It processes tag identifiers and names, the subscription's linked partner identifier and display name, the current industry, and the available industry choices.

When the independent subscription-list preview is enabled, the extension recognizes a subscription list from its Odoo view and technical field structure. It reads only the subscription names and health tag identifiers needed for the currently rendered rows, in bounded batches, and displays a noninteractive color indicator beside each visible Customer value. The page URL is used only to notice Odoo single-page navigation and is not used to decide whether a list is eligible.

A narrowly allow-listed page bridge performs these reads and sends user-requested write operations back to Odoo through the current authenticated same-origin session. The bridge rejects unrecognized models, methods, fields, searches, and write shapes before contacting Odoo.

This processing occurs in the browser and between the browser and `www.odoo.com`. The extension does not transmit Odoo page data to the developer, analytics providers, advertising networks, or other external services.

## Data stored

Browser synchronized storage contains only versioned extension preferences: master enablement, feature enablement, subscription-list preview enablement, per-feature success-confirmation preferences, and appearance. Browser local storage may contain a sanitized general connection code and timestamp. The connected-user label exists only in volatile memory while the matching Odoo tab remains open. The extension does not persist Odoo records, customer data, names, logins, email addresses, cookies, passwords, CSRF values, user identifiers, session identifiers, credentials, request payload histories, or raw server stack traces.

Browser vendors may synchronize settings according to the user's own browser-account configuration. Odoo retains record changes according to Odoo's policies and the user's organization. This extension does not create a separate record database.

## Permissions and access

The extension requests the `storage` permission for settings and sanitized compatibility status. Its isolated interface script and page-context bridge are both limited to `https://www.odoo.com/odoo*`. It does not request browsing history, tabs, cookies, identity, downloads, clipboard, geolocation, camera, microphone, or broad host access.

## Data sale, sharing, and advertising

OdooHealthExtCS does not sell, rent, monetize, advertise with, profile, or share user or customer data. It contains no analytics or tracking SDK. It uses no remote executable code.

## User control and retention

Users can disable individual features, disable the extension, clear its browser storage, or uninstall it. Clearing the extension's storage removes its preferences and compatibility status. Record updates already requested by the user remain in Odoo and must be changed through Odoo or the extension's time-limited Undo action.

## Security

The project minimizes permissions, validates Odoo field contracts before enabling writes, enforces an exact RPC allow-list, correlates versioned bridge messages, sanitizes results and errors, and scans release inputs for prohibited sensitive material. No security control eliminates all risk; report concerns through [the security policy](SECURITY.md).

## Children and international use

The extension is a workplace tool and is not directed to children. Authorized users and their organization are responsible for using Odoo in accordance with applicable policies and law.

## Changes and contact

Material changes will be documented in the repository and reflected on the public policy page. For privacy questions, use the support process in [SUPPORT.md](SUPPORT.md) and do not include customer or session data.

© DDEM
