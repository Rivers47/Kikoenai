<template>
  <span class="searchable-label" :class="{ 'searchable-label--chip': chip }">
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
      :class="['searchable-label__caret', caretClass]"
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
 * The caret is out of the flow, so a row measures exactly as it did before this
 * existed and there is nothing to reflow. Where it lands, and whether it is
 * always shown, both follow from that: over a chip it sits inside the chip's
 * own box, whose padding reserves the room either way, so hiding it buys
 * nothing and it simply stays visible. On plain text it falls on the label's
 * trailing margin with a backdrop to stay legible, and a run of those — the
 * '/'-separated circle and VA lists — would be a row of floating carets, so
 * there it is still revealed on hover or focus.
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

.searchable-label:hover > .searchable-label__caret,
.searchable-label:focus-within > .searchable-label__caret {
  opacity: 0.7;
}

.searchable-label--chip > .searchable-label__caret {
  opacity: 0.7;
}

/* Last, and matched on the button itself, so pointing at the caret wins over
   both rules above rather than tying with the one for its own label. */
.searchable-label > .searchable-label__caret:hover,
.searchable-label > .searchable-label__caret:focus-visible {
  opacity: 1;
}

/*
 * Inside the chip: the chip opens up room at its right edge and the caret sits
 * in it, so the pair reads as one control rather than a chip with something
 * next to it. Quasar's own numbers are what these offsets are built from —
 * .q-chip is margin 4px / padding 0.5em 0.9em, .q-chip--dense padding 0 0.4em —
 * and the caret needs about 1em of width at the chip's font size.
 *
 * The chip is not an ancestor of the button (it sits inside the link, and the
 * caret must stay out of it), so the offset is measured from the wrapper and
 * has to clear the chip's margin itself.
 */
.searchable-label--chip :deep(.q-chip) {
  padding-right: 1.9em;
}

.searchable-label--chip :deep(.q-chip--dense) {
  padding-right: 1.4em;
}

.searchable-label--chip .searchable-label__caret {
  right: 4px;
  background: none;
  border-radius: 0;
  /*
   * The caret sits on the chip but is a sibling of it — it has to stay outside
   * the link, and the chip is inside it — so `inherit` reaches past the chip to
   * whatever the surrounding container's colour is, which has nothing to do
   * with the surface being painted on. This is Quasar's default chip text
   * colour, which an uncoloured chip has in both themes (there is no
   * body--dark rule for a plain .q-chip). A chip with its own text-color
   * passes the matching class as `caret-class`, which wins on !important.
   */
  color: rgba(0, 0, 0, 0.87);
}

/*
 * A coarse pointer cannot hit a 20px target, so the caret is removed entirely
 * there and long-press on the label opens the same menu instead.
 */
@media (pointer: coarse) {
  .searchable-label__caret {
    display: none;
  }

  /* No caret to make room for. */
  .searchable-label--chip :deep(.q-chip),
  .searchable-label--chip :deep(.q-chip--dense) {
    padding-right: unset;
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
    },
    // The slot renders a q-chip, so the caret can live inside its box. Plain
    // text has no box to put it in and keeps the margin placement.
    chip: {
      type: Boolean,
      default: false
    },
    // Text colour of the chip the caret sits on, as the matching Quasar class
    // (`text-color="on-primary-container"` -> `text-on-primary-container`).
    // Needed because the caret is a sibling of the chip, not a descendant, so
    // it cannot inherit that colour — see the note in the styles. Only for a
    // chip carrying an explicit text-color; an uncoloured one is covered by
    // the default.
    caretClass: {
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
