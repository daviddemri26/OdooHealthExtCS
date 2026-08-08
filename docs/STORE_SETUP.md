# Store and GitHub Setup

## Public URLs

After enabling GitHub Pages with the Actions source:

- Homepage: `https://daviddemri26.github.io/OdooHealthExtCS/`
- Privacy: `https://daviddemri26.github.io/OdooHealthExtCS/privacy.html`
- Support: `https://daviddemri26.github.io/OdooHealthExtCS/support.html`

## Chrome Web Store

The public Chrome item ID is versioned in `store/release-state.json`. It is not a credential and does not belong in a GitHub secret.

1. Create an unlisted item and upload the version 1.0.0 Chrome ZIP manually.
2. Complete the listing and privacy tabs from `store/chrome-listing.md` and publish the initial version manually.
3. Enable Chrome Web Store API v2 for a dedicated Google project.
4. Add a dedicated service account to the Chrome publisher account.
5. Configure a Google Workload Identity Pool/provider that trusts this repository and tag workflow. Restrict subject conditions to the repository and protected environment.
6. In GitHub environment `chrome-store`, add configuration variables `GCP_WORKLOAD_IDENTITY_PROVIDER`, `CWS_SERVICE_ACCOUNT`, and `CWS_PUBLISHER_ID`. These values identify the trust provider, service account, and publisher; the authorization comes from the Workload Identity binding and the protected environment.
7. Publish the accepted version 1.0.0 draft manually using the dashboard. Deferred first publications cannot be replaced by an automated update.
8. Verify that 1.0.0 is installable, mark Chrome `published` in `store/release-state.json`, then set repository Actions variable `CHROME_PUBLISH_ENABLED=true` after a dry review of the workflow.

Avoid long-lived service-account JSON keys. The workflow requests a short-lived access token through GitHub OIDC.

References: [Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/api/reference/rest) and [service-account publishing guidance](https://developer.chrome.com/docs/webstore/service-accounts).

## Firefox Add-ons

The public Firefox add-on ID is versioned in both `wxt.config.ts` and `store/release-state.json`; manifest validation requires them to match.

1. Create the listed AMO listing using the permanent ID `odoo-health-ext-cs@daviddemri26.github.io` already declared in the Firefox manifest and upload version 1.0.0 through the documented first-release flow.
2. Complete the listing from `store/firefox-listing.md` and the required no-data-collection declaration. The versioned `store/firefox-submission.json` supplies the initial metadata to `web-ext sign`.
3. Create dedicated AMO JWT submission credentials.
4. In GitHub environment `firefox-amo`, add `AMO_API_KEY` and `AMO_API_SECRET`.
5. Set repository Actions variable `FIREFOX_PUBLISH_ENABLED=true` after the listing and first-version workflow are accepted.

Never paste `AMO_API_SECRET` into repository files, issue comments, workflow logs, or chat. Enter it directly in the protected GitHub environment.

Reference: [current `web-ext` command documentation](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/).

## Independence and protections

Each store environment can require a reviewer and is enabled independently. Store secrets are never available to pull requests or the build job. Version tags are the only trigger for store jobs, at least one store must have completed its initial publication, and each store job checks its own published status before running. Concurrency never cancels an active release, and Chrome refuses a new upload while a prior submission is pending.
