// Subtitle and lyric parsing, shared by the player and by
// `scripts/check-lyrics.mjs`. Kept dependency-free so the CLI can import it
// directly.
//
// Every format is parsed into the same model: a list of cues carrying a start
// and an end in milliseconds. SRT and WebVTT state both; LRC states only a
// start, so a line's end is the next line's start -- that is the whole of what
// LRC can express, and the only place an end has to be inferred.

// WebVTT marks who is speaking with a voice span: "<v Alice>text</v>"
// (W3C WebVTT §voice span). It is the only lyric format we read that can carry
// more than one speaker in a single file -- LRC and SRT have no per-line
// speaker field, so those split speakers across numbered sidecar files
// ("01 Track.1.lrc", "01 Track.2.lrc", ...) which the backend resolves.
const VOICE_SPAN_RE = /^<v(?:\.[^\s>]+)*(?:[ \t]+([^>]*))?>/
// Any remaining cue markup ("</v>", "<b>", "<00:00:01.000>", ...) is dropped:
// the lyric bar renders plain text.
const CUE_MARKUP_RE = /<[^>]*>/g

// Both sides of a cue timing. The hours are optional: WebVTT writes them only
// past the first hour ("01:23.456" is a minute and a half in), while SRT always
// states them. The end is optional only defensively -- both formats require it
// -- and a cue missing one falls back to the next cue's start, as in LRC.
const CUE_TIME = '(?:(\\d+):)?(\\d+):(\\d+)[.,](\\d+)'
const TIME_RE = new RegExp(`${CUE_TIME}\\s*-->\\s*(?:${CUE_TIME})?`)

// LRC timestamps are "[mm:ss.xx]", several of which may share one line, and
// may be followed by metadata tags this parser ignores.
const LRC_TIME_RE = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g
const LRC_OFFSET_RE = /^\[offset:\s*([+-]?\d+)\s*\]$/i

const num = (s) => {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}

const toMs = (h, m, s, ms) => num(h) * 3600000 + num(m) * 60000 + num(s) * 1000 + ms

export function formatLrcMs(totalMs) {
  const ms = Math.max(0, Math.round(totalMs));
  const pad = (n, len) => `${n}`.padStart(len, "0");
  return pad(Math.floor(ms / 3600000), 2) + ":" + pad(Math.floor(ms / 60000) % 60, 2)
    + ":" + pad(Math.floor(ms / 1000) % 60, 2) + "." + pad(ms % 1000, 3);
}

/**
 * Give every cue an end: the one it states, or the next cue's start when it
 * states none. The last cue of an LRC file is the one case no format answers,
 * and it holds until the end of the track -- "until the next line" with no
 * next line to bound it.
 *
 * Ends are not clamped to the following start. WebVTT allows cues to overlap,
 * and a cue that really does outlast its successor is shown for as long as it
 * says.
 */
function fillImplicitEnds(cues) {
  cues.forEach((cue, index) => {
    if (cue.end !== null && cue.end > cue.start) return;
    const next = cues[index + 1];
    cue.end = next ? next.start : Infinity;
  });
  // Furthest end among this cue and every cue before it, which is what lets
  // cueTextAt stop walking back: once it is in the past, no earlier cue can
  // still be on screen.
  let furthest = -Infinity;
  cues.forEach((cue) => {
    furthest = Math.max(furthest, cue.end);
    cue.endsBy = furthest;
  });
  return cues;
}

/**
 * The text a stream shows at `timeMs`, or '' when no cue covers that moment.
 * Where cues overlap the one that started most recently wins.
 */
export function cueTextAt(cues, timeMs) {
  let low = 0, high = cues.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].start <= timeMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  // The latest-starting cue is not necessarily the one still running: a cue may
  // outlast the ones that start inside it. Walking back costs nothing for the
  // sequential files that are the norm, where the first `endsBy` test ends it.
  for (let i = found; i >= 0; i--) {
    if (cues[i].end > timeMs) return cues[i].text;
    if (cues[i].endsBy <= timeMs) break;
  }
  return '';
}

// A WebVTT file's first line is "WEBVTT" optionally followed by free text
// (W3C WebVTT, the file's "header"). Conventionally written "WEBVTT - Note".
// It is the only per-file label the format has, so it names the speaker when a
// track is split one speaker per file, where there is no cue to hang a voice
// span off. A leading BOM is common in hand-written files and would otherwise
// hide the header.
const VTT_HEADER_RE = /^\uFEFF?WEBVTT(?:[ \t]+(?:-[ \t]*)?(.*))?$/

/**
 * Parse an SRT or WebVTT file into cues. A cue whose body carries several voice
 * spans is split into one cue per voice, so that speakers never share a line.
 * `voice` is null for text outside any voice span (all of SRT, and plain VTT).
 *
 * @returns {{header: string|null, cues: {start: number, end: number|null, voice: string|null, text: string}[]}}
 */
