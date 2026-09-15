import { LocalStorage } from 'quasar'

// LocalStorage key for the offline-download manifest.
export const DOWNLOADED_FILES_KEY = 'downloaded_files'

export default function () {
  return {
    // { url, workId, trackId, type: 'audio'|'lyric'|'cover'|'metadata', title, workTitle, bytes, downloadedAt, pending? }
    downloadedFiles: LocalStorage.has(DOWNLOADED_FILES_KEY) ? LocalStorage.getItem(DOWNLOADED_FILES_KEY) : [],

    enableTranscoding: false,
  }
}
