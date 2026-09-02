<template>
  <div>
    <div class="text-h5 text-weight-regular q-ma-md">
      All {{restrict}}s
    </div>

    <div class="row justify-center q-pb-xl q-pt-none">
      <div class="col-11">
        <q-input dense rounded outlined v-model="keyword" :placeholder="`Search for a ${restrict}...`" class="q-mb-md">
          <template v-slot:append>
            <q-icon v-if="keyword === ''" name="search" />
            <q-icon v-else name="clear" class="cursor-pointer" @click="keyword = ''" />
          </template>
        </q-input>

        <div class="row justify-center q-gutter-sm">
          <div class="col-auto" v-for="item in (keyword ? filteredItems : items)" :key="item.id">
            <q-btn no-caps rounded color="primary" :label="itemLabel(item)" :lang="restrict === 'tags' ? $tagLang : null" :to="labelRoute(searchField, item.name)" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import NotifyMixin from '../mixins/Notification.js'
import { labelRoute } from 'src/utils'

export default {
  name: 'List',

  mixins: [NotifyMixin],

  props: {
    restrict: {
      type: String
    }
  },

  data () {
    return {
      items: [],
      keyword: ''
    }
  },

  created () {
    this.requestList()
  },

  computed: {
    url () {
      return `/api/${this.restrict}/`
    },

    // Route segment ('tags') -> search namespace ('tag').
    searchField () {
      switch (this.restrict) {
        case 'tags':
          return 'tag'
        case 'vas':
          return 'va'
        default:
          return 'circle'
      }
    },

    filteredItems () {
      return this.items.filter(item => item.name.toLowerCase().indexOf(this.keyword.toLowerCase()) !== -1)
    }
  },

  watch: {
    url () {
      this.requestList()
    }
  },

  methods: {
    labelRoute,
    itemLabel (item) {
      const name = this.restrict === 'tags' ? this.$tTag(item.name) : item.name
      return `${name} (${item.count})`
    },
    requestList () { 
      this.$axios.get(this.url)
        .then((response) => {
          this.items = response.data.concat()
        })
        .catch((error) => {
          if (error.response) {
            if (error.response.status !== 401) {
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
