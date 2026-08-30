// Colours for simultaneous lyric streams (a track voiced by several speakers).
// The speakers themselves are anonymous -- the numbered sidecar files carry no
// name -- so colour is the only thing telling the lines apart, and it is keyed
// on nothing but the stream's position in the file set.
//
// The tokens are Material 3 custom colours: `Lyric Speaker 1..6` in
// src/material-theme.json, whose hues are evenly spaced around the HCT circle
// at one chroma and tone, so no speaker reads as louder than another. The theme
// generator gives each a full tonal palette per scheme (light, dark, and the
// contrast tiers), which is why they are not hand-picked hexes any more.
//
// To change or add one: edit the extendedColors entry and run `npm run theme`.
// MAX_LYRIC_STREAMS must match how many exist, since streams past it are
// dropped rather than given a repeated colour.
export const MAX_LYRIC_STREAMS = 6

/**
 * Name of the CSS custom property colouring stream `index` of `total`. A track
 * with a single stream keeps the plain lyric colour it had before
 * multi-speaker support, so ordinary single-speaker playback is unchanged.
 * @returns {string} e.g. "--lyric-speaker-2"
 */
export function lyricStreamColorVar (index, total) {
  if (total < 2) return '--on-surface-variant'
  return `--lyric-speaker-${(index % MAX_LYRIC_STREAMS) + 1}`
}

/** The same colour as a CSS value, for style bindings. */
export function lyricStreamColor (index, total) {
  return `var(${lyricStreamColorVar(index, total)})`
}
