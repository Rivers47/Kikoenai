<template>
  <q-layout view="hHh Lpr lFf" class="">
    <q-header reveal :reveal-offset="100" @reveal="onHeaderRevealChange" class="shadow-4">
      <q-toolbar class="row justify-between">
        <q-btn flat dense round @click="drawerOpen = !drawerOpen" icon="menu" aria-label="Menu" />

        <q-btn flat size="md" icon="arrow_back_ios" @click="back()" v-if="isNotAtHomePage"/>

        <q-toolbar-title class="gt-xs">
          <router-link :to="'/'" class="text-white">
            Kikoeru
          </router-link>
        </q-toolbar-title>

        <q-input dark dense rounded standout v-model="keyword" debounce="500" input-class="text-right" class="q-mr-sm">
          <template v-slot:append>
            <q-icon v-if="keyword === ''" name="search" />
            <q-icon v-else name="clear" class="cursor-pointer" @click="keyword = ''" />
          </template>
        </q-input>

      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="drawerOpen"
      show-if-above
      :mini="miniState"
      @mouseenter="miniState = false"
      @mouseleave="miniState = true"
      mini-to-overlay
      no-mini-animation
      :width="220"
      :breakpoint="500"
      bordered
      content-class=""
    >
      <q-scroll-area class="fit padding-bottom-play-bar">
        <q-list>
          <q-item
            clickable
            v-ripple
            exact
            :to="link.path"
            active-class="text-primary text-weight-medium"
            v-for="(link, index) in getLinks()"
            :key="index"
            @click="miniState = true"
          >
            <q-item-section avatar>
              <q-icon :name="link.icon" />
            </q-item-section>

            <q-item-section>
              <q-item-label class="text-subtitle1">
                {{ link.title }}
              </q-item-label>
            </q-item-section>
          </q-item>

          <q-item
            clickable
            v-ripple
            exact
            active-class="text-primary text-weight-medium"
            @click="randomPlay"
          >
            <q-item-section avatar>
              <q-icon name="shuffle" />
            </q-item-section>

            <q-item-section>
              <q-item-label class="text-subtitle1">
                {{ $t('mainlayout.randomPlay') }}
              </q-item-label>
            </q-item-section>
          </q-item>

          <q-item
            clickable
            v-ripple
            exact
            active-class="text-primary text-weight-medium"
            @click="toggleDarkMode"
          >
            <q-item-section avatar>
              <q-icon name="dark_mode" />
            </q-item-section>

            <q-item-section>
              <q-item-label class="text-subtitle1">
                {{ $t('mainlayout.darkMode') }}
              </q-item-label>
            </q-item-section>
          </q-item>

          <!-- <q-item
            clickable
            v-ripple
            exact
            @click="cycleContrastMode"
          >
            <q-item-section avatar>
              <q-icon name="contrast" />
            </q-item-section>

            <q-item-section>
              <q-item-label class="text-subtitle1">
                {{ $t('mainlayout.contrastMode', { mode: contrastModeLabel }) }}
              </q-item-label>
            </q-item-section>
          </q-item> -->

        </q-list>

        <q-list>
          <q-item
            clickable
            v-ripple
            exact
            active-class="text-primary text-weight-medium"
            @click="confirm = true"
            v-if="authEnabled"
          >
            <q-item-section avatar>
              <q-icon name="exit_to_app" />
            </q-item-section>

            <q-item-section>
              <q-item-label class="text-subtitle1">
                {{ $t('mainlayout.logout') }}
              </q-item-label>
              <q-item-label caption lines="2">{{ userName }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-scroll-area>
    </q-drawer>

    <q-dialog v-model="confirm" persistent>
      <q-card>
        <q-card-section class="row items-center">
          <q-avatar icon="power_settings_new" color="primary" text-color="white" />
          <span class="q-ml-sm">{{ $t('mainlayout.logoutConfirm') }}</span>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel')" color="primary" v-close-popup />
          <q-btn flat :label="$t('mainlayout.logoutButton')" color="primary" @click="logout()" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-page-container :class="{'page-container-style': isFullScreenPage, 'padding-bottom-play-bar': !isFullScreenPage}">
      <!-- <q-page padding> -->
      <router-view v-slot="{ Component }">
        <keep-alive include="Works">
          <component :is="Component" />
        </keep-alive>
      </router-view>
      <!-- </q-page> -->
      <q-page-scroller v-if="!isFullScreenPage" position="bottom-right" :scroll-offset="150" :offset="[18, 90]" class="scroller" :class="{'scroller-hide': !showScroller, 'scroller-show': showScroller}">
        <q-btn dense fab icon="keyboard_arrow_up" color="accent" padding="sm" />
      </q-page-scroller>
    </q-page-container>

    <div :style="{'z-index': miniState ? 3001 : 0}" style="position: fixed; bottom: 0;"> <!-- z-index must be greater than header z-index -->
      <PlayerBar />
      <AudioPlayer />
      <LyricsBar v-if="! enablePIPLyrics"/>
      <PIPLyrics />
    </div>
    <q-footer class="q-pa-none">
      <!--<PIPLyrics v-if="enablePIPLyrics && !isQueueEmpty" />-->
    </q-footer>
  </q-layout>
</template>

<script>
import PlayerBar from 'components/PlayerBar'
import AudioPlayer from 'components/AudioPlayer'
import LyricsBar from 'components/LyricsBar'
import PIPLyrics from 'src/components/PIPLyrics'
import NotifyMixin from '../mixins/Notification.js'
import { mapMutations, mapState, mapGetters } from 'vuex'
import { Dark } from 'quasar'
import { CONTRAST_MODES, getContrastMode, setContrastMode } from 'src/utils/contrast'

export default {
  name: 'MainLayout',

  mixins: [NotifyMixin],

  components: {
    PlayerBar,
    AudioPlayer,
    LyricsBar,
    PIPLyrics,
},

  data () {
    return {
      keyword: '',
      drawerOpen: false,
      miniState: true,
      confirm: false,
      randId: null,
      showScroller: false,
      contrastMode: getContrastMode(),
      links: [
        { titleKey: 'mediaLibrary', icon: 'widgets', path: '/' },
        { titleKey: 'fullScreenMode', icon: 'play_circle', path: '/fullScreenPlayer' },
        { titleKey: 'favourites', icon: 'favorite', path: '/favourites' },
        { titleKey: 'circles', icon: 'group', path: '/circles' },
        { titleKey: 'tags', icon: 'label', path: '/tags' },
        { titleKey: 'voiceActors', icon: 'mic', path: '/vas' },
        { titleKey: 'settings', icon: 'tune', path: '/admin' },
      ],
    }
  },

  watch: {
    keyword () {
      this.$router.push(this.keyword ? `/works?keyword=${this.keyword}` : `/works`)
    },

    randId () {
      this.$router.push(`/work/${this.randId}`)
    },
  },

  mounted () {
    this.initUser();
    this.checkUpdate();
  },

  computed: {
    contrastModeLabel () {
      const labels = {
        '': this.$t('mainlayout.systemDefault'),
        'contrast-medium': this.$t('mainlayout.contrastMedium'),
        'contrast-high': this.$t('mainlayout.contrastHigh'),
      }
      return labels[this.contrastMode] || ''
    },

    isNotAtHomePage () {
      const path = this.$route.path
      return path && path !=='/' && path !=='/works' && path !== '/favourites';
    },

    isFullScreenPage() {
      const path = this.$route.path
      return path && path.startsWith('/fullScreenPlayer');
    },

    ...mapState('User', {
      userName: 'name',
      authEnabled: 'auth'
    }),
    
    ...mapState('AudioPlayer', [
      'playWorkId',
      'enablePIPLyrics',
    ]),

    ...mapGetters('AudioPlayer', [
      'isQueueEmpty',
    ])
  },

  methods: {
    ...mapMutations('AudioPlayer', [
      'SET_AI_SERVER_URL',
    ]),
    initUser () {
      this.$axios.get('/api/auth/me')
        .then((res) => {
          this.$store.commit('User/INIT', res.data.user)
          this.$store.commit('User/SET_AUTH', res.data.auth)
        })
        .catch((error) => {
          if (error.response) {
            // 请求已发出，但服务器响应的状态码不在 2xx 范围内
            if (error.response.status === 401) {
              // this.showWarnNotif(error.response.data.error)
              // 验证失败，跳转到登录页面
              const path = this.$router.currentRoute.path
              if (path !=='/login') {
                this.$router.push('/login');
              }
            } else {
              this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
            }
          } else {
            this.showErrNotif(error.message || error)
          }
        })
    },

    checkUpdate () {
      this.$axios.get('/api/version')
        .then((res) => {
          if (res.data.update_available && res.data.notifyUser) {
            this.$q.notify({
              message: this.$t('mainlayout.updateAvailable'),
              color: 'primary',
              textColor: 'white',
              icon: 'cloud_download',
              timeout: 5000,
              actions: [
                { label: this.$t('common.ok'), color: 'white' },
                { label: this.$t('mainlayout.viewUpdate'), color: 'white', handler: () => {
                    Object.assign(document.createElement('a'), {
                      target: '_blank',
                      href: 'https://github.com/umonaca/kikoeru-express/releases',
                    }).click();
                  }
                }
              ],
            })
          }

          if (res.data.lockFileExists) {
            this.$q.notify ({
              message: res.data.lockReason,
              type: 'warning',
              timeout: 60000,
              actions: [
                { label: this.$t('mainlayout.remindLater'), color: 'black' },
                { label: this.$t('mainlayout.goToScanner'), color: 'black', handler: () => this.$router.push('/admin/scanner')}
              ],
            })
          }
        })
        .catch((error) => {
          console.error(error);
        })
    },

    randomPlay() {
      this.requestRandomWork();
    },

    requestRandomWork () {
      const params = {
        order: 'betterRandom'
      }
      this.$axios.get('/api/works', { params })
        .then((response) => {
          const works = response.data.works
          this.randId = works.length ? works[0].id : null;
        })
        .catch((error) => {
          if (error.response) {
            // 请求已发出，但服务器响应的状态码不在 2xx 范围内
            if (error.response.status !== 401) {
              this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
            }
          } else {
            this.showErrNotif(error.message || error)
          }
        })
    },

    logout () {
      this.$q.localStorage.set('jwt-token', '')
      this.$router.push('/login')
    },

    back () {
      this.$router.go(-1)
    },

    toggleDarkMode() {
      console.log("toggleDarkMode called")
      Dark.toggle();
    },

    cycleContrastMode() {
      const next = CONTRAST_MODES[(CONTRAST_MODES.indexOf(this.contrastMode) + 1) % CONTRAST_MODES.length]
      setContrastMode(next)
      this.contrastMode = next
    },

    getLinks() {
      return this.links.filter(link => {
        if (link.path === '/fullScreenPlayer' && this.playWorkId == 0)
          return false;
        return true;
      }).map(link => {
        const copy = { ...link, title: this.$t('mainlayout.' + link.titleKey) }
        if (link.path === '/fullScreenPlayer') {
          copy.path += `/${this.playWorkId}`
        }
        return copy
      })
    },
    
    onHeaderRevealChange(isReveal) {
      this.showScroller = isReveal;
    }
  },
}
</script>


<style lang="scss">
// 侧边栏底部按钮
  aside.q-drawer div.q-scrollarea > div.scroll > div {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    height: 100%;
  }

// Lock the drawer's inner content to the expanded width (230px) so long EN/JP
// nav labels (e.g. "Contrast: System Default") pre-wrap at the final width.
// Without this, the mini→overlay width animation reflows the text every hover,
// making labels flicker between wrapping and not wrapping.
// Scoped to :not(.q-drawer--mini) so the folded (57px) view keeps its natural
// width — otherwise Quasar centers the lone icon in a 230px q-item and the
// 57px clip hides it, leaving the rail blank ("white/hidden" icons).
aside.q-drawer:not(.q-drawer--mini) .q-scrollarea {
  width: 210px;
  min-width: 210px;

  // The vertical scrollbar steals ~15px of width, leaving the viewport
  // narrower than the 230px content above -> Quasar shows a horizontal
  // thumb. Nav labels never need horizontal scroll, so clip it.
  //overflow-x: hidden;
  //actually instead we set the above width to alight less than the q-drawer width
  }
// ponytail: 230 matches :width on the q-drawer above; bump both together if the
// drawer is widened.
  aside.q-drawer .q-item__label {
    white-space: normal;
    word-break: break-word;
}

// 中心主要页面的尺寸样式
.page-container-style {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;
  /* overflow-y: auto; */
}

// 为了避开底部的play bar设置的padding
.padding-bottom-play-bar {
  padding-bottom: 80px !important 
}

.scroller {
  transition: 0.3s;
}

.scroller-show {
  opacity: 1.0;
  visibility: visible;
}

.scroller-hide {
  opacity: 0;
  visibility: collapse;
}
</style>
