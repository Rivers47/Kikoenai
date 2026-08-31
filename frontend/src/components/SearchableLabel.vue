<template>
  <span class="searchable-label">
    <router-link
      :to="to"
      :class="linkClass"
      v-touch-hold="onHold"
      @click.capture="onLinkClick"
    >
      <slot />
    </router-link>

    <button
      ref="caret"
      type="button"
      class="searchable-label__caret"
      :aria-label="$t('searchablelabel.refineWith', { name })"
      @click.prevent.stop="menuOpen = true"
    >
      <q-icon name="expand_more" size="16px" />
    </button>

    <q-menu v-model="menuOpen" anchor="bottom left" self="top left">
      <q-list dense style="min-width: 160px">
        <q-item clickable v-close-popup @click="preview(false)">
          <q-item-section avatar class="searchable-label__avatar">
            <q-icon name="add" size="xs" />
          </q-item-section>
          <q-item-section>{{ $t('searchablelabel.include') }}</q-item-section>
        </q-item>

        <q-item clickable v-close-popup @click="preview(true)">
          <q-item-section avatar class="searchable-label__avatar">
            <q-icon name="remove" size="xs" />
          </q-item-section>
          <q-item-section>{{ $t('searchablelabel.exclude') }}</q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </span>
</template>

<style scoped>
.searchable-label {
  position: relative;
  display: inline-flex;
  align-items: center;
}

/*
 * The caret is only reachable with a fine pointer, so it stays invisible until
 * the label is hovered or focused. Space is reserved rather than collapsed
 * (opacity, not display) so revealing it never reflows the line.
 */
.searchable-label__caret {
  display: inline-flex;
  align-items: center;
  padding: 0 2px;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  opacity: 0;
  transition: opacity 60ms;
}

.searchable-label:hover .searchable-label__caret,
.searchable-label:focus-within .searchable-label__caret {
  opacity: 0.7;
}

.searchable-label__caret:hover,
.searchable-label__caret:focus-visible {
  opacity: 1;
}

/*
 * A coarse pointer cannot hit a 20px target, so the caret is removed entirely
 * there and long-press on the label opens the same menu instead.
 */
@media (pointer: coarse) {
  .searchable-label__caret {
    display: none;
  }

  /* Stop the long-press from selecting text or raising the OS callout menu. */
  .searchable-label {
    -webkit-touch-callout: none;
    user-select: none;
  }
}

.searchable-label__avatar {
  min-width: 0;
  padding-right: 8px;
}
</style>

<script>
import NotifyMixin from '../mixins/Notification.js'

export default {
  name: 'SearchableLabel',

  mixins: [NotifyMixin],

  props: {
    // Route the label itself navigates to — unchanged from the plain link.
    to: {
      type: [String, Object],
      required: true
    },
    // Search namespace this label belongs to (tag, va, circle, …).
    field: {
      type: String,
      required: true
    },
    // Canonical name, i.e. what a query would have to match. Not the
    // translated text the slot displays.
    name: {
      type: String,
      required: true
    },
    linkClass: {
      type: String,
      default: ''
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

    // A long-press ends in a click on the link, which would navigate away from
    // the menu that press just opened. Swallow that one click.
    onLinkClick (event) {
      if (!this.justHeld) return
      this.justHeld = false
      event.preventDefault()
      event.stopPropagation()
    },

    // UI prototype only: shows the term this action would contribute instead
    // of running a search.
    //
    // Quoted, so the name reaches the parser verbatim. The unquoted form would
    // turn any literal '_' in the name into a space (search-query.js) and match
    // the wrong row; a quoted '_' survives as a LIKE wildcard, which still
    // matches the intended name and at worst pulls in a near-neighbour.
    preview (negate) {
      const term = `${negate ? '-' : ''}${this.field}:"${this.name}$"`
      this.showSuccNotif(term)
    }
  }
}
</script>
