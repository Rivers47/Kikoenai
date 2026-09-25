export default {
  title: '转录音频',
  hint: '将每个音轨发送到转录服务器，并将字幕保存在音频旁边。已有字幕的音轨会被跳过。',
  noAudio: '该作品没有音频文件.',
  selectAll: '全选（已选 {count} 个）',
  options: '选项',
  queryLabel: '查询字符串（可选）',
  queryHint: '本次运行会与服务器默认值合并，例如 beam_size=5&hotwords=柚姫,父さま。直接输入名称即可，无需 URL 编码。',
  start: '开始',
  cancelled: '已中途停止.',
  disconnected: '与服务器的连接已断开，转录已停止',
  done: '已转录 {written} 个，跳过 {skipped} 个，无语音 {empty} 个',
  someFailed: '{count} 个失败 — 详见上方列表.',
  wroteOverlay: '{count} 个无法写入作品文件夹，已改为保存到服务器的字幕文件夹.',
  status: {
    running: '转录中…',
    written: '已保存',
    skipped: '已有字幕',
    empty: '未检测到语音',
    failed: '失败'
  }
}
