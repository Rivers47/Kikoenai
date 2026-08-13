// Propagate the root package.json version to both workspaces and the lockfile.
// Run automatically by the root "version" lifecycle script (npm version <patch|minor|major>).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));

const patch = (file, edit) => {
  const abs = path.join(root, file);
  const json = JSON.parse(fs.readFileSync(abs, 'utf8'));
  edit(json);
  fs.writeFileSync(abs, JSON.stringify(json, null, 2) + '\n');
};

patch('backend/package.json', (p) => { p.version = version; });
patch('frontend/package.json', (p) => { p.version = version; });
patch('package-lock.json', (l) => {
  l.version = version;
  l.packages[''].version = version;
  l.packages['backend'].version = version;
  l.packages['frontend'].version = version;
});

console.log(`Synced backend, frontend and lockfile to ${version}`);
