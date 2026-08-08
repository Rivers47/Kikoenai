<template>
  <q-form @submit="onSubmit" style="width: 260px;" class="absolute-center	q-gutter-md">
    <q-input filled v-model="name" :label="$t('login.username')" class="fit"
      lazy-rules
      :rules="[ val => val.length >= 5 || $t('login.minLengthError') ]"
    />

    <q-input filled type="password" v-model="password" :label="$t('login.password')"  class="fit"
      lazy-rules
      :rules="[ val => val.length >= 5 || $t('login.minLengthError') ]"
    />

    <q-btn :label="$t('login.login')" type="submit" color="primary" class="fit" />
  </q-form>
</template>
   
<script>
import NotifyMixin from '../mixins/Notification.js'

export default {
  mixins: [NotifyMixin],

  data () {
    return {
      name: '',
      password: '',
    }
  },

  methods: {
    onSubmit () {
      this.$axios.post('/api/auth/me', {
        name: this.name,
        password: this.password
      })
        .then(() => {
          // The server already issued the session cookie via Set-Cookie, so there is
          // no credential for the frontend to store. (The `session` field in the
          // response body exists only for non-browser clients.)
          this.showSuccNotif(this.$t('login.loginSuccess'))
          this.$router.push('/')
        })
        .catch((error) => {
          if (error.response) {
            // 请求已发出，但服务器响应的状态码不在 2xx 范围内
            if (error.response.status === 401) {
              this.showWarnNotif(error.response.data.error)
            } else {
              this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
            }
          } else {
            this.showErrNotif(error.message || error)
          }
        })
    }, 
  }
}
</script>