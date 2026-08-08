# Release Runbook

## One-time setup

1. Enable GitHub Pages with **GitHub Actions** as the source.
2. Create protected GitHub environments named `chrome-store` and `firefox-amo`; require release approval if desired.
3. Complete the store steps in [STORE_SETUP.md](STORE_SETUP.md).
4. Keep `CHROME_PUBLISH_ENABLED` and `FIREFOX_PUBLISH_ENABLED` unset or `false` until the corresponding first manual publication succeeds.

## While the initial submissions are under review

`store/release-state.json` is the repository's public source of truth for the initial Chrome item ID, Firefox add-on ID, listing URLs, and review gates. Both statuses start as `pending-review`.

- Continue normal feature and fix work without changing the package version from 1.0.0.
- Record each completed change under `CHANGELOG.md` → `Unreleased`.
- Use `pnpm package` for local and CI artifacts; these are development packages and are never uploaded automatically.
- Use `pnpm release:status` to confirm the two-store gate remains locked.
- Do not create or push a `vX.Y.Z` tag.

The development validator rejects any package-version change while either initial submission is pending. The tag workflow independently rejects a release unless both initial statuses are `published` and the tagged version is newer than 1.0.0.

## Unlock after both initial publications

1. Verify that version 1.0.0 is publicly installable from both store listings.
2. Change each status in `store/release-state.json` from `pending-review` to `published` and commit that state change.
3. Configure the protected store environments and keep both publish variables disabled until their access setup has been reviewed.
4. Run `pnpm release:status`; it must report `Version release gate: unlocked`.
5. Prepare the accumulated work as the next patch, minor, or major release. Do not reuse version 1.0.0.

## Prepare a release

1. Update the `Unreleased` changelog with user-visible and compatibility changes.
2. Confirm the approved SVG exists at `assets/brand/odoo-health-ext-cs-icon.svg`.
3. Run the QA checklist, including controlled writes on a noncritical record.
4. Confirm `main` is clean and synchronized with `origin/main`.
5. Run `pnpm release -- patch`, `minor`, or `major`. The first automated update after the initial publications will normally be `pnpm release -- patch`, producing version 1.0.1.

The release script first requires both initial publication statuses to be `published`. It then validates the existing version, documented Unreleased changes, clean branch, remote synchronization, and absence of an existing tag. It updates the version, changelog, and lockfile, commits those release files, creates an annotated `vX.Y.Z` tag, and pushes the commit and tag.

## Automated tag flow

The release workflow checks out the tag, installs with a frozen lockfile on Node 22/pnpm 10, rebuilds everything, verifies the publication gate plus tag/package/manifest versions, creates checksums and provenance, and publishes a permanent GitHub Release. Chrome and Firefox run independently behind their environment variables. A disabled store is reported as skipped and cannot fail the GitHub Release.

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
