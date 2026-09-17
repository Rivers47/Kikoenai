<template>
  <span class="searchable-label">
    <router-link
      :to="to"
      :class="linkClass"
      v-touch-hold="onHold"
      @click.capture="onLinkClick"
      @contextmenu="suppressTouchCallout"
    >
      <slot />
    </router-link>

    <button
      type="button"
      class="searchable-label__caret"
      :aria-label="$t('searchablelabel.refineWith', { name })"
      @click.stop.prevent
    >
      <q-icon name="expand_more" size="16px" />

      <q-menu v-model="menuOpen" anchor="bottom left" self="top left">
        <q-list dense style="min-width: 160px">
          <q-item clickable v-close-popup @click="apply(false)">
            <q-item-section avatar class="searchable-label__avatar">
              <q-icon name="add" size="xs" />
            </q-item-section>
            <q-item-section>{{ $t('searchablelabel.include') }}</q-item-section>
          </q-item>

          <q-item clickable v-close-popup @click="apply(true)">
            <q-item-section avatar class="searchable-label__avatar">
              <q-icon name="remove" size="xs" />
            </q-item-section>
            <q-item-section>{{ $t('searchablelabel.exclude') }}</q-item-section>
          </q-item>
        </q-list>
      </q-menu>
    </button>
  </span>
</template>

<style scoped>
.searchable-label {
  position: relative;
  display: inline-flex;
  align-items: center;
}

/*
 * Plain text has nothing to sit inside — the wrapper hugs the label — so the
 * caret is an ordinary flex item after it. Out of the flow it would land on the
 * last characters of the text, and now that it is always drawn rather than
 * revealed on hover, the space it takes is space it genuinely occupies. Being
 * in the flow it also needs no backdrop: it sits beside the text, not over it,
 * and `inherit` matches whatever that text is.
 */
.searchable-label__caret {
  display: inline-flex;
  align-items: center;
  margin-left: 1px;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 60ms;
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
import { filterWithLabel, suppressTouchCallout } from 'src/utils'

export default {
  name: 'SearchableLabel',

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
    suppressTouchCallout,

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

    // Narrows whatever filter is already in the route. On a page carrying none
    // — a work page — that is the same as starting one.
    apply (negate) {
      const filter = filterWithLabel(this.$route.query.filter || '', this.field, this.name, negate)
      this.$router.push({ path: '/works', query: { filter } })
    }
  }
}
</script>
