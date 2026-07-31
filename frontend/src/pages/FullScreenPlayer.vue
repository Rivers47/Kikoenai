<template>
  <div class="container" ref="container" @dblclick="clickOnContainer" :style="{'--cover-url': `url(${coverUrl})`}">
    <q-img fit="contain" v-if="!enableDrawVideo"
      :src="coverUrl"
      class="constrain-height"
      img-class="scale-animation image-style"
      :img-style="{'animation-play-state': playing ? 'running' : 'paused'}"
    />
    <div v-if="enableDrawVideo" ref="videoCanvasContainer" class="video-canvas">
      <canvas ref="videoCanvas" width="1000" height="1000"></canvas>
    </div>
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

      enableDrawVideo: true,
      videoElement: null,
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
      this.checkVisualEffect();
      
      const canvas = this.$refs.videoCanvas;
      if (!canvas) return;
      const canvasCtx = canvas.getContext("2d");

      this.renderNotifier.stop = true;
      let newNotifier = {stop: false, pause: !this.playing, drawer: null};
      const draw = (millsTime) => {
        if (newNotifier.stop) return false;
        requestAnimationFrame(draw);

        let pauseDraw = newNotifier.pause;

        // sync canvas inner drawing size with client element size
        if (canvasCtx.canvas.width !== canvasCtx.canvas.clientWidth) {
          canvasCtx.canvas.width = canvasCtx.canvas.clientWidth * window.devicePixelRatio;
          pauseDraw = false;
        }
        if (canvasCtx.canvas.height !== canvasCtx.canvas.clientHeight) {
          canvasCtx.canvas.height = canvasCtx.canvas.clientHeight * window.devicePixelRatio;
          pauseDraw = false;
        }

        if (this.enableDrawVideo && this.video) {
          pauseDraw = false;
          canvasCtx.clearRect(0, 0, canvasCtx.canvas.width, canvasCtx.canvas.height);
          this.drawVideoInCanvas(canvas, canvasCtx)
        }

        if (pauseDraw) return false;
      };
      newNotifier.drawer = draw;
      this.renderNotifier = newNotifier;
      requestAnimationFrame(newNotifier.drawer);
    },

    drawVideoInCanvas(canvas, canvasCtx) {
      const containerRatio = canvas.width / canvas.height;
      const video = this.video;
      const videoRatio = video.videoWidth / video.videoHeight;

      let x,y,newVideoWidth, newVideoHeight
      if (containerRatio > videoRatio) {
        // 横置居中
        newVideoHeight = canvas.height;
        newVideoWidth = videoRatio * newVideoHeight;
        x = 0.5 * (canvas.width - newVideoWidth)
        y = 0;
      } else {
        // 竖置居中
        newVideoWidth = canvas.width;
        newVideoHeight = newVideoWidth / videoRatio;
        x = 0;
        y = 0.5 * (canvas.height - newVideoHeight)
      }
      canvasCtx.drawImage(video, x, y, newVideoWidth, newVideoHeight)
    },

    checkVisualEffect() {
      this.enableDrawVideo = this.enableVideoSource && this.isCurrentPlayingFileVideo;
      if (this.enableDrawVideo) {
        this.video = document.querySelector("#mediaVideo");
      }
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
      'enableVideoSource'
    ]),

    ...mapGetters('AudioPlayer', [
      'currentPlayingFile',
      'isCurrentPlayingFileVideo'
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
    currentPlayingFile() {
      this.checkVisualEffect()
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
    this.checkVisualEffect();
  },
  beforeUnmount() {
    this.renderNotifier.stop = true;
    this.$refs.container.removeEventListener("fullscreenchange", this.onFullscreenChange)
    this.video = null;
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

.video-canvas {
  position: absolute;
  width: 100%;
  height: 100%;
  left: 0;
  bottom: 0;
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