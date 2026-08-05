# Release Runbook

## One-time setup

1. Enable GitHub Pages with **GitHub Actions** as the source.
2. Create protected GitHub environments named `chrome-store` and `firefox-amo`; require release approval if desired.
3. Complete the store steps in [STORE_SETUP.md](STORE_SETUP.md).
4. Keep `CHROME_PUBLISH_ENABLED` and `FIREFOX_PUBLISH_ENABLED` unset or `false` until the corresponding first manual publication succeeds.

## Prepare a release

1. Update the `Unreleased` changelog with user-visible and compatibility changes.
2. Confirm the approved SVG exists at `assets/brand/odoo-health-ext-cs-icon.svg`.
3. Run the QA checklist, including controlled writes on a noncritical record.
4. Confirm `main` is clean and synchronized with `origin/main`.
5. Run `pnpm release -- patch`, `minor`, or `major`.

The release script validates the existing version, increments it, updates the changelog, refreshes the lockfile, runs `pnpm package`, commits, creates an annotated `vX.Y.Z` tag, and pushes `main` and the tag.

## Automated tag flow

The release workflow checks out the tag, installs with a frozen lockfile on Node 22/pnpm 10, rebuilds everything, verifies tag/package/manifest versions, creates checksums and provenance, and publishes a permanent GitHub Release. Chrome and Firefox run independently behind their environment variables. A disabled store is reported as skipped and cannot fail the GitHub Release.

Chrome authenticates through GitHub OIDC and Google Workload Identity Federation. The publisher/item status is checked before upload; a pending or in-review item is never replaced. Firefox submits the built MV3 directory as listed and includes the human-readable source archive.

## Verification

- Download all GitHub Release assets and verify `sha256sum -c checksums.sha256`.
- Inspect both manifests for version, `storage`, and the exact content-script match.
- Record GitHub Release, Chrome dashboard, and AMO submission URLs/statuses in the release notes or internal release record.
- Install the store-delivered packages after approval and repeat smoke tests.

## Rollback

Do not delete or move a published tag. Fix the issue on `main`, prepare a new patch version, and submit it. If exposure is serious, disable or unpublish the affected store item using the store console while the patched version is reviewed. Document the incident without customer or credential data.

## Credential rotation

For Chrome, disable the compromised Workload Identity binding or service account access, rotate any affected publisher access, review GitHub environment approvals, and replace environment values. For Firefox, revoke the AMO JWT credentials, issue a new pair, and update only the `firefox-amo` environment. Review workflow logs for accidental disclosure and follow the security process. Never place credentials in repository files, Actions variables, artifacts, or issue comments.
