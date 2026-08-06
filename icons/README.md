# Extension icon

This directory contains the earlier design draft and is retained only as design provenance. The
canonical source is `assets/brand/odoo-health-ext-cs-icon.svg`; packaging generates every shipped
PNG under `public/icons/` from that file.

The PNG files cover the standard Chromium sizes plus Firefox high-density sizes:

- `icon-16.png` — extension-page favicon and small toolbar use
- `icon-32.png` — Windows and high-density toolbar use
- `icon-48.png` — extension management page
- `icon-64.png` — Firefox high-density companion for 32 px
- `icon-96.png` — Firefox high-density companion for 48 px
- `icon-128.png` — installation and Chrome Web Store

## Manifest V3

```json
"icons": {
  "16": "icons/icon-16.png",
  "32": "icons/icon-32.png",
  "48": "icons/icon-48.png",
  "64": "icons/icon-64.png",
  "96": "icons/icon-96.png",
  "128": "icons/icon-128.png"
},
"action": {
  "default_icon": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png"
  }
}
```

If the extension has no toolbar action, omit the `action` block.

## Design tokens

- Odoo purple: `#714B67`
- Health green: `#21B799`
- Background: transparent in this archived draft; the canonical release asset uses the approved white rounded square.

Do not copy these draft PNGs into a release. Run `pnpm icons` and review the canonical generated
16 px and 128 px PNGs instead.
