<template>
  <q-layout view="hhh LpR fFf">
    <q-header elevated class="bg-black">
      <q-toolbar>
        <q-btn flat @click="drawer = !drawer" round dense icon="menu" />
        <q-toolbar-title>仪表盘</q-toolbar-title>
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="drawer"
      show-if-above

      :mini="miniState"
      @mouseover="miniState = false"
      @mouseout="miniState = true"
      mini-to-overlay

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
      links: [
        {
          title: '音声库',
          icon: 'folder',
          path: '/admin'
        },
        {
          title: '扫描',
          icon: 'youtube_searched_for',
          path: '/admin/scanner'
        },
        {
          title: '用户管理',
          icon: 'person',
          path: '/admin/usermanage'
        },
        {
          title: '进度回填',
          icon: 'history',
          path: '/admin/backfill'
        },
        {
          title: '高级设置',
          icon: 'settings',
          path: '/admin/advanced'
        },
        
        {
          title: '回到主页',
          icon: 'home',
          path: '/'
        }
      ]
    }
  },

  created () {
    // 从 LocalStorage 中读取 token
    const token = this.$q.localStorage.getItem('jwt-token') || ''
    this.$socket.auth = { auth_token: token }
    
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
</style>