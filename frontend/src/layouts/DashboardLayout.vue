<template>
  <q-layout view="hhh LpR fFf">
    <q-header elevated class="bg-black">
      <q-toolbar>
        <q-btn flat @click="drawer = !drawer" round dense icon="menu" />
        <q-toolbar-title>{{ $t('dashboardlayout.dashboard') }}</q-toolbar-title>
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="drawer"
      show-if-above

      :mini="miniState"
      @mouseover="miniState = false"
      @mouseout="miniState = true"
      mini-to-overlay
      no-mini-animation
      :width="200"
      :breakpoint="500"
      bordered
      content-class=""
    >
      <div class="column justify-between fit">
        <q-list padding class="col-auto">
          <q-item 
            clickable
            v-ripple
            exact
            :to="link.path"
            active-class="text-primary text-weight-bold"
            v-for="(link, index) in links"
            :key="index"
            class="col text-subtitle1"
          >
            <q-item-section avatar>
              <q-icon :name="link.icon" />
            </q-item-section>

            <q-item-section>
              {{link.title}}
            </q-item-section>
          </q-item>
        </q-list>
      </div>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script>
import NotifyMixin from '../mixins/Notification.js'

export default {
  name: 'DashboardLayout',

  mixins: [NotifyMixin],

  data () {
    return {
      drawer: false,
      miniState: true,
    }
  },

  computed: {
    links () {
      return [
        {
          title: this.$t('dashboardlayout.library'),
          icon: 'folder',
          path: '/admin'
        },
        {
          title: this.$t('dashboardlayout.scan'),
          icon: 'youtube_searched_for',
          path: '/admin/scanner'
        },
        {
          title: this.$t('dashboardlayout.userManage'),
          icon: 'person',
          path: '/admin/usermanage'
        },
        {
          title: this.$t('dashboardlayout.backfill'),
          icon: 'history',
          path: '/admin/backfill'
        },
        {
          title: this.$t('dashboardlayout.generalSettings'),
          icon: 'tune',
          path: '/admin/settings'
        },
        {
          title: this.$t('dashboardlayout.advancedSettings'),
          icon: 'settings',
          path: '/admin/advanced'
        },

        {
          title: this.$t('dashboardlayout.backToHome'),
          icon: 'home',
          path: '/'
        }
      ]
    }
  },

  created () {
    // 会话 cookie 会随同源握手请求自动发送，无需在此附加凭证
    this.$socket.on('success', this.onSocketSuccess)
    this.$socket.on('error', this.onSocketError)
    
    if (!this.$socket.connected) {
      this.$socket.connect()
    }
  },

  beforeUnmount () {
    this.$socket.off('success', this.onSocketSuccess)
    this.$socket.off('error', this.onSocketError)
  },

  methods: {
    onSocketSuccess (payload) {
      this.showSuccNotif(payload.message)
      if (payload.auth) {
        this.$store.commit('User/INIT', payload.user)
        this.$store.commit('User/SET_AUTH', payload.auth)
      }
    },
    onSocketError (err) {
      this.showWarnNotif(err.message || err)
      this.$socket.close()
      // 验证失败，跳转到登录页面
      this.$router.push('/login')
    }
  }
}
</script>

<style lang="scss" scoped>
  a {
    text-decoration:none;
  }

  aside.q-drawer:not(.q-drawer--mini) .q-scrollarea {
  width: 200px;
  min-width: 200px;
  }
// ponytail: 230 matches :width on the q-drawer above; bump both together if the
// drawer is widened.
  aside.q-drawer .q-item__label {
    white-space: normal;
    word-break: break-word;
  }
</style>