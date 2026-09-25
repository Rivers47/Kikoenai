export default {
  title: '音声を文字起こし',
  hint: '各トラックを文字起こしサーバーに送り、字幕を音声ファイルの隣に保存します。すでに字幕があるトラックはスキップされます。',
  noAudio: 'この作品には音声ファイルがありません.',
  selectAll: 'すべて選択（{count} 件選択中）',
  options: 'オプション',
  queryLabel: 'クエリ文字列（任意）',
  queryHint: 'この実行のみサーバーの既定値に統合されます。例: beam_size=5&hotwords=柚姫,父さま。URL エンコードは不要です。',
  start: '開始',
  cancelled: '途中で停止しました.',
  disconnected: 'サーバーとの接続が切断され、文字起こしを中止しました',
  done: '{written} 件を文字起こし、{skipped} 件をスキップ、{empty} 件は無音',
  someFailed: '{count} 件が失敗しました — 上のリストを確認してください.',
  wroteOverlay: '{count} 件は作品フォルダに書き込めなかったため、サーバーの字幕フォルダに保存しました.',
  status: {
    running: '文字起こし中…',
    written: '保存しました',
    skipped: 'すでに字幕があります',
    empty: '音声が検出されませんでした',
    failed: '失敗'
  }
}
