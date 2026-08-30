// Subtitle and lyric parsing, shared by the player and by
// `scripts/check-lyrics.mjs`. Kept free of any dependency (lrc-file-parser is
// injected into mergeLyricStreams) so the CLI can import it directly.

// WebVTT marks who is speaking with a voice span: "<v Alice>text</v>"
// (W3C WebVTT §voice span). It is the only lyric format we read that can carry
// more than one speaker in a single file -- LRC and SRT have no per-line
// speaker field, so those split speakers across numbered sidecar files
// ("01 Track.1.lrc", "01 Track.2.lrc", ...) which the backend resolves.
const VOICE_SPAN_RE = /^<v(?:\.[^\s>]+)*(?:[ \t]+([^>]*))?>/
// Any remaining cue markup ("</v>", "<b>", "<00:00:01.000>", ...) is dropped:
// the lyric bar renders plain text.
const CUE_MARKUP_RE = /<[^>]*>/g

const TIME_RE = /(\d*):(\d*):(\d*)(\.|,)(\d*)\s*-->\s*[\d:.]*/

function padding(n, len) {
  n = Math.ceil(n);
  let s = `${n}`;
  let pad = len - s.length;
  if (pad > 0) {
    for (let i = 0; i < pad; ++i) {
      s = "0" + s;
    }
  }
  return s;
}

export function formatLrcTime([h, m, s, ms]) {
  return padding(h, 2) + ":" + padding(m, 2) + ":" + padding(s, 2) + "." + padding(ms, 3);
}

function formatLrcMs(totalMs) {
  const ms = Math.max(0, Math.round(totalMs));
  return formatLrcTime([
    Math.floor(ms / 3600000),
    Math.floor(ms / 60000) % 60,
    Math.floor(ms / 1000) % 60,
    ms % 1000,
  ]);
}

/**
 * Interleave per-speaker streams into a single LRC document plus a table of
 * what every speaker shows at each of its timestamps.
 *
 * Why not simply run one Lyric per speaker: lrc-file-parser keeps its scheduler
 * in a module-level singleton (`timeoutTools`), not per instance. A second
 * instance's start() overwrites the first's callback without cancelling its
 * pending animation frame, and pause() nulls that callback — so an orphaned
 * frame fires with `callback === null` and throws "this.callback is not a
 * function". One playing instance is the only safe number.
 *
 * @param {{content: string}[]} streams
 * @returns {{lyric: string, frames: string[][]}} `frames[n]` is the line every
 *   stream shows at the n-th timestamp, and is the payload of LRC line n.
 */
export function mergeLyricStreams(streams, Parser) {
  const perStream = streams.map((stream) => {
    // Parse-only: setLyric never touches the shared scheduler, so building
    // these is safe. Each stream's own [offset:] tag is folded into its times,
    // since the merged document can carry only one such tag.
    const parser = new Parser({ lyric: stream.content });
    const tagOffset = parser.tags.offset || 0;
    return parser.lines.map(line => ({ time: line.time - tagOffset, text: line.text }));
  });

  const times = [...new Set(perStream.flatMap(lines => lines.map(line => line.time)))]
    .sort((a, b) => a - b);

  // A speaker's line stays up until their next one — the same thing a parser of
  // their own would have shown — so each frame carries the last line at or
  // before that moment, and '' before the speaker's first line.
  const cursors = perStream.map(() => -1);
  const frames = times.map((time) => {
    perStream.forEach((lines, index) => {
      while (cursors[index] + 1 < lines.length && lines[cursors[index] + 1].time <= time) {
        cursors[index]++;
      }
    });
    return perStream.map((lines, index) => (cursors[index] >= 0 ? lines[cursors[index]].text : ''));
  });

  // The text of each merged line is its own index: the callback needs a tick at
  // every timestamp, not the words, which come from `frames`.
  return {
    lyric: times.map((time, index) => `[${formatLrcMs(time)}] ${index}`).join("\n"),
    frames,
  };
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
 * @returns {{header: string|null, cues: {time: number[], voice: string|null, text: string}[]}}
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
        const [_whole, h, m, s, _mill_sep, ms] = TIME_RE.exec(lines[i]).map(x => parseInt(x));
        const time = [h, m, s, ms];
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
        textsByVoice.forEach((texts, cueVoice) => {
          cues.push({ time, voice: cueVoice, text: texts.join(' ') });
        });
      }
    }
  }
  return { header, cues };
}

/**
 * Turn one subtitle file into one stream per speaker, in order of first
 * appearance. A file with no voice spans yields a single unnamed stream,
 * exactly as before multi-speaker support.
 *
 * The cue list is the internal model; the LRC text each stream carries is only
 * the wire format into lrc-file-parser, which is the timing engine and reads
 * nothing else. The speaker is read off the cue *before* that conversion, so
 * going through LRC costs no information — LRC itself has no speaker field.
 *
 * @returns {{name: string|null, content: string}[]}
 */
export function convert_srt_vtt_to_lrc_streams(text) {
  const { header, cues } = parseSubtitleCues(text);
  const voices = [];
  cues.forEach(cue => {
    if (!voices.includes(cue.voice)) voices.push(cue.voice);
  });
  return voices.map(voice => ({
    // Per-cue voice spans win; the file header names the speaker when a track
    // is split one speaker per file and so has no voice span to read.
    name: voice || header,
    content: cues
      .filter(cue => cue.voice === voice)
      .map(cue => `[${formatLrcTime(cue.time)}] ${cue.text}`)
      .join("\n"),
  }));
}
