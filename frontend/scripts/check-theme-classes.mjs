// Guards Quasar color props and theme classes against names that do not exist.
//
// Quasar builds the class for a color prop by string concatenation:
//   color="primary"                -> bg-primary
//   toggle-text-color="on-primary" -> text-on-primary
// so a name with no matching CSS rule renders completely unstyled and prints
// nothing at all. Neither Vue (the class is just a string) nor the browser (an
// unmatched class is a no-op) can tell `text-text-on-primary`, or a
// `text-on-surface0-variant` typo in a `class=`, from a class the app simply
// never defined. This script makes that failure loud in `npm test`.
//
// Valid names are derived from the CSS that actually ships, not from a list
// that could drift:
//   - Quasar's palette          node_modules/quasar/src/css/core/colors.sass
//                               (and dist/quasar.css, which also carries the
//                               typography/flex helpers: .text-h5, .text-bold)
//   - generated M3 utilities    src/css/theme-utilities.scss
//   - hand-written classes      src/css/*.scss (e.g. .text-rating-star)
//   - component-local styles    <style> blocks in src/**/*.vue
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LITERALS, lineOf, read, stripComments, tags, walkVueFiles } from './lib/theme-scan.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
const CSS = join(SRC, 'css')

// --- which props build which class, and whether it is bg-* or text-* ---------
// Names are the kebab-case attribute form. Verified against the components in
// node_modules/quasar/src/components; a prop that is not listed here is not
// checked at all, so an unlisted one can never produce a false positive.
const TEXT_PROPS = new Set([
  'text-color', 'toggle-text-color', 'active-text-color', 'label-color',
  'label-text-color', 'active-color', 'indicator-color', 'thumb-color',
  'separator-color', 'toolbar-text-color', 'control-color', 'center-color',
])
const BG_PROPS = new Set([
  'toggle-color', 'active-bg-color', 'track-color', 'inner-track-color',
  'selection-color',
])
// Props whose kind depends on the component: QChatMessage turns `bg-color` into
// a text- class, QPullToRefresh into a bg- one. Accept either rather than guess.
const EITHER_PROPS = new Set(['color', 'bg-color'])

// `color` itself is bg-* on a button/badge/chip/avatar and text-* on the
// components below (QIcon line 79, QLinearProgress line 71, ...). Only the
// unambiguous text-only ones are listed; everything else falls back to either.
const COLOR_IS_TEXT = new Set([
  'q-icon', 'q-knob', 'q-linear-progress', 'q-circular-progress', 'q-rating',
  'q-radio', 'q-select', 'q-date', 'q-time', 'q-tree', 'q-timeline-entry',
])
const isSpinner = (tag) => tag.startsWith('q-spinner')

// --- CSS sources ------------------------------------------------------------
const classesFrom = (css) => {
  const found = { bg: new Set(), text: new Set() }
  for (const m of stripComments(css).matchAll(/\.(bg|text)-([a-z0-9-]+)/g)) {
    found[m[1]].add(m[2])
  }
  return found
}

// Quasar's own palette. `colors.sass` is the literal list of every .bg-*/.text-*
// rule it emits; `dist/quasar.css` is the same set already compiled, used only
// if a future release stops shipping sources.
const app = { bg: new Set(), text: new Set() }
const addAll = (source) => {
  for (const kind of ['bg', 'text']) for (const name of source[kind]) app[kind].add(name)
  return source.bg.size + source.text.size
}

try {
  const quasarRoot = dirname(createRequire(import.meta.url).resolve('quasar/package.json'))
  let found = 0
  for (const candidate of ['src/css/core/colors.sass', 'dist/quasar.css']) {
    try { found += addAll(classesFrom(read(join(quasarRoot, candidate)))) } catch { /* next */ }
  }
  if (found === 0) {
    console.error(
      'theme-class check cannot run: no Quasar palette found under ' + quasarRoot +
      '\n(looked for src/css/core/colors.sass and dist/quasar.css). Run `npm install`.'
    )
    process.exit(1)
  }
} catch {
  console.error('theme-class check cannot run: the `quasar` package is not installed. Run `npm install`.')
  process.exit(1)
}

// Between them, these carry the brand colors Quasar emits and the generated /
// hand-written utility classes. quasar.variables.scss is included so the brand
// names survive even if Quasar's palette source ever moves.
for (const entry of readdirSync(CSS)) {
  if (!entry.endsWith('.scss')) continue
  const css = read(join(CSS, entry))
  addAll(classesFrom(css))
  if (entry === 'quasar.variables.scss') {
    for (const m of css.matchAll(/\$([a-z0-9-]+)\s*:/g)) {
      app.bg.add(m[1])
      app.text.add(m[1])
    }
  }
}

const has = (kind, name) =>
  kind === 'either' ? app.bg.has(name) || app.text.has(name) : app[kind].has(name)

const LOOKS_LIKE_NAME = /^[a-z0-9][a-z0-9-]*$/i

// Nearest candidate, for "did you mean ...?" -- a typo is the common case.
function nearest (name, kind) {
  const pool = kind === 'either' ? [...app.bg, ...app.text] : [...app[kind]]
  let best = null
  let bestDistance = 3
  for (const candidate of pool) {
    const distance = editDistance(name, candidate)
    if (distance < bestDistance) { best = candidate; bestDistance = distance }
  }
  return best
}

function editDistance (a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3
  let prev = [...Array(b.length + 1).keys()]
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = row
  }
  return prev[b.length]
}

// --- checks -----------------------------------------------------------------
const errors = []
const warnings = []

