# Extension icon

`odoo-health.svg` is the editable master. Do not reference it from a Chromium
manifest: Chromium extension icons must use a supported raster format, with PNG
recommended for transparency.

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
- Background: transparent

The circular artwork occupies 87.5% of the canvas. At 128 px, its diameter is
112 px, following Chrome Web Store guidance for circular extension icons.
