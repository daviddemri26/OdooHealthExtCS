import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadReleaseContext } from './release-state.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const required = ['CWS_ACCESS_TOKEN', 'CWS_PUBLISHER_ID'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const { state } = await loadReleaseContext();
const extensionId = state.stores.chrome.itemId;
const packagePath = path.join(
  projectRoot,
  'artifacts',
  `OdooHealthExtCS-v${packageJson.version}-chrome.zip`,
);
const base = `https://chromewebstore.googleapis.com/v2/publishers/${process.env.CWS_PUBLISHER_ID}/items/${extensionId}`;
const headers = { Authorization: `Bearer ${process.env.CWS_ACCESS_TOKEN}` };

const current = await fetch(`${base}:fetchStatus`, { headers });
if (!current.ok) throw new Error(`Chrome status preflight failed with HTTP ${current.status}.`);
const currentStatus = await current.json();
const submittedState = currentStatus.submittedItemRevisionStatus?.state;
if (
  ['PENDING_REVIEW', 'STAGED'].includes(submittedState) ||
  currentStatus.lastAsyncUploadState === 'IN_PROGRESS'
) {
  throw new Error('Chrome already has a pending upload or review. The release was not replaced.');
}
if (currentStatus.takenDown || currentStatus.warned) {
  throw new Error('Chrome reports a policy warning or takedown. Review the developer dashboard.');
}

const upload = await fetch(
  `https://chromewebstore.googleapis.com/upload/v2/publishers/${process.env.CWS_PUBLISHER_ID}/items/${process.env.CWS_EXTENSION_ID}:upload`,
  {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/zip' },
    body: await readFile(packagePath),
  },
);
if (!upload.ok) throw new Error(`Chrome upload failed with HTTP ${upload.status}.`);

const publish = await fetch(`${base}:publish`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ blockOnWarnings: true }),
});
if (!publish.ok) throw new Error(`Chrome publish request failed with HTTP ${publish.status}.`);
const published = await publish.json();

const itemUrl = state.stores.chrome.listingUrl;
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `Chrome submission state: ${published.state ?? 'submitted'}  \nChrome item: ${itemUrl}\n`,
  );
}

process.stdout.write(`Chrome package submitted with state ${published.state ?? 'unknown'}.\n`);