function checkName (name, kind, where, prop) {
  const suggest = () => {
    const candidate = nearest(name, kind)
    return candidate ? ` -- did you mean "${candidate}"?` : ''
  }
  if (/^(text|bg)-[a-z0-9]/i.test(name)) {
    errors.push(
      `${where}: ${prop} builds the class itself, so "${name}" becomes ` +
      `"${name.startsWith('text-') ? 'text-' : 'bg-'}${name}" -- pass "${name.replace(/^(text|bg)-/, '')}"`
    )
    return
  }
  if (name.startsWith('#') || name.includes('(') || name.includes(' ')) {
    errors.push(`${where}: ${prop} expects a theme color name, not a CSS color: "${name}"`)
    return
  }
  if (!has(kind, name)) {
    const wanted = kind === 'either'
      ? `"bg-${name}" or "text-${name}"`
      : `"${kind}-${name}"`
    errors.push(`${where}: ${prop}="${name}" -- no ${wanted} class exists${suggest()}`)
  }
}

// Any attribute ending in `class` holds a class list: class, :class,
// content-class, link-class, ...
const CLASS_ATTR = /(?:^|[^\w-])(:?)((?:[a-z0-9]+-)*class)\s*=\s*("([^"]*)"|'([^']*)')/g
const THEME_CLASS = /^(?:bg|text)-[a-z0-9-]+$/

const files = walkVueFiles(SRC)
const source = new Map(files.map((file) => [file, read(file)]))

// Component-local <style> blocks count too: TextViewer.vue defines
// .text-file-content scoped to itself, and that is a legitimate class.
for (const text of source.values()) {
  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) addAll(classesFrom(m[1]))
}

for (const [file, text] of source) {
  const rel = relative(ROOT, file)

  // `class="text-text-on-primary"` -- the prefix is applied twice.
  for (const m of text.matchAll(/\b((?:text|bg)-(?:text|bg)-[a-z0-9-]+)/g)) {
    errors.push(`${rel}:${lineOf(text, m.index)}: "${m[1]}" -- the prefix is applied twice`)
  }

  for (const m of text.matchAll(CLASS_ATTR)) {
    const bound = m[1] === ':'
    const attrName = m[2]
    const where = `${rel}:${lineOf(text, m.index)} ${attrName}`
    const value = (m[4] ?? m[5] ?? '').trim()
    if (value === '') continue
    const lists = bound
      ? [...value.matchAll(LITERALS)].map((lit) => lit[1] ?? lit[2])
      : [value]
    for (const list of lists) {
      for (const token of list.split(/\s+/)) {
        if (!THEME_CLASS.test(token)) continue
        // Already reported above, with a clearer message, by the double-prefix pass.
        if (/^(?:text|bg)-(?:text|bg)-/.test(token)) continue
        if (has('either', token.replace(/^(?:bg|text)-/, ''))) continue
        errors.push(`${rel}:${lineOf(text, m.index)}: ${attrName}="...${token}..." -- no ".${token}" class exists`)
      }
    }
  }

  for (const tag of tags(text)) {
    const where = `${rel}:${lineOf(text, tag.index)} <${tag.name}>`
    for (const attr of tag.attrs) {
      const bound = attr.name.startsWith(':') || attr.name.startsWith('v-bind:')
      const prop = attr.name.replace(/^v-bind:/, '').replace(/^:/, '').replace(/\..*$/, '')
      if (attr.value === null) continue
      const value = attr.value.trim()
      if (value === '') continue

      let kind = null
      if (TEXT_PROPS.has(prop)) kind = 'text'
      else if (BG_PROPS.has(prop)) kind = 'bg'
      else if (EITHER_PROPS.has(prop)) {
        kind = prop === 'color' && (COLOR_IS_TEXT.has(tag.name) || isSpinner(tag.name))
          ? 'text'
          : 'either'
      }
      if (kind === null) continue

      if (bound) {
        // Only string literals can be judged; a variable's value is unknown.
        for (const m of value.matchAll(LITERALS)) {
          const literal = (m[1] ?? m[2]).trim()
          if (LOOKS_LIKE_NAME.test(literal)) checkName(literal, kind, where, `:${prop}`)
        }
        continue
      }

      // Static: `color="secondary q-mt-sm"` works by accident (Quasar copies the
      // whole string into the class list), so the stray tokens are a warning.
      const [first, ...rest] = value.split(/\s+/)
      checkName(first, kind, where, prop)
      if (rest.length) {
        warnings.push(
          `${where}: ${prop}="${value}" -- only "${first}" is the color; ` +
          `"${rest.join(' ')}" is being smuggled in as classes`
        )
      }
    }
  }
}

// The same sloppy value usually repeats across a whole block of markup, so
// collapse duplicates into one line with a count instead of seven identical ones.
const seen = new Map()
for (const warning of warnings) {
  const key = warning.replace(/:\d+/, '')
  seen.set(key, (seen.get(key) ?? 0) + 1)
}
for (const [warning, count] of seen) {
  console.warn(`  warning: ${warning}${count > 1 ? ` (${count}x)` : ''}`)
}
if (errors.length) {
  console.error('\ntheme-class check failed -- color names with no matching CSS:\n')
  for (const error of errors) console.error(`  ${error}`)
  console.error(
    '\nValid names come from node_modules/quasar/src/css/core/colors.sass,\n' +
    'src/css/theme-utilities.scss, src/css/*.scss and <style> blocks in .vue files.\n' +
    'Color props take the NAME (`on-primary`); Quasar prepends bg-/text- itself.'
  )
  process.exit(1)
}

console.log(
  `theme-class check OK - ${app.text.size + app.bg.size} color names, ` +
  `0 unknown (${warnings.length} warning${warnings.length === 1 ? '' : 's'}).`
)
