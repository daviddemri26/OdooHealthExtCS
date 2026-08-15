export function incrementVersion(version, releaseMode) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Unsupported package version: ${version}`);

  const [, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  switch (releaseMode) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unsupported release mode: ${releaseMode}`);
  }
}

export function assertRemoteReleaseTagAbsent(run, tag, remote = 'origin') {
  const remoteTag = run('git', ['ls-remote', '--tags', '--refs', remote, `refs/tags/${tag}`], {
    capture: true,
  });
  if (remoteTag) throw new Error(`Tag ${tag} already exists on ${remote}.`);
}

export function pushAtomicRelease(run, { branch = 'main', remote = 'origin', tag }) {
  if (!tag) throw new Error('An annotated release tag is required for the atomic push.');
  run('git', ['push', '--atomic', remote, branch, tag]);
}
