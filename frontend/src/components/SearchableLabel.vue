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
 * the label is hovered or focused.
 *
 * It is taken out of the flow rather than given room of its own: reserving
 * space kept the line from reflowing, but it did so by padding every label by
 * the caret's width, which spread a row of chips out. Out of flow the row
 * measures exactly as it did before this existed, and there is still nothing to
 * reflow on hover. It lands on the chip's own margin, so it overlaps the gap
 * between chips rather than the text.
 */
.searchable-label__caret {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--surface-container-highest, rgba(127, 127, 127, 0.9));
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
import { filterWithLabel } from 'src/utils'

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
