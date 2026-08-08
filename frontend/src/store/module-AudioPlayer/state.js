import { LocalStorage } from 'quasar'

export const SWAP_SEEK_BUTTON_KEY = 'swap_seek_button'
export const FLIP_LR_CHANNEL_KEY = 'flip_lr_channel'
export const ENABLE_PIP_LYRICS = 'enable_pip_lyrics'
export const AI_SERVER_URL_KEY = 'ai_server_url'
export const OLD_WORK_CARD_UI_STYLE_KEY = 'old_work_card_ui_style_key'
export const AUTO_MARK_LISTENED_KEY = 'auto_mark_listened'
export const REWIND_SEEK_TIME_KEY = 'rewind_seek_time'
export const FORWARD_SEEK_TIME_KEY = 'forward_seek_time'
// sessionStorage 中持久化睡眠定时的键，值为 { type, stopAt, tracksLeft }
export const SLEEP_TIMER_KEY = 'sleepTimer'

export default function () {
  return {
    hide: false,
    playing: false, // 播放状态 (true/false)
    currentTime: 0, // 单位: 秒
    newCurrentTime: -1, // 单位：秒，<0 的负数表示当前无需更改媒体的currentTime，>=0 表示需要更改媒体的currentTime
    duration: 0,
    source: "",
    queue: [
      // list of tracks. object format:
      /*
        trackId: null, // unique identifier for the file (workId/index, e.g. "01102492/17")
        title: null, // title to show in UI
        workTitle: null // workTitle to show in UI
       */
    ],
    queueIndex: 0, // which track in the queue is currently selected
    playMode: {
      id: 0,
      name: "order"
    }, // 顺序播放("order"), 循环播放("all repeat"), 单曲循环("repeat once") or 随机播放("shuffle")
    muted: false,
    volume: 0, // 音量 (0.0-1.0)
    hasLyric: false,
    currentLyric: '',
    lyricOffsetSeconds: 0,
    sleepMode: false,          // 睡眠定时是否开启
    sleepModeType: null,       // 'minutes' | 'tracks'
    sleepStopAt: null,         // minutes 模式：停止播放的时间戳 (ms)
    sleepTracksLeft: 0,        // tracks 模式：当前曲目之后还需播放的曲目数，为 0 时当前曲目结束即停止
    rewindSeekTime: LocalStorage.has(REWIND_SEEK_TIME_KEY) ? LocalStorage.getItem(REWIND_SEEK_TIME_KEY) : 5,
    forwardSeekTime: LocalStorage.has(FORWARD_SEEK_TIME_KEY) ? LocalStorage.getItem(FORWARD_SEEK_TIME_KEY) : 30,
    rewindSeekMode: false,
    forwardSeekMode: false,
    swapSeekButton: LocalStorage.has(SWAP_SEEK_BUTTON_KEY) && LocalStorage.getItem(SWAP_SEEK_BUTTON_KEY), // 交换进度按钮与切换按钮
    visualPlayerCoverUrl: '', // 可视化播放器的封面图
    playWorkId: 0, // 当前播放作品的id
    playWorkVas: [], // VAs of the playing work, [{id, name}]; media session shows the first

    // swap L/R; graph stays for the session once built, off = passthrough
    flipLRChannel: LocalStorage.has(FLIP_LR_CHANNEL_KEY) && LocalStorage.getItem(FLIP_LR_CHANNEL_KEY),

    // 是否启用画中画歌词（桌面歌词）
    // 注意android chrome不支持画中画，firefox估计也不支持，因此在android设备上禁用这一功能
    enablePIPLyrics: LocalStorage.has(ENABLE_PIP_LYRICS) && LocalStorage.getItem(ENABLE_PIP_LYRICS) && !(navigator.userAgent.toLowerCase().indexOf('android') > -1), 

    // 当从历史记录播放时，这里记录当前queue[queueIndex]应当恢复到的seconds时间，
    // -1表示无需恢复，其他大于等于0的数字需要在onCanplay时间触发并完成时间跳转之后，再次设置为-1
    resumeHistorySeconds: -1,

    // 是否切换回旧式的作品卡片，某些人需要直接展示所有tag，保留旧式UI的选项
    oldWorkCardUIStyle: LocalStorage.has(OLD_WORK_CARD_UI_STYLE_KEY) && LocalStorage.getItem(OLD_WORK_CARD_UI_STYLE_KEY),

    // 当前播放的文件夹中最后一个音频文件的trackId，用于自动标记为听完
    workLastTrackId: '',

    // 是否自动标记为听完（默认开启）
    autoMarkListened: LocalStorage.has(AUTO_MARK_LISTENED_KEY) ? LocalStorage.getItem(AUTO_MARK_LISTENED_KEY) : true,
  }
}
