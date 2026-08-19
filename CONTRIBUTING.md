# Contributing

Thank you for improving OdooHealthExtCS. Keep each change small, reviewable, and safe for customer-facing records.

## Code organization

- `entrypoints/`: isolated UI, `MAIN`-world RPC bridge, and settings popup.
- `src/odoo/`: route detection, bridge protocol, exact RPC allow-list, and gateway transport.
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
4. Keep the page bridge allow-list exact. Any new model, method, field, domain, or write shape requires tests and privacy review.
5. Validate fields and relations before writes. Preserve unrelated record values.
6. Never persist Odoo records, cookies, session values, CSRF values, raw server errors, or credentials.
7. Do not add analytics, tracking, external data processors, or remote executable code.
8. Use synthetic fixtures. Never commit customer screenshots, page captures, names, emails, record IDs, or production responses.
9. Preserve keyboard access, visible text labels, light/dark modes, and reduced-motion support.
10. While `store/release-state.json` reports that neither initial listing is published, keep `package.json` at 1.0.0 and document completed work under `CHANGELOG.md` → `Unreleased`. Do not create a release tag. A store whose own initial status is not `published` must remain excluded from automated updates.

## Commits and pull requests

Use Conventional Commit-style subjects such as `feat: add health control`, `fix: preserve unrelated tags`, or `docs: clarify AMO setup`. A pull request should explain the user impact, privacy impact, Odoo models/fields touched, test evidence, and screenshots when visual behavior changes.

Run before requesting review:

```bash
pnpm package
```

Reviewers should confirm that both manifests have only the `storage` and `clipboardWrite` permissions and only the required Odoo content-script match. Clipboard access must remain write-only and user-triggered. Controlled real-Odoo writes belong in a noncritical validation record and must not be recorded in repository fixtures.
