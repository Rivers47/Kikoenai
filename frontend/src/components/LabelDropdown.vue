<template>
  <q-btn-dropdown
    split
    no-caps
    v-model="menuOpen"
    v-touch-hold="onHold"
    @click.capture="onClick"
    :toggle-aria-label="$t('searchablelabel.refineWith', { name })"
  >
    <q-list dense style="min-width: 160px">
      <q-item clickable v-close-popup @click="apply(false)">
        <q-item-section avatar class="label-dropdown__avatar">
          <q-icon name="add" size="xs" />
        </q-item-section>
        <q-item-section>{{ $t('searchablelabel.include') }}</q-item-section>
      </q-item>

      <q-item clickable v-close-popup @click="apply(true)">
        <q-item-section avatar class="label-dropdown__avatar">
          <q-icon name="remove" size="xs" />
        </q-item-section>
        <q-item-section>{{ $t('searchablelabel.exclude') }}</q-item-section>
      </q-item>
    </q-list>
  </q-btn-dropdown>
</template>

<style scoped>
@media (pointer: coarse) {
  :deep(.q-btn-dropdown__arrow-container) {
    display: none;
  }

  /* Make the right side still rounded when arrow is hidden */
  :deep(.q-btn-dropdown--current) {
    border-top-right-radius: inherit !important;
    border-bottom-right-radius: inherit !important;
  }
}

/* Quasar draws it as a flat rgba(255,255,255,.3), invisible on a light button. */


:deep(.q-btn-dropdown--current) {
  padding-left: 0.6em;
  padding-right: 0.6em;
}

/* A left icon's side bearing already supplies whitespace, so it gets pulled
   back by the difference. Labels without one stay symmetric. */
:deep(.q-btn-dropdown--current .on-left) {
  margin-left: -0.1em;
}

.label-dropdown__avatar {
  min-width: 0;
  padding-right: 8px;
}
</style>

<script>
import { filterWithLabel } from 'src/utils'

export default {
  name: 'LabelDropdown',

  props: {
    field: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true
    }
  },

  data () {
    return {
      menuOpen: false,
      justHeld: false
    }
  },

  methods: {
    onHold () {
      this.justHeld = true
      this.menuOpen = true
    },

    onClick (event) {
      if (!this.justHeld) return
      this.justHeld = false
      event.preventDefault()
      event.stopPropagation()
    },

    apply (negate) {
      const filter = filterWithLabel(this.$route.query.filter || '', this.field, this.name, negate)
      this.$router.push({ path: '/works', query: { filter } })
    }
  }
}
</script>
