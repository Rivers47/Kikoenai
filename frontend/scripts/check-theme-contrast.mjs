// Guards colour pairs against low contrast, in every theme tier.
//
// A Quasar colour prop that sets a background does NOT imply a readable
// foreground: `use-btn.js` falls back to `text-${textColor || 'white'}`, so a
// solid `q-btn color="primary-container"` with no `text-color` renders white on
// pale lavender -- 1.29:1 in light mode, while dark mode measures 9.4:1 and
// looks perfectly fine. That asymmetry is why an omitted pair survives review:
// it only breaks in the tier you are not looking at.
//
// This script resolves the pair each element actually renders, per tier, and
// fails `npm test` when it is below WCAG AA (4.5:1 for text, 3:1 for icons and
// other non-text UI). Values come from the generated theme, so it measures the
// real palette rather than a hand-kept table.
//
// Limits, by design: static attribute values only (a bound `:color` is skipped,
// since either branch could render), and the page background is assumed to be
// `surface` for elements that sit on it.
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lineOf, read, stripComments, tags, walkVueFiles } from './lib/theme-scan.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
const CSS = join(SRC, 'css')

const MIN_TEXT = 4.5
const MIN_UI = 3

// --- WCAG 2.x relative luminance and contrast ratio -------------------------
const rgbOf = (hex) => {
  const full = hex.length === 4
    ? '#' + hex.slice(1).split('').map((c) => c + c).join('')
    : hex
  const n = parseInt(full.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const hexOf = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
const channel = (v) => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = (hex) => {
  const [r, g, b] = rgbOf(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
// Composite a translucent foreground over its background: Quasar's .q-chip
// default text is rgba(0,0,0,.87), not a theme token.
const over = (fg, bg, alpha) => {
  const [f, b] = [rgbOf(fg), rgbOf(bg)]
  return hexOf(f.map((v, i) => alpha * v + (1 - alpha) * b[i]))
}

// --- theme values, per tier -------------------------------------------------
const HEX_VAR = /--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{3,6})\b/g
const varsIn = (body) =>
  Object.fromEntries([...body.matchAll(HEX_VAR)].map((m) => [m[1], m[2].toUpperCase()]))

function blocksOf (css) {
  const out = {}
  // `\n\s*}` rather than `\n}`: the blocks inside the media query are indented.
  for (const m of css.matchAll(/(^|\n)([^\n{}]+)\{([\s\S]*?)\n\s*\}/g)) {
    const selector = m[2].trim()
    const vars = varsIn(m[3])
    if (Object.keys(vars).length) out[selector] = { ...(out[selector] ?? {}), ...vars }
  }
  return out
}

// The prefers-contrast media query is the only nested block in the generated
// file. Cut it out first, or its inner `:root` would be merged into the light
// tier and every light measurement would silently use the high-contrast tones.
function cutMedia (css) {
  const start = css.indexOf('@media (prefers-contrast: more)')
  if (start === -1) return { rest: css, media: '' }
  const open = css.indexOf('{', start)
  let depth = 0
  let i = open
  for (; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  return { rest: css.slice(0, start) + css.slice(i + 1), media: css.slice(open + 1, i) }
}

const themeCss = stripComments(read(join(CSS, 'material-theme.scss')))
const { rest, media } = cutMedia(themeCss)
const blocks = blocksOf(rest)
const mediaBlocks = blocksOf(media)

// Brand colours: the light scheme lives in quasar.variables.scss as $primary
// etc., every other tier overrides them as --q-primary. Quasar's own palette
// (white, grey-3, red-5, ...) comes from its sass variables.
const base = { white: '#FFFFFF', black: '#000000' }
for (const m of read(join(CSS, 'quasar.variables.scss')).matchAll(/^\$([a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{3,6})\b/gm)) {
  base[m[1]] = m[2].toUpperCase()
}
try {
  const quasarRoot = dirname(createRequire(import.meta.url).resolve('quasar/package.json'))
  const sass = read(join(quasarRoot, 'src/css/variables.sass'))
  for (const m of sass.matchAll(/^\$([a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{3,6})\b/gm)) {
    if (!(m[1] in base)) base[m[1]] = m[2].toUpperCase()
  }
} catch {
  // Only affects names outside the app's own theme (grey-3 and friends).
}

const BRANDS = ['primary', 'secondary', 'accent', 'negative', 'positive', 'info', 'warning', 'dark']
const layer = (source, selector) => source[selector] ?? {}

const TIERS = [
  { name: 'light', layers: [layer(blocks, ':root')] },
  { name: 'dark', layers: [layer(blocks, ':root'), layer(blocks, 'body.body--dark')] },
  { name: 'light-medium', layers: [layer(blocks, ':root'), layer(blocks, 'body.contrast-medium')] },
  { name: 'dark-medium', layers: [layer(blocks, ':root'), layer(blocks, 'body.body--dark'), layer(blocks, 'body.body--dark.contrast-medium')] },
  { name: 'light-high', layers: [layer(blocks, ':root'), layer(blocks, 'body.contrast-high')] },
  { name: 'dark-high', layers: [layer(blocks, ':root'), layer(blocks, 'body.body--dark'), layer(blocks, 'body.body--dark.contrast-high')] },
]
// The media query is generated from the same schemes as the manual high tier,
// so it is only worth a separate pass if that ever stops being true.
const sameVars = (a, b) => JSON.stringify(a) === JSON.stringify(b)
if (!sameVars(layer(mediaBlocks, ':root'), layer(blocks, 'body.contrast-high'))) {
  TIERS.push({ name: 'light-auto-high', layers: [layer(blocks, ':root'), layer(mediaBlocks, ':root')] })
}
if (!sameVars(layer(mediaBlocks, 'body.body--dark'), layer(blocks, 'body.body--dark.contrast-high'))) {
  TIERS.push({
    name: 'dark-auto-high',
    layers: [layer(blocks, ':root'), layer(blocks, 'body.body--dark'), layer(mediaBlocks, 'body.body--dark')],
  })
}

const unresolved = new Set()

function valueOf (name, tier) {
  if (name.startsWith('#')) return name.toUpperCase()
  let value = base[name]
  for (const vars of tier.layers) if (vars[name]) value = vars[name]
  // --q-<brand> is the per-tier override of the light $brand value.
  for (const vars of tier.layers) if (vars[`q-${name}`]) value = vars[`q-${name}`]
  if (!value) unresolved.add(name)
  return value
}

// --- what each element actually renders -------------------------------------
const SURFACE = 'surface' // app.scss paints the page with --surface
const WHITE = '#FFFFFF'
// Components whose `color` is a background, for ancestor tracking.
const COLOR_IS_BACKGROUND = new Set(['q-btn', 'q-badge', 'q-chip', 'q-avatar', 'q-card', 'q-banner', 'q-item']) 
const CHIP_TEXT = { over: ['#000000', 0.87] } // .q-chip { color: rgba(0,0,0,.87) }
const FOREGROUND_ONLY = new Set([
  'q-icon', 'q-knob', 'q-linear-progress', 'q-circular-progress', 'q-rating',
  'q-radio', 'q-select', 'q-date', 'q-time', 'q-tree', 'q-timeline-entry',
])

// The background an element actually sits on: the nearest ancestor that paints
// one, else the page surface. Without this, an icon inside
// `header-class="bg-negative"` is measured against the page and reported as
// white-on-white.
// `active-class`/`selected-class` only paint while the element is active, so a
// pair measured against them is a state-dependent warning, not a failure.
const CONDITIONAL_CLASS = /(?:^|-)(?:active|selected)-class$/

function backgroundOf (tag) {
  const always = []
  const conditional = []
  for (const attr of tag.attrs) {
    if (attr.name !== 'class' && !attr.name.endsWith('-class')) continue
    const target = CONDITIONAL_CLASS.test(attr.name) ? conditional : always
    for (const token of (attr.value ?? '').split(/\s+/)) {
      if (token.startsWith('bg-')) target.push(token.slice(3))
    }
  }
  if (always.length) return { bg: always.pop(), conditional: false }
  if (conditional.length) return { bg: conditional.pop(), conditional: true }
  const color = attrOf(tag, 'color')
  if (color.state === 'static' && COLOR_IS_BACKGROUND.has(tag.name)) return { bg: color.value, conditional: false }
  return undefined
}

const attrOf = (tag, name) => {
  const found = tag.attrs.find((a) => a.name === name || a.name === `:${name}` || a.name === `v-bind:${name}`)
  if (!found) return { state: 'absent' }
  if (found.name !== name) return { state: 'bound' }
  const value = (found.value ?? '').trim().split(/\s+/)[0]
  return value ? { state: 'static', value } : { state: 'absent' }
}
const has = (tag, name) => tag.attrs.some((a) => a.name === name)

function pairsFor (tag, pageBg) {
  const names = ['color', 'text-color', 'toggle-color', 'toggle-text-color', 'active-color', 'active-bg-color', 'indicator-color']
  const read = Object.fromEntries(names.map((n) => [n, attrOf(tag, n)]))
  // A bound value could render either branch, so the element is skipped rather
  // than guessed at.
  if (names.some((n) => read[n].state === 'bound')) return []
  const v = (n) => (read[n].state === 'static' ? read[n].value : undefined)

  const out = []
  const push = (bg, fg, kind, hint) => { if (bg && fg) out.push({ bg, fg, kind, hint }) }
  const color = v('color')
  const textColor = v('text-color')
  const flat = has(tag, 'flat') || has(tag, 'outline')

  switch (tag.name) {
    case 'q-btn':
      if (color) {
        if (flat) push(pageBg, textColor ?? color, 'text', 'flat/outline: the colour is the text')
        else push(color, textColor ?? WHITE, 'text', 'add text-color')
      } else if (textColor) push(pageBg, textColor, 'text')
      break
    case 'q-btn-toggle':
      push(v('toggle-color'), v('toggle-text-color') ?? WHITE, 'text', 'add toggle-text-color')
      push(color, textColor ?? WHITE, 'text', 'add text-color')
      break
    case 'q-badge':
      if (flat) push(pageBg, color ?? textColor, 'text')
      else push(color, textColor ?? WHITE, 'text', 'add text-color')
      break
    case 'q-chip':
      if (flat) push(pageBg, color ?? textColor, 'text')
      else push(color, textColor ?? CHIP_TEXT, 'text', 'add text-color')
      break
    case 'q-avatar':
      push(color, textColor ?? 'on-surface', 'text')
      break
    case 'q-tabs':
      push(v('active-bg-color') ?? pageBg, v('active-color'), 'text')
      push(pageBg, v('indicator-color'), 'ui')
      break
    case 'q-slider':
      push(pageBg, color, 'ui')
      break
    default:
      if (FOREGROUND_ONLY.has(tag.name) || tag.name.startsWith('q-spinner')) {
        push(pageBg, color ?? textColor, 'ui')
      } else if (color && textColor) {
        push(color, textColor, 'text')
      }
  }
  return out
}

// --- check ------------------------------------------------------------------
const failures = []
const warnings = []
let checked = 0

for (const file of walkVueFiles(SRC)) {
  const text = read(file)
  const rel = relative(ROOT, file)
  // Ancestor stack, so a foreground-only element is measured against the
  // background it is actually drawn on.
  const stack = []
  for (const tag of tags(text)) {
    if (tag.closing) {
      const at = stack.findLastIndex((entry) => entry.name === tag.name)
      if (at !== -1) stack.length = at
      continue
    }
    const ancestor = stack.findLast((entry) => entry.bg)
    const pageBg = ancestor?.bg ?? SURFACE
    const pageBgConditional = ancestor?.conditional ?? false
    for (const pair of pairsFor(tag, pageBg)) {
      const bad = []
      for (const tier of TIERS) {
        const bg = valueOf(pair.bg, tier)
        const fg = pair.fg.over
          ? (bg ? over(pair.fg.over[0], bg, pair.fg.over[1]) : undefined)
          : valueOf(pair.fg, tier)
        if (!bg || !fg) continue
        const ratio = contrast(fg, bg)
        checked += 1
        if (ratio < (pair.kind === 'ui' ? MIN_UI : MIN_TEXT)) bad.push(`${tier.name} ${ratio.toFixed(2)}:1`)
      }
      if (!bad.length) continue
      const fgLabel = pair.fg.over ? 'rgba(0,0,0,.87)' : pair.fg
      const target = pageBgConditional ? warnings : failures
      target.push({
        where: `${rel}:${lineOf(text, tag.index)} <${tag.name}>`,
        label: `${fgLabel} on ${pair.bg}`,
        bad,
        hint: pair.hint,
      })
    }
    if (!tag.selfClosing) {
      const painted = backgroundOf(tag)
      stack.push({ name: tag.name, bg: painted?.bg, conditional: painted?.conditional ?? false })
    }
  }
}

// The same pair usually repeats across a block of markup; collapse it.
const grouped = new Map()
for (const failure of failures) {
  const key = `${failure.label}|${failure.bad.join(',')}|${failure.hint ?? ''}`
  const entry = grouped.get(key) ?? { ...failure, count: 0, where: failure.where }
  entry.count += 1
  grouped.set(key, entry)
}

for (const warning of warnings) {
  console.warn(`  warning: ${warning.where}: ${warning.label} = ${warning.bad.join(', ')} (only while the ancestor is active)`)
}
for (const name of unresolved) {
  console.warn(`  warning: cannot resolve colour "${name}" to a hex value -- pair not measured`)
}

if (grouped.size) {
  console.error('\ntheme-contrast check failed -- pairs below WCAG AA:\n')
  for (const failure of grouped.values()) {
    const times = failure.count > 1 ? ` (${failure.count}x)` : ''
    console.error(`  ${failure.where}${times}: ${failure.label} = ${failure.bad.join(', ')}`)
    if (failure.hint) console.error(`      ${failure.hint}`)
  }
  console.error(
    `\nText needs ${MIN_TEXT}:1, icons and other non-text UI ${MIN_UI}:1, in every tier.\n` +
    'Values come from src/css/material-theme.scss (light, dark, contrast-medium/high).'
  )
  process.exit(1)
}

console.log(
  `theme-contrast check OK - ${checked} pairs across ${TIERS.length} tiers, ` +
  `all >= ${MIN_TEXT}:1 text / ${MIN_UI}:1 UI.`
)
