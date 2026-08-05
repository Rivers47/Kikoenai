#!/usr/bin/env node
'use strict';
/*
 * Kikoenai Windows single-exe packager (pkg).
 *
 * Builds the frontend, bundles backend + deps + migrations + dist into ONE
 * Kikoenai.exe via @yao-pkg/pkg (Node 24 win-x64 base binary fetched by pkg),
 * then stages it beside standalone ffmpeg/ffprobe + the launcher bat + data
 * dirs, and zips the lot. Mirrors the upstream pkg build (which shipped exe +
 * sidecar sqlite3 .node) but modernized: @yao-pkg/pkg, Node 24, bundled ffmpeg.
 *
 * MUST run on a Windows host (CI windows-latest or a local Windows box) so the
 * Windows-native sqlite3 .node binding is fetched by prebuild-install. Stdlib
 * only -- no deps.
 *
 *   npm run package:windows:exe
 *
 * Output: package/dist/Kikoenai-exe-windows-x64-<version>.zip
 *
 * Residual sidecars (unavoidable in Node land): none beyond ffmpeg. The sqlite3
 * native binding is bundled INTO the exe as a pkg asset (pkg extracts it to a
 * temp file at runtime for process.dlopen). See backend/package.json `pkg`.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const VERSION = require(path.join(BACKEND, 'package.json')).version;

// Pinned for reproducibility. Bump here when upgrading the shipped runtime.
// BtbN GPL build -- license-compatible with GPL-3.0. `latest` tag is auto-refreshed;
// only ffmpeg.exe + ffprobe.exe are extracted into ffmpeg/.
const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
// pkg target. Node 24 LTS (Krypton) win-x64.
const PKG_TARGET = 'node24-win-x64';

const STAGE = path.join(ROOT, 'package', 'windows-exe', 'Kikoenai');
const DIST_DIR = path.join(ROOT, 'package', 'dist');
const ZIP_OUT = path.join(DIST_DIR, `Kikoenai-exe-windows-x64-${VERSION}.zip`);

if (process.platform !== 'win32') {
  console.error('package:windows:exe must run on a Windows host (needs Windows-native sqlite3 bindings).');
  console.error('Use the .github/workflows/package-windows-exe.yml workflow on windows-latest.');
  process.exit(1);
}

function npm(args, opts = {}) {
  console.log('$ npm', args.join(' '));
  execFileSync('npm', args, { stdio: 'inherit', shell: true, ...opts });
}
function npx(args, opts = {}) {
  console.log('$ npx', args.join(' '));
  execFileSync('npx', args, { stdio: 'inherit', shell: true, ...opts });
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

// sqlite3 6.x loads its native binding via the `bindings` package, whose FIRST
// candidate path is <module_root>/build/<name>.node (no Release/). pkg's static
// analyzer hard-fails on that candidate (ENOENT, not MODULE_NOT_FOUND) before
// `bindings` ever tries the real build/Release/ path. Copying the binding to the
// first-candidate path and declaring it a pkg asset makes candidate 1 resolve
// in-snapshot; pkg then extracts it to a temp file at runtime for dlopen.
// Proven working on Linux; the Windows binding is fetched by prebuild-install.
function stageSqliteBindingForPkg() {
  const real = path.join(BACKEND, 'node_modules', 'sqlite3', 'build', 'Release', 'node_sqlite3.node');
  const firstCandidate = path.join(BACKEND, 'node_modules', 'sqlite3', 'build', 'node_sqlite3.node');
  if (!fs.existsSync(real)) {
    throw new Error(`sqlite3 native binding not found at ${real}. Run npm ci first (needs Windows host for win-x64 prebuild).`);
  }
  fs.copyFileSync(real, firstCandidate);
  console.log('staged sqlite3 .node at first-candidate path for pkg asset resolution');
}

async function stageRuntime() {
  const tmp = path.join(ROOT, 'package', 'windows-exe', '.tmp');
  rm(tmp); mkdir(tmp);

  // pkg fetches its own Node base binary -- no node.exe to download here.

  // ffmpeg + ffprobe (BtbN GPL) -- standalone, beside the exe.
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
  // Reuse the same bat as the zip build -- it launches whatever exe is beside it.
  const bat = path.join(ROOT, 'scripts', 'launchers', 'Kikoenai.bat');
  fs.copyFileSync(bat, path.join(STAGE, 'Kikoenai.bat'));
  console.log('staged Kikoenai.bat');
}

async function main() {
  console.log(`Packaging Kikoenai ${VERSION} for Windows x64 (pkg single-exe)`);

  // 1. Build frontend (production) -> backend/dist (bundled into the exe as a pkg asset)
  console.log('\n== 1. build frontend (prod) ==');
  npm(['run', 'build:prod', '-w', 'frontend']);

  // 2. Prod-only deps (removes devDeps; Windows-native sqlite3 .node stays).
  console.log('\n== 2. prune dev deps ==');
  npm(['prune', '--omit=dev']);

  // 3. Stage the sqlite3 binding at the path pkg's `bindings` resolves first.
  console.log('\n== 3. stage sqlite3 binding for pkg ==');
  stageSqliteBindingForPkg();

  // 4. Build the single exe with pkg.
  console.log('\n== 4. pkg build ==');
  mkdir(STAGE);
  // Output named Kikoenai.exe. jimp 1.x dual CJS/ESM is handled by the
  // `scripts` glob in backend/package.json's pkg block (commonjs dist bundled).
  npx([
    '@yao-pkg/pkg@latest', path.join(BACKEND, 'package.json'),
    '-t', PKG_TARGET,
    '-o', path.join(STAGE, 'Kikoenai.exe'),
  ]);

  // 5. Stage runtime + launcher + data dirs
  console.log('\n== 5. stage runtime + launcher ==');
  await stageRuntime();
  stageLauncher();
  for (const d of ['config', 'sqlite', 'covers', 'VoiceWork']) {
    mkdir(path.join(STAGE, d));
  }

  // 6. Zip
  console.log('\n== 6. zip ==');
  mkdir(DIST_DIR);
  createZip(STAGE, ZIP_OUT);
  console.log(`\nDone: ${ZIP_OUT}`);
  console.log('Contents: Kikoenai.exe (app+Node+sqlite3+frontend) + ffmpeg/ + data dirs + Kikoenai.bat');
}

main().catch((err) => { console.error(err); process.exit(1); });
