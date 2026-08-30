#!/usr/bin/env node
// Check that lyric files in a work folder will actually be picked up, and say
// why when they will not. Runs the app's own rules -- the backend's file
// discovery and the frontend's subtitle parser -- rather than validating
// against the WebVTT spec, because being spec-valid is neither necessary nor
// sufficient for a file to show up in the player.
//
//   npm run check:lyrics -- <folder> [more folders...]
//
// Exits non-zero if anything looks wrong, so it can be used in a pipeline.

import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import Lyric from 'lrc-file-parser';
import { parseSubtitleCues, formatLrcTime } from '../frontend/src/utils/subtitles.js';

// The discovery rules live in the backend and are CommonJS. Freeze the config
// file first: requiring them pulls in config.js, which otherwise writes one.
process.env.FREEZE_CONFIG_FILE = '1';
const require = createRequire(import.meta.url);
const { findLyricTracks, supportedLyricExtensions } = require('../backend/routes/utils/lyrics.js');
const { supportedMediaExtList } = require('../backend/filesystem/utils.js');

const ESC = '\u001b[';
const BOLD = `${ESC}1m`, DIM = `${ESC}2m`, RESET = `${ESC}0m`;
const ok = (s) => `${ESC}32m${s}${RESET}`;
const bad = (s) => `${ESC}31m${s}${RESET}`;
const warn = (s) => `${ESC}33m${s}${RESET}`;

/** Walk a folder into the shape getTrackList() hands to findLyricTracks. */
function trackList(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(root);
  files.sort();
  return files.map((full, index) => {
    const rel = path.relative(root, full);
    const dir = path.dirname(rel);
    return {
      title: path.basename(full),
      subtitle: dir === '.' ? null : dir,
      ext: path.extname(full).toLowerCase(),
      trackId: `check/${index}`,
      fullPath: full,
    };
  });
}

const cueMs = ([h, m, s, ms]) => h * 3600000 + m * 60000 + s * 1000 + ms;

const timeLabel = (ms) => formatLrcTime([
  Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60,
  Math.floor(ms / 1000) % 60, ms % 1000,
]);

/**
 * Parse one lyric file the way the player will, and report anything that looks
 * like a formatting mistake. The strongest signal is a timestamp line the
 * parser did not turn into a cue.
 */
function inspect(file) {
  const problems = [];
  let raw;
  try {
    raw = readFileSync(file.fullPath, 'utf8');
  } catch (err) {
    return { problems: [`unreadable: ${err.message}`], streams: [] };
  }

  if (raw.includes('\u0000')) {
    problems.push('contains null bytes; looks like UTF-16 -- save it as UTF-8');
  }
  if (file.ext === '.vtt' && !/^\uFEFF?WEBVTT/.test(raw)) {
    problems.push('a .vtt file must start with a "WEBVTT" line');
  }

  // LRC never carries a speaker and has no cue timings to cross-check, so it
  // goes through the real parser only, for a line count.
  if (file.ext === '.lrc') {
    const parser = new Lyric({ lyric: raw });
    if (!parser.lines.length) {
      problems.push('parsed to zero lines; timestamps must look like "[00:01.00]text"');
      return { problems, streams: [] };
    }
    const times = parser.lines.map(line => line.time);
    return {
      problems,
      streams: [{
        name: null,
        count: times.length,
        first: Math.min(...times),
        last: Math.max(...times),
      }],
    };
  }

  // Every line that looks like a cue timing, per a deliberately loose pattern,
  // so that malformed ones are caught rather than silently skipped.
  const timingLines = raw.split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(entry => entry.line.includes('-->'));

  const { header, cues } = parseSubtitleCues(raw);
  const parsedTimes = new Set(cues.map(cue => cueMs(cue.time)));

  // A timing line the parser skipped is the usual symptom of a broken file.
  // The parser requires the line before a cue timing to be blank or a cue
  // number, so a missing separator swallows the cue -- including the very
  // first cue of a .vtt that is missing its WEBVTT line.
  for (const entry of timingLines) {
    const match = /(\d+):(\d+):(\d+)[.,](\d+)\s*-->/.exec(entry.line);
    if (!match) {
      problems.push(`line ${entry.number}: timestamp not understood -- ${JSON.stringify(entry.line)}`);
      continue;
    }
    if (/\d+[.,]\d{1,2}\s*-->/.test(entry.line)) {
      problems.push(`line ${entry.number}: fraction must be 3 digits (.500, not .5)`);
    }
    if (!parsedTimes.has(cueMs(match.slice(1).map(Number)))) {
      problems.push(`line ${entry.number}: cue not read -- the line before it must be blank or a cue number (${JSON.stringify(entry.line)})`);
    }
  }

  if (file.ext !== '.lrc' && !timingLines.length) {
    problems.push('no "-->" cue timings found at all');
  }
  if (file.ext !== '.lrc' && !cues.length) {
    problems.push('parsed to zero cues; nothing would be shown');
  }

  const voices = [];
  cues.forEach(cue => { if (!voices.includes(cue.voice)) voices.push(cue.voice); });
  const streams = voices.map((voice) => {
    const own = cues.filter(cue => cue.voice === voice).map(cue => cueMs(cue.time));
    return {
      name: voice || header || null,
      count: own.length,
      first: Math.min(...own),
      last: Math.max(...own),
    };
  });
  return { problems, streams };
}

