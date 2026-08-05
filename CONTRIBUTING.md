# Contributing

Thank you for improving OdooHealthExtCS. Keep each change small, reviewable, and safe for customer-facing records.

## Code organization

- `entrypoints/`: WXT content script and settings popup.
- `src/odoo/`: route detection and same-session RPC transport.
- `src/features/`: isolated feature services.
- `src/content/`: Shadow DOM React interface.
- `src/shared/`: settings, compatibility, and shared types.
- `tests/`: synthetic unit and DOM tests only.
- `scripts/`: packaging, validation, scanning, and publishing tools.
- `docs/`, `store/`: operational and store documentation.

## Development rules

1. Use Node 22 LTS and pnpm 10.
2. Keep the content-script match exactly `https://www.odoo.com/odoo*` unless a separately reviewed product decision changes the scope.
3. Use `OdooGateway`; do not introduce direct ad hoc RPC calls inside UI components.
4. Validate fields and relations before writes. Preserve unrelated record values.
5. Never persist Odoo records, cookies, session values, CSRF values, raw server errors, or credentials.
6. Do not add analytics, tracking, external data processors, or remote executable code.
7. Use synthetic fixtures. Never commit customer screenshots, page captures, names, emails, record IDs, or production responses.
8. Preserve keyboard access, visible text labels, light/dark modes, and reduced-motion support.

## Commits and pull requests

Use Conventional Commit-style subjects such as `feat: add health control`, `fix: preserve unrelated tags`, or `docs: clarify AMO setup`. A pull request should explain the user impact, privacy impact, Odoo models/fields touched, test evidence, and screenshots when visual behavior changes.

Run before requesting review:

```bash
pnpm package
```

Reviewers should confirm that both manifests have only the `storage` permission and only the required Odoo content-script match. Controlled real-Odoo writes belong in a noncritical validation record and must not be recorded in repository fixtures.