export function parseSubtitleCues(text) {
  let lines = String(text).split("\n").map(l => l.trim())
  const headerMatch = lines.length > 0 ? VTT_HEADER_RE.exec(lines[0]) : null;
  let header = null;
  if (headerMatch) {
    header = (headerMatch[1] || '').trim() || null;
    lines = lines.slice(1)
  }

  const cues = [];
  let i = 0;
  while (i < lines.length) {

    if (/^\d*$/.test(lines[i++])) {
      if (TIME_RE.test(lines[i])) {
        const timing = TIME_RE.exec(lines[i]);
        const start = toMs(timing[1], timing[2], timing[3], num(timing[4]));
        // Group 6 is the end's minutes, not its hours: the hours are optional,
        // so they are undefined even for an end that is perfectly well stated.
        const end = timing[6] === undefined
          ? null
          : toMs(timing[5], timing[6], timing[7], num(timing[8]));
        // A voice span stays in force until the next one, so a cue body reads
        // as an ordered list of (voice, text) runs; group them by voice to keep
        // the file's own order of first appearance.
        const textsByVoice = new Map();
        let voice = null;
        i++;
        while (i < lines.length && lines[i] != "") {
          let line = lines[i++];
          const voiceMatch = VOICE_SPAN_RE.exec(line);
          if (voiceMatch) {
            // A nameless "<v>" is treated as unnamed rather than as a speaker
            // of its own, so it shares a stream with untagged cues.
            voice = (voiceMatch[1] || '').trim() || null;
            line = line.slice(voiceMatch[0].length);
          }
          line = line.replace(CUE_MARKUP_RE, '').trim();
          if (line === '') continue;
          if (!textsByVoice.has(voice)) textsByVoice.set(voice, []);
          textsByVoice.get(voice).push(line);
        }
        // A multi-line cue body is one subtitle shown on several rows (SRT and
        // W3C WebVTT alike), so its line breaks are kept.
        textsByVoice.forEach((texts, cueVoice) => {
          cues.push({ start, end, voice: cueVoice, text: texts.join('\n') });
        });
      }
    }
  }
  return { header, cues };
}

// "[00:01.5]" is half a second in, not five milliseconds: an LRC fraction is
// scaled by how many digits it has. SRT and WebVTT mandate three and so need
// none of this.
function lrcFractionMs(frac) {
  if (!frac) return 0;
  return Math.round(parseInt(frac, 10) * Math.pow(10, 3 - frac.length));
}

/**
 * Parse an LRC file into cues. LRC has no speaker field and no end times, so
 * every cue is unnamed and ends where the next one begins.
 *
 * A timestamped line with no text is kept as an empty cue rather than dropped,
 * because it is the only way an LRC file can say "this line is over" -- and
 * dropping it is what used to make the previous line hang on screen.
 */
export function parseLrcCues(text) {
  const cues = [];
  let offset = 0;
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    const offsetMatch = LRC_OFFSET_RE.exec(line);
    if (offsetMatch) {
      offset = parseInt(offsetMatch[1], 10);
      continue;
    }
    // Only the timestamps a line opens with are its own; a "[" later in the
    // line is lyric text.
    LRC_TIME_RE.lastIndex = 0;
    const starts = [];
    let consumed = 0;
    let match;
    while ((match = LRC_TIME_RE.exec(line)) !== null && match.index === consumed) {
      starts.push(toMs(0, match[1], match[2], lrcFractionMs(match[3])));
      consumed = LRC_TIME_RE.lastIndex;
    }
    if (!starts.length) continue;
    const body = line.slice(consumed).replace(CUE_MARKUP_RE, '').trim();
    for (const start of starts) {
      cues.push({ start: start - offset, end: null, voice: null, text: body });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

/**
 * Turn one lyric file into one stream of cues per speaker, in order of first
 * appearance. LRC and any file without voice spans yield a single unnamed
 * stream.
 *
 * @param {string} text file contents
 * @param {string} extension lower-case file extension; anything but ".srt" or
 *   ".vtt" is read as LRC, which is also the safe reading of a missing one
 * @returns {{name: string|null, cues: object[]}[]}
 */
export function parseLyricStreams(text, extension) {
  if (extension !== '.srt' && extension !== '.vtt') {
    return [{ name: null, cues: fillImplicitEnds(parseLrcCues(text)) }];
  }

  const { header, cues } = parseSubtitleCues(text);
  const voices = [];
  cues.forEach(cue => {
    if (!voices.includes(cue.voice)) voices.push(cue.voice);
  });
  return voices.map(voice => ({
    // Per-cue voice spans win; the file header names the speaker when a track
    // is split one speaker per file and so has no voice span to read.
    name: voice || header,
    cues: fillImplicitEnds(cues.filter(cue => cue.voice === voice)),
  }));
}
