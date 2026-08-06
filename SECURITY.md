# Security Policy

## Supported versions

Security fixes are applied to the latest released version. Pre-release builds are supported only while under active testing.

## Report a vulnerability

Use the repository's private **Report a vulnerability** form under GitHub Security Advisories. Do not open a public issue for an exploitable vulnerability. Include the affected version, browser, impact, and a minimal reproduction that contains no Odoo customer or session data.

Never send cookies, session identifiers, CSRF values, passwords, API tokens, customer records, production screenshots, raw HTML captures, or unredacted server stack traces. If evidence cannot be shared safely, describe the behavior and coordinate a secure reproduction with the maintainer.

The maintainer will acknowledge a report as soon as practical, assess severity, coordinate a fix, and publish a security release when appropriate. There is no bug-bounty promise.

## Security boundaries

The extension uses the active same-origin Odoo session and two narrowly matched content scripts: an isolated interface and a `MAIN`-world RPC bridge. The bridge must reject every model, method, field, domain, and write shape outside the reviewed Health and Industry allow-list before fetch, and it must return only sanitized fields and failures. It must not add credential collection, external telemetry, remote code execution, cookie access, or broad host permissions. Store credentials belong only in protected GitHub environments and must be rotated after suspected exposure.
