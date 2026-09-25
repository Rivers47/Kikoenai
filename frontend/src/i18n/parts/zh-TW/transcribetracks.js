export default {
  title: '轉錄音訊',
  hint: '將每個音軌傳送到轉錄伺服器，並將字幕儲存在音訊旁邊。已有字幕的音軌會被跳過。',
  noAudio: '該作品沒有音訊檔案.',
  selectAll: '全選（已選 {count} 個）',
  options: '選項',
  queryLabel: '查詢字串（可選）',
  queryHint: '本次執行會與伺服器預設值合併，例如 beam_size=5&hotwords=柚姫,父さま。直接輸入名稱即可，無需 URL 編碼。',
  start: '開始',
  cancelled: '已中途停止.',
  disconnected: '與伺服器的連線已中斷，轉錄已停止',
  done: '已轉錄 {written} 個，跳過 {skipped} 個，無語音 {empty} 個',
  someFailed: '{count} 個失敗 — 詳見上方清單.',
  wroteOverlay: '{count} 個無法寫入作品資料夾，已改為儲存到伺服器的字幕資料夾.',
  status: {
    running: '轉錄中…',
    written: '已儲存',
    skipped: '已有字幕',
    empty: '未偵測到語音',
    failed: '失敗'
  }
}
