# Store and GitHub Setup

## Public URLs

After enabling GitHub Pages with the Actions source:

- Homepage: `https://daviddemri26.github.io/OdooHealthExtCS/`
- Privacy: `https://daviddemri26.github.io/OdooHealthExtCS/privacy.html`
- Support: `https://daviddemri26.github.io/OdooHealthExtCS/support.html`

## Chrome Web Store

1. Create an unlisted item and upload the version 1.0.0 Chrome ZIP manually.
2. Complete the listing and privacy tabs from `store/chrome-listing.md` and publish the initial version manually.
3. Enable Chrome Web Store API v2 for a dedicated Google project.
4. Add a dedicated service account to the Chrome publisher account.
5. Configure a Google Workload Identity Pool/provider that trusts this repository and tag workflow. Restrict subject conditions to the repository and protected environment.
6. In GitHub environment `chrome-store`, add secrets `GCP_WORKLOAD_IDENTITY_PROVIDER`, `CWS_SERVICE_ACCOUNT`, `CWS_PUBLISHER_ID`, and `CWS_EXTENSION_ID`.
7. Set repository Actions variable `CHROME_PUBLISH_ENABLED=true` only after a dry review of the workflow and initial manual publication.

Avoid long-lived service-account JSON keys. The workflow requests a short-lived access token through GitHub OIDC.

References: [Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/api/reference/rest) and [service-account publishing guidance](https://developer.chrome.com/docs/webstore/service-accounts).

## Firefox Add-ons

1. Create the listed AMO listing using the permanent ID `odoo-health-ext-cs@daviddemri26.github.io` already declared in the Firefox manifest and upload version 1.0.0 through the documented first-release flow.
2. Complete the listing from `store/firefox-listing.md` and the required no-data-collection declaration. The versioned `store/firefox-submission.json` supplies the initial metadata to `web-ext sign`.
3. Create dedicated AMO JWT submission credentials.
4. In GitHub environment `firefox-amo`, add `AMO_API_KEY` and `AMO_API_SECRET`.
5. Set repository Actions variable `FIREFOX_PUBLISH_ENABLED=true` after the listing and first-version workflow are accepted.

Reference: [current `web-ext` command documentation](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/).

## Independence and protections

Each store environment can require a reviewer and is enabled independently. Store secrets are never available to pull requests or the build job. Version tags are the only trigger for store jobs, concurrency never cancels an active release, and Chrome refuses a new upload while a prior submission is pending.
