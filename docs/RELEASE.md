# Release Runbook

## One-time setup

1. Enable GitHub Pages with **GitHub Actions** as the source.
2. Create protected GitHub environments named `chrome-store` and `firefox-amo`; require release approval if desired.
3. Complete the store steps in [STORE_SETUP.md](STORE_SETUP.md).
4. Keep `CHROME_PUBLISH_ENABLED` and `FIREFOX_PUBLISH_ENABLED` unset or `false` until the corresponding first manual publication succeeds.

## Current store state

`store/release-state.json` is the repository's public source of truth for the Chrome item ID, Firefox add-on ID, listing URLs, and independent publication gates. Chrome and Firefox both serve version 1.1.0 publicly as of August 11, 2026. Their protected publication variables are enabled, so a validated version tag submits the same release to both stores.

The initial-review version freeze no longer applies. Continue recording completed changes under `CHANGELOG.md` → `Unreleased`, validate with `pnpm package`, and use the semantic release command only when a new version is ready.

The development validator rejects any package-version change while neither store has published its initial version. Once one store is published, releases may proceed, but the tag workflow enables an individual store job only when that store's own initial status is `published`.

## Current store automation

- `CHROME_PUBLISH_ENABLED=true` submits through the protected `chrome-store` environment after a status preflight. The job refuses to replace an item that is pending review, staged, uploading, warned, or taken down.
- `FIREFOX_PUBLISH_ENABLED=true` submits the listed Firefox build and matching human-readable source archive through the protected `firefox-amo` environment.
- The **Submit Firefox Release** workflow remains a recovery path for an existing immutable GitHub Release whose automatic Firefox job did not reach AMO. It never publishes Chrome or moves a tag.

## Prepare a release

1. Update the `Unreleased` changelog with user-visible and compatibility changes.
2. Confirm the approved SVG exists at `assets/brand/odoo-health-ext-cs-icon.svg`.
3. Run the QA checklist, including controlled writes on a noncritical record.
4. Confirm `main` is clean and synchronized with `origin/main`.
5. Run `pnpm release -- patch`, `minor`, or `major`. Use `minor` for a new backward-compatible user feature such as the subscription-list health preview.

The release script first requires at least one initial publication status to be `published`. It then validates the existing version, documented Unreleased changes, clean branch, remote synchronization, and absence of an existing tag. It updates the version, changelog, and lockfile, commits those release files, creates an annotated `vX.Y.Z` tag, and pushes the commit and tag. The workflow independently skips every store whose initial version is not yet published.

## Automated tag flow

The release workflow checks out the tag, installs with a frozen lockfile on Node 22/pnpm 10, rebuilds everything, verifies the publication gate plus tag/package/manifest versions, creates checksums and provenance, and publishes a permanent GitHub Release. Chrome and Firefox run independently behind their environment variables. A disabled store is reported as skipped and cannot fail the GitHub Release.

Chrome authenticates through GitHub OIDC and Google Workload Identity Federation. The publisher/item status is checked before upload; a pending or in-review item is never replaced. Firefox submits the built MV3 directory as listed and includes the human-readable source archive. The separate Firefox recovery workflow reuses immutable GitHub Release assets when an already-created release needs to join AMO later.

## Verification

- Download all GitHub Release assets and verify `sha256sum -c checksums.sha256`.
- Inspect both manifests for version, `storage`, and the exact content-script match.
- Record GitHub Release, Chrome dashboard, and AMO submission URLs/statuses in the release notes or internal release record.
- Install the store-delivered packages after approval and repeat smoke tests.

## Rollback

Do not delete or move a published tag. Fix the issue on `main`, prepare a new patch version, and submit it. If exposure is serious, disable or unpublish the affected store item using the store console while the patched version is reviewed. Document the incident without customer or credential data.

## Credential rotation

For Chrome, disable the compromised Workload Identity binding or service account access, rotate any affected publisher access, review GitHub environment approvals, and replace environment values. For Firefox, revoke the AMO JWT credentials, issue a new pair, and update only the `firefox-amo` environment. Review workflow logs for accidental disclosure and follow the security process. Never place credentials in repository files, Actions variables, artifacts, or issue comments.
