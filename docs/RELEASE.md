# Release Runbook

## One-time setup

1. Enable GitHub Pages with **GitHub Actions** as the source.
2. Create protected GitHub environments named `chrome-store` and `firefox-amo`; require release approval if desired.
3. Complete the store steps in [STORE_SETUP.md](STORE_SETUP.md).
4. Keep `CHROME_PUBLISH_ENABLED` and `FIREFOX_PUBLISH_ENABLED` unset or `false` until the corresponding first manual publication succeeds.

## Current store state

`store/release-state.json` records the Chrome item ID, Firefox add-on ID, listing URLs, and independent publication gates last confirmed in the repository. It is a release input, not a substitute for the current Chrome Developer Dashboard, AMO Developer Hub, GitHub variables, or protected environments. Recheck all live systems immediately before a version tag.

The initial-review version freeze no longer applies. Continue recording completed changes under `CHANGELOG.md` → `Unreleased`, validate with `pnpm package`, and use the semantic release command only when a new version is ready.

The development validator rejects any package-version change while neither store has published its initial version. Once one store is published, releases may proceed, but the tag workflow enables an individual store job only when that store's own initial status is `published`.

## Current store automation

- `CHROME_PUBLISH_ENABLED=true` submits through the protected `chrome-store` environment after a status preflight. The job refuses to replace an item that is pending review, staged, uploading, warned, or taken down.
- `FIREFOX_PUBLISH_ENABLED=true` submits the exact verified Firefox artifact and matching tracked-source archive through the protected `firefox-amo` environment. Approval is also the manual gate to confirm in AMO Developer Hub that the target version and a pending submission do not already exist.
- The **Submit Firefox Release** workflow remains a recovery path for an existing immutable GitHub Release whose automatic Firefox job did not reach AMO. It has no default release tag: the operator must enter the exact existing tag explicitly. It verifies the tag commit, release manifest SHA, checksums, exact source entries, and GitHub attestations before signing the downloaded Firefox artifact. It never rebuilds, publishes Chrome, or moves a tag.

## Prepare a release

1. Update the `Unreleased` changelog with functional, compatibility, security, and internal operational changes.
2. Confirm the approved SVG exists at `assets/brand/odoo-health-ext-cs-icon.svg`. `pnpm icons` verifies the approved PNG pixels without rewriting them; `pnpm icons:generate` is reserved for an explicit, separately reviewed asset update.
3. Run the complete QA checklist under Node 22 and pnpm 10. Controlled Odoo writes require an explicitly approved noncritical record. Renewals may use only the two approved records named in the QA checklist when a new production check is necessary; a Paused Health/Industry write requires a separately approved Paused record.
4. Require a clean `pnpm audit --prod`, then run `pnpm validate` and `pnpm package`. Verify the source ZIP against `git ls-files`, checksums, release manifest Git SHA, manifests, Firefox lint, and the absence of new permissions. The current full development audit has an upstream-only `web-ext`/`addons-linter` exception for unpatched `image-size` ICNS, JXL, and HEIF denial-of-service advisories; those formats are not accepted release inputs, while every approved PNG is digest-pinned. Remove this exception as soon as upstream ships a patched parser.
5. Confirm there is no diff under `docs/public/**` or the public store listing/description files for a silent release. The Firefox update JSON may contain only private reviewer `approval_notes`.
6. Confirm GitHub authentication, publisher variables, protected environments, no existing target tag, live Chrome item state, and live AMO version/submission state.
7. Confirm `main` is clean and synchronized with `origin/main`.
8. Run `pnpm release -- major` for `2.0.0` only after all gates pass. Later fixes use the appropriate semantic increment.

The release script first requires at least one initial publication status to be `published`. It then validates the existing version, documented Unreleased changes, clean branch, remote synchronization, and absence of an existing tag. It updates the version, changelog, and lockfile, commits those release files, creates an annotated `vX.Y.Z` tag, and pushes the commit and tag. The workflow independently skips every store whose initial version is not yet published.

## Automated tag flow

The release workflow checks out the tag, installs with a frozen lockfile on Node 22/pnpm 10, builds once, verifies the publication gate plus tag/package/manifest versions, validates checksums and the tracked-source entry manifest, attests the exact browser ZIPs, and publishes a permanent GitHub Release with an empty public body. Chrome and Firefox run independently behind their environment variables. A disabled store is reported as skipped and cannot fail the GitHub Release.

Chrome authenticates through GitHub OIDC and Google Workload Identity Federation. The publisher/item status is checked before upload; a pending or in-review item is never replaced. Firefox unpacks and signs the exact verified Firefox ZIP produced by the build job and includes the human-readable source archive. Private AMO approval notes come from the update-only metadata file; public descriptions and release notes are not changed. If either store requires a public metadata update, stop that submission and request explicit approval.

## Verification

- Download all GitHub Release assets and verify `sha256sum -c checksums.sha256`.
- Run the release-asset verifier with the expected tag version and tag commit SHA; confirm the source ZIP entries exactly match `release-manifest.json`.
- Inspect both manifests for version, `storage`, and the exact content-script match.
- Record GitHub Release, Chrome dashboard, and AMO submission URLs/statuses in the release notes or internal release record.
- Install the store-delivered packages after approval and repeat smoke tests.
- Track `submitted`, `approved`, and `published` independently; a successful workflow is not proof that a store is serving the version.

## Rollback

Do not delete or move a published tag. Fix the issue on `main`, prepare a new patch version, and submit it. If exposure is serious, disable or unpublish the affected store item using the store console while the patched version is reviewed. Document the incident without customer or credential data.

## Credential rotation

For Chrome, disable the compromised Workload Identity binding or service account access, rotate any affected publisher access, review GitHub environment approvals, and replace environment values. For Firefox, revoke the AMO JWT credentials, issue a new pair, and update only the `firefox-amo` environment. Review workflow logs for accidental disclosure and follow the security process. Never place credentials in repository files, Actions variables, artifacts, or issue comments.
