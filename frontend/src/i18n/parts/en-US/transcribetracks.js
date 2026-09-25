export default {
  title: 'Transcribe audio',
  hint: 'Sends each track to the transcription server and saves the subtitle beside it. Tracks that already have one are skipped.',
  noAudio: 'This work has no audio files.',
  selectAll: 'Select all ({count} selected)',
  options: 'Options',
  queryLabel: 'Query string (optional)',
  queryHint: 'Merged into the server default for this run, e.g. beam_size=5&hotwords=柚姫,父さま. Type names directly; no URL encoding needed.',
  start: 'Start',
  cancelled: 'Stopped before the end.',
  disconnected: 'Lost the connection to the server; transcription stopped',
  done: 'Transcribed {written}, skipped {skipped}, silent {empty}',
  someFailed: '{count} failed — see the list above.',
  wroteOverlay: "{count} could not be written to the library folder, so they went to the server's lyrics folder instead.",
  status: {
    running: 'Transcribing…',
    written: 'Saved',
    skipped: 'Already has a subtitle',
    empty: 'No speech found',
    failed: 'Failed'
  }
}
