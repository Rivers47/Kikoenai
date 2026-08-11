import { LocalStorage } from 'quasar'

// LocalStorage key for the offline-download manifest. The array only stores
// metadata (url/type/size/etc.) -- the actual bytes live in the service
// worker's Cache Storage (see cacheFile/uncacheFile in src/utils/downloads.js
// and the 'offline-tracks' runtimeCaching routes in quasar.config.js).
export const DOWNLOADED_FILES_KEY = 'downloaded_files'

export default function () {
  return {
    // { url, workId, trackId, type: 'audio'|'lyric'|'cover'|'metadata', title, workTitle, bytes, downloadedAt, pending? }
    // `pending: true` means the row is claimed but its bytes are not in Cache
    // Storage yet (a Background Fetch is in flight, or finished while the app
    // was closed). Cleared by PROMOTE_DOWNLOADED_FILES. Getters ignore pending
    // rows -- see module-Downloads/getters.js.
    downloadedFiles: LocalStorage.has(DOWNLOADED_FILES_KEY) ? LocalStorage.getItem(DOWNLOADED_FILES_KEY) : [],

    // From GET /api/config/shared -- an admin can disable transcoding
    // server-side on weak hardware; download UI stays hidden until this is
    // confirmed true, rather than assuming it's available.
    enableTranscoding: false,
  }
}
