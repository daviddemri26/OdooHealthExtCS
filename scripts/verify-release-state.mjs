import {
  assertDevelopmentVersion,
  assertReleaseTag,
  assertReleaseUnlocked,
  loadReleaseContext,
  releaseStatusSummary,
} from './release-state.mjs';

const mode = process.argv[2] ?? 'development';
const context = await loadReleaseContext();

switch (mode) {
  case 'development':
    assertDevelopmentVersion(context);
    break;
  case 'prepare-release':
    assertReleaseUnlocked(context);
    break;
  case 'release': {
    const tag = process.argv[3] ?? process.env.GITHUB_REF_NAME;
    if (!tag) throw new Error('Release validation requires a vX.Y.Z tag.');
    assertReleaseTag(context, tag);
    break;
  }
  case 'status':
    break;
  default:
    throw new Error(
      'Usage: node scripts/verify-release-state.mjs development|prepare-release|release [tag]|status',
    );
}

process.stdout.write(`${releaseStatusSummary(context)}\n`);