/** Best guess at why a lyric file matched nothing, phrased as a fix. */
function explainOrphan(file, media) {
  const stem = file.title.substring(0, file.title.lastIndexOf('.'));
  const siblings = media.filter(track => (track.subtitle || '') === (file.subtitle || ''));
  const stemOf = (name) => name.substring(0, name.lastIndexOf('.'));

  // A separator other than "." before the speaker number is the usual slip.
  const loose = /^(.*?)[ _-]+(\d+)$/.exec(stem);
  if (loose) {
    const guess = siblings.find(track => stemOf(track.title) === loose[1]);
    if (guess) {
      return `rename to "${stemOf(guess.title)}.${loose[2]}${file.ext}" -- the speaker number must follow a dot`;
    }
  }
  const dotted = /^(.*)\.([^.]+)$/.exec(stem);
  if (dotted && !/^\d+$/.test(dotted[2])) {
    const guess = siblings.find(track => stemOf(track.title) === dotted[1]);
    if (guess) {
      // The full-filename form must repeat the audio file's own extension, so a
      // stale one ("...mp3.lrc" beside a .m4a) is a different mistake from
      // putting a speaker's name where the number belongs.
      if (supportedMediaExtList.includes(`.${dotted[2].toLowerCase()}`)) {
        return `".${dotted[2]}" is not this track's extension; use "${dotted[1]}${file.ext}" or "${guess.title}${file.ext}"`;
      }
      return `"${dotted[2]}" must be a number; use "${dotted[1]}.1${file.ext}" and put the name in the WEBVTT header`;
    }
  }
  const near = siblings.find(track => stemOf(track.title).startsWith(stem.split('.')[0]));
  if (near) {
    return `expected "${stemOf(near.title)}${file.ext}" or "${stemOf(near.title)}.1${file.ext}" (matching "${near.title}")`;
  }
  return 'no audio file in this folder has a matching name';
}

function checkFolder(root) {
  console.log(`\n${BOLD}${root}${RESET}`);
  const tracks = trackList(root);
  const media = tracks.filter(track => supportedMediaExtList.includes(track.ext));
  const lyrics = tracks.filter(track => supportedLyricExtensions.includes(track.ext));

  if (!media.length) console.log(warn('  no audio files here'));
  if (!lyrics.length) console.log(warn('  no .lrc/.srt/.vtt files here'));

  const claimed = new Set();
  let failures = 0;

  for (const track of media) {
    const found = findLyricTracks(track, tracks);
    const where = track.subtitle ? `${track.subtitle}/` : '';
    console.log(`  ${where}${track.title}`);
    if (!found.length) {
      console.log(`    ${DIM}no lyric files matched${RESET}`);
      continue;
    }
    for (const match of found) {
      const file = tracks.find(item => item.trackId === match.trackId);
      claimed.add(file.trackId);
      const { problems, streams } = inspect(file);
      console.log(`    ${problems.length ? bad('FAIL') : ok('ok  ')} ${file.title}`);
      for (const stream of streams) {
        const name = stream.name || `${DIM}(unnamed)${RESET}`;
        const cues = `${stream.count} cue${stream.count === 1 ? '' : 's'}`;
        console.log(`         ${name}  ${cues}  ${timeLabel(stream.first)} - ${timeLabel(stream.last)}`);
      }
      for (const problem of problems) console.log(`         ${bad(problem)}`);
      failures += problems.length ? 1 : 0;
    }
  }

  // A lyric file no audio file claimed is almost always a naming mistake, and
  // is the failure that produces no error anywhere in the app -- it is simply
  // never looked for.
  const orphans = lyrics.filter(file => !claimed.has(file.trackId));
  if (orphans.length) {
    console.log(`  ${bad('not picked up by any track:')}`);
    for (const file of orphans) {
      console.log(`    ${file.subtitle ? file.subtitle + '/' : ''}${file.title}`);
      console.log(`         ${explainOrphan(file, media)}`);
      failures++;
    }
  }
  return failures;
}

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error('usage: npm run check:lyrics -- <work folder> [more folders...]');
  process.exit(2);
}

let failures = 0;
for (const target of targets) {
  if (!statSync(target, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(bad(`not a folder: ${target}`));
    failures++;
    continue;
  }
  failures += checkFolder(path.resolve(target));
}
console.log(failures ? `\n${bad(`${failures} problem(s)`)}` : `\n${ok('all good')}`);
process.exit(failures ? 1 : 0);
