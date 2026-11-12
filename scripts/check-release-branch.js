// Release guard: refuse to bump/tag/push unless HEAD is on `main`.
// Run by the root "preversion" lifecycle, so it fires for every release:* script.
const { execFileSync } = require('child_process');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const fail = (lines) => {
  console.error('\nRelease aborted.');
  for (const line of lines) console.error(`  ${line}`);
  console.error('');
  process.exit(1);
};

let branch;
try {
  branch = git('rev-parse', '--abbrev-ref', 'HEAD');
} catch (err) {
  fail(['Not a git checkout, so the release branch cannot be verified.', String(err.stderr || err.message).trim()]);
}

if (branch === 'HEAD') {
  fail(['HEAD is detached.', 'Check out main first: git switch main']);
}

if (branch !== 'main') {
  const dirty = git('status', '--porcelain') !== '';
  fail([
    `Current branch is "${branch}", not "main".`,
    '',
    'Releases are cut from main only: the tag push publishes container images',
    'and a GitHub release, both pinned to whatever commit it ran on.',
    ...(dirty ? ['This tree also has uncommitted changes.'] : []),
    '',
    'Switch first: git switch main && git pull --ff-only',
  ]);
}

console.log(`Release branch check OK - on main (${git('rev-parse', '--short', 'HEAD')}).`);
