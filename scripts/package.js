#!/usr/bin/env node
'use strict';
/*
 * Kikoenai Windows portable packager.
 *
 * Stages a self-contained Kikoenai/ folder (bundled Node 24 + Windows-native
 * sqlite3 + ffmpeg/ffprobe + built frontend + backend source) and zips it.
 * The user unzips and double-clicks Kikoenai.bat; no Node/ffmpeg on PATH needed.
 *
 * MUST run on a Windows host (CI windows-latest or a local Windows box) so the
 * prebuilt sqlite3 win-x64 .node bindings are fetched. Stdlib only -- no deps.
 *
 *   npm run package:windows
 *
 * Output: package/dist/Kikoenai-windows-x64-<version>.zip
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const VERSION = require(path.join(BACKEND, 'package.json')).version;

// Pinned for reproducibility. Bump here when upgrading the shipped runtime.
// Node 24 LTS (Krypton).
const NODE_VERSION = 'v24.19.0';
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`;
// BtbN GPL build -- license-compatible with GPL-3.0. `latest` tag is auto-refreshed;
// only ffmpeg.exe + ffprobe.exe are extracted into ffmpeg/.
const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

const STAGE = path.join(ROOT, 'package', 'windows', 'Kikoenai');
const APP_DIR = path.join(STAGE, 'app');
const DIST_DIR = path.join(ROOT, 'package', 'dist');
const ZIP_OUT = path.join(DIST_DIR, `Kikoenai-windows-x64-${VERSION}.zip`);

if (process.platform !== 'win32') {
  console.error('package:windows must run on a Windows host (needs Windows-native sqlite3 bindings).');
  console.error('Use the .github/workflows/package-windows.yml workflow on windows-latest.');
  process.exit(1);
}

function npm(args, opts = {}) {
  console.log('$ npm', args.join(' '));
  execFileSync('npm', args, { stdio: 'inherit', shell: true, ...opts });
}

function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }

// bsdtar (Windows 10+ System32\tar.exe) handles both zip extract and create.
function extractZip(zip, dest) {
  mkdir(dest);
  execFileSync('tar', ['-xf', zip, '-C', dest], { stdio: 'inherit' });
}
function createZip(srcDir, outFile) {
  rm(outFile);
  // -a infers zip from the .zip extension; -C makes the folder the top entry.
  execFileSync('tar', ['-a', '-c', '-f', outFile, '-C', path.dirname(srcDir), path.basename(srcDir)], { stdio: 'inherit' });
}

async function download(url, destFile) {
  console.log('downloading', url);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destFile, buf);
  console.log(`  -> ${destFile} (${(buf.length / 1e6).toFixed(1)} MB)`);
}

function findFile(dir, name) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { const r = findFile(p, name); if (r) return r; }
    else if (ent.name === name) return p;
  }
  return null;
}

// Backend source dirs to skip when staging app/ (data dirs belong at the archive
// root, not inside app/; node_modules is staged separately; test/ not needed).
const EXCLUDE = new Set(['node_modules', 'config', 'sqlite', 'covers', 'VoiceWork', 'test', '.git']);

function stageBackendSource() {
  console.log('staging backend source -> app/');
  mkdir(APP_DIR);
  fs.cpSync(BACKEND, APP_DIR, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      if (EXCLUDE.has(base)) return false;
      if (base.startsWith('.') && base !== '.') return false; // skip dotfiles (.gitignore, etc.)
      return true;
    },
  });
}

function stageNodeModules() {
  console.log('staging node_modules (backend prod deps, Windows-native sqlite3)');
  const nm = path.join(APP_DIR, 'node_modules');
  // backend/node_modules (non-hoisted: sqlite3, knex, jsonwebtoken, jimp, ...)
  fs.cpSync(path.join(BACKEND, 'node_modules'), nm, { recursive: true });
  // overlay root/node_modules (hoisted; root wins on overlaps -- e.g. mime@1.6.0
  // for express/send over mime@3.0.0 from jimp). Mirrors the Containerfile layering.
  fs.cpSync(path.join(ROOT, 'node_modules'), nm, { recursive: true });
}

async function stageRuntime() {
  const tmp = path.join(ROOT, 'package', 'windows', '.tmp');
  rm(tmp); mkdir(tmp);

  // Node 24 LTS win-x64
  const nodeZip = path.join(tmp, 'node.zip');
  await download(NODE_URL, nodeZip);
  const nodeExtracted = path.join(tmp, 'node');
  extractZip(nodeZip, nodeExtracted);
  const nodeExe = findFile(nodeExtracted, 'node.exe');
  if (!nodeExe) throw new Error('node.exe not found in Node zip');
  mkdir(path.join(STAGE, 'node'));
  fs.copyFileSync(nodeExe, path.join(STAGE, 'node', 'node.exe'));
  console.log('  staged node/node.exe');

  // ffmpeg + ffprobe (BtbN GPL)
  const ffZip = path.join(tmp, 'ffmpeg.zip');
  await download(FFMPEG_URL, ffZip);
  const ffExtracted = path.join(tmp, 'ffmpeg');
  extractZip(ffZip, ffExtracted);
  const ffmpeg = findFile(ffExtracted, 'ffmpeg.exe');
  const ffprobe = findFile(ffExtracted, 'ffprobe.exe');
  if (!ffmpeg || !ffprobe) throw new Error('ffmpeg.exe/ffprobe.exe not found in ffmpeg zip');
  mkdir(path.join(STAGE, 'ffmpeg'));
  fs.copyFileSync(ffmpeg, path.join(STAGE, 'ffmpeg', 'ffmpeg.exe'));
  fs.copyFileSync(ffprobe, path.join(STAGE, 'ffmpeg', 'ffprobe.exe'));
  console.log('  staged ffmpeg/{ffmpeg,ffprobe}.exe');

  rm(tmp);
}

function stageLauncher() {
  const bat = path.join(ROOT, 'scripts', 'launchers', 'Kikoenai.bat');
  fs.copyFileSync(bat, path.join(STAGE, 'Kikoenai.bat'));
  console.log('staged Kikoenai.bat');
}

async function main() {
  console.log(`Packaging Kikoenai ${VERSION} for Windows x64`);

  // 1. Build frontend (production) -> backend/dist
  console.log('\n== 1. build frontend (prod) ==');
  npm(['run', 'build:prod', '-w', 'frontend']);

  // 2. Prod-only deps (removes devDeps; Windows-native sqlite3 .node stays).
  // Side effect: removes dev deps from the workspace tree; run `npm install` to
  // restore dev work locally.
  console.log('\n== 2. prune dev deps ==');
  npm(['prune', '--omit=dev']);

  // 3. Stage the portable folder
  console.log('\n== 3. stage ==');
  rm(STAGE); mkdir(STAGE);
  stageBackendSource();
  stageNodeModules();
  await stageRuntime();
  stageLauncher();

  // 4. Zip
  console.log('\n== 4. zip ==');
  mkdir(DIST_DIR);
  createZip(STAGE, ZIP_OUT);
  console.log(`\nDone: ${ZIP_OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
