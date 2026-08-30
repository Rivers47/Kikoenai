// Lyric sidecar files are matched against the audio track's name. For
// "01 Track.mp3" the accepted names are "01 Track.<ext>" (preferred) and
// "01 Track.mp3.<ext>", with the extension in either case.
//
// A track voiced by several speakers can ship one file per speaker instead,
// numbered: "01 Track.1.lrc", "01 Track.2.lrc", ... There is no established
// convention for this -- LRC and SRT have no per-line speaker field at all, so
// the only way to carry several speakers is several files. (WebVTT does have
// one, the <v> voice span; a single .vtt holding voice spans is split into
// per-speaker streams by the frontend parser instead.)
//
// When any numbered file is present the numbered set wins and an unnumbered
// file is ignored, so a whole-track transcript can sit beside the per-speaker
// split without being drawn on top of it.
const { supportedMediaExtList } = require('../../filesystem/utils');

const supportedLyricExtensions = ['.lrc', '.srt', '.vtt']; // in order of preference

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Find every lyric file belonging to `track`, among its siblings in `tracks`.
 * Returns an array of { trackId, lyricExtension }, ordered by speaker number;
 * empty when the track has no lyrics.
 */
const findLyricTracks = (track, tracks) => {
  const title = track.title;
  const dotIndex = title.lastIndexOf('.');
  const stem = dotIndex > 0 ? title.substring(0, dotIndex) : title;
  const extAlternation = supportedLyricExtensions.map(ext => escapeRegExp(ext.slice(1))).join('|');
  // Group 1 marks the stem form ("01 Track.lrc"), group 2 the speaker number,
  // group 3 the extension. The stem alternative is listed first so that it wins
  // the backtrack for names the two forms could both explain.
  const lyricNameRe = new RegExp(
    `^(?:(${escapeRegExp(stem)})|${escapeRegExp(title)})(?:\\.(\\d+))?\\.(${extAlternation})$`,
    'i'
  );

  // Stems of the sibling media files, used to disqualify a numbered lyric that
  // is really the unnumbered lyric of another track: a folder holding both
  // "01.mp3" and "01.2.mp3" would otherwise let "01.2.lrc" be read as speaker 2
  // of "01.mp3". Only media siblings count -- nothing else in the folder can
  // own a lyric file of its own.
  const siblingStems = new Set();
  tracks.forEach((item) => {
    if ((item.subtitle || '') !== (track.subtitle || '')) return;
    if (item.trackId === track.trackId) return;
    if (!supportedMediaExtList.includes(item.ext)) return;
    siblingStems.add(item.title.substring(0, item.title.lastIndexOf('.')).toLowerCase());
  });

  const candidates = [];
  tracks.forEach((item) => {
    if ((item.subtitle || '') !== (track.subtitle || '')) return;
    const match = lyricNameRe.exec(item.title);
    if (!match) return;
    const speaker = match[2] === undefined ? null : parseInt(match[2], 10);
    if (speaker !== null && siblingStems.has(`${stem}.${match[2]}`.toLowerCase())) return;
    candidates.push({
      trackId: item.trackId,
      lyricExtension: `.${match[3].toLowerCase()}`,
      speaker,
      // Sort keys: the stem form beats the full-filename form, and the
      // extensions rank in the order listed above.
      isStemForm: match[1] !== undefined,
      extRank: supportedLyricExtensions.indexOf(`.${match[3].toLowerCase()}`),
    });
  });

  const numbered = candidates.filter(candidate => candidate.speaker !== null);
  const chosen = numbered.length ? numbered : candidates;

  // One file per speaker: among "01 Track.1.lrc" and "01 Track.1.srt", keep the
  // better-ranked one.
  const bySpeaker = new Map();
  chosen
    .sort((a, b) => a.extRank - b.extRank || (a.isStemForm === b.isStemForm ? 0 : a.isStemForm ? -1 : 1))
    .forEach((candidate) => {
      if (!bySpeaker.has(candidate.speaker)) bySpeaker.set(candidate.speaker, candidate);
    });

  return Array.from(bySpeaker.values())
    .sort((a, b) => (a.speaker || 0) - (b.speaker || 0))
    .map(({ trackId, lyricExtension }) => ({ trackId, lyricExtension }));
};

module.exports = { findLyricTracks, supportedLyricExtensions };
