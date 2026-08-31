<template>
  <div class="row items-center q-gutter-xs">
    <q-chip
      v-for="(term, index) in terms"
      :key="index"
      dense
      removable
      :color="term.negate ? 'error-container' : 'secondary-container'"
      :text-color="term.negate ? 'on-error-container' : 'on-secondary-container'"
      @remove="removeTerm(index)"
    >
      <span v-if="term.negate" class="q-mr-xs">−</span>
      <span v-if="term.field" class="text-caption q-mr-xs">{{ fieldLabel(term.field) }}</span>
      {{ displayValue(term) }}
    </q-chip>
  </div>
</template>

<script>
// The search grammar has exactly one implementation. This page renders the same
// terms the backend matches on, so it parses with the backend's own module
// rather than a copy that could drift from it. Kept dependency-free on that
// side so it bundles for the browser.
import { parseSearchQuery, formatSearchQuery } from '../../../backend/database/search-query'

export default {
  name: 'FilterTerms',

  props: {
    // Raw filter string, as it appears in the route query.
    filter: {
      type: String,
      default: ''
    }
  },

  emits: ['update:filter'],

  computed: {
    terms () {
      return parseSearchQuery(this.filter)
    }
  },

  methods: {
    fieldLabel (field) {
      // Falls back to the namespace itself for any field without a label.
      const key = `filterterms.${field}`
      return this.$te(key) ? this.$t(key) : field
    },

    // Tag names are stored canonically and translated only for display, the
    // same way the chips on a work page do it.
    displayValue (term) {
      return term.field === 'tag' ? this.$tTag(term.value) : term.value
    },

    removeTerm (index) {
      const rest = this.terms.filter((_, i) => i !== index)
      this.$emit('update:filter', formatSearchQuery(rest))
    }
  }
}
</script>
