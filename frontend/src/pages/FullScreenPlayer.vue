<template>
  <div class="container" ref="container" @dblclick="clickOnContainer" :style="{'--cover-url': `url(${coverUrl})`}">
    <q-img fit="contain"
      :src="coverUrl"
      class="constrain-height"
      img-class="scale-animation image-style"
      :img-style="{'animation-play-state': playing ? 'running' : 'paused'}"
    />
    <div v-if="isInFullScreen" class="simple-progress" :style="progressBarStyle"></div>
    <div class="footer">
      <LyricsBar v-if="isInFullScreen && !enablePIPLyrics" />
    </div>
    <div v-if="isInFullScreen" class="current-playing-info">
      <div class="text-h6 text-weight-bolder non-selectable">
        {{ title }}
      </div>
    </div>
  </div>
</template>
   
<script>
import { mapState, mapGetters } from 'vuex'
import LyricsBar from 'components/LyricsBar'




export default {
  name: "FullScreenPlayer",

  components: {
    LyricsBar
  },

  data () {
    return {
      workid: this.$route.params.id,
      counter: 0,
      renderNotifier: { stop: false, pause: false },
      isInFullScreen: false,


    }
  },

  methods: {
    clickOnContainer() {
      if (this.isInFullScreen) {
        document.exitFullscreen();
      } else {
        this.$refs.container.requestFullscreen();
      }
    },

    // triggerred when fullscreen state changed
    onFullscreenChange() {
      this.isInFullScreen = document.fullscreenElement !== null;
    },

    audioElementInit() {
      // No-op: video source drawing has been removed
    }
  },

  computed: {
    coverUrl () {
      // 从 LocalStorage 中读取 token
      const token = this.$q.localStorage.getItem('jwt-token') || ''
      return this.visualPlayerCoverUrl
        ? `${this.visualPlayerCoverUrl}?token=${token}`
        : ""
    },

    containerStyle() {
      return {
        'background-image': `url("${this.coverUrl}")`,
      }
    },

    progressBarStyle() {
      let percent = (this.currentTime / this.duration) * 100;
      return {
        width: `${percent.toFixed(5)}%`,
      }
    },

    ...mapState('AudioPlayer', [
      'visualPlayerCoverUrl',
      'currentTime',
      'duration',
      'queue',
      'queueIndex',
      'playWorkId',
      'playing',
      'enablePIPLyrics',
    ]),

    ...mapGetters('AudioPlayer', [
      'currentPlayingFile'
    ]),

    title() {
      const org = this.currentPlayingFile.title;
      return org.substring(0, org.lastIndexOf("."));
    }
  },

  watch: {
    playing (isPlaying) {
      this.renderNotifier.pause = !isPlaying;
    },

  },
  created() {
    // console.log("full screen rounter workid = ", this.workid)
    
    if (this.workid === undefined && this.playWorkId !== 0) {
      // url 没有workid，但是当前正在播放对应的作品
      // 给当前网页跳转到包含作品id的当前页面上
      this.$router.push(`/fullScreenPlayer/${this.playWorkId}`);
    } else if (this.workid !== undefined && this.playWorkId === 0) {
      // url 有workid，但是当前没有播放对应的作品
      // 则强制跳转到对应的作品详细页面
      this.$router.push(`/work/${this.workid}`);
    } else if (this.workid === undefined && this.playWorkId === 0) {
      this.$q.notify({
        message: "当前没有播放任何作品，请先播放一个作品然后打开可视化页面",
        color: "negative",
      });
      this.$router.push(`/works`);
    }
  },
  mounted() {
    this.audioElementInit()
    this.$refs.container.addEventListener("fullscreenchange", this.onFullscreenChange)
  },
  beforeUnmount() {
    this.$refs.container.removeEventListener("fullscreenchange", this.onFullscreenChange)
  }
}
</script>

<style scoped>

.container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
}
.container::before {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  content: "";
  background-image: var(--cover-url);
  background-position: 50% 50%;
  background-size: cover;
  background-repeat: repeat;
  filter: blur(30px) brightness(0.7);
}

.constrain-height {
  /* max-height: calc(100vh - 110px); */
  max-height: 100%;
}

.simple-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  /* width: 100%; */
  background-color: var(--q-color-positive);
}

.footer {
  position: absolute;
  bottom: 0;
}

.current-playing-info {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  color: white;
  text-shadow: 1px 1px 0px rgb(82, 82, 82);
}

</style>

<style>

.scale-animation {
  animation-name: bump-shrink;
  animation-duration: 9s;
  animation-iteration-count: infinite;
  transform-origin: center;
  border-radius: 0px;
  overflow: hidden;
}

@keyframes bump-shrink {
  0% {transform: scale(1.0);}
  50% {transform: scale(1.1);}
  100% {transform: scale(1.0);}
}
</style>