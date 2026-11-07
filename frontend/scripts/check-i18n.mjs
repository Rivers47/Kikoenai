// Guards the vue-i18n Composition API migration (see src/i18n/CONVENTIONS.md).
//
// The app runs in Composition API mode with `globalInjection: false`, so the
// legacy option-injected helpers do not exist at runtime: a stray `$t` renders
// nothing and only logs a dev warning. This script turns that silent breakage
// into a failing `npm test`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
const I18N_CONFIG = join(SRC, 'i18n', 'index.js')

// [pattern, what to use instead]
const FORBIDDEN = [
  [/\$t\s*\(/, "legacy $t() -- use `const { t } = useI18n()` in setup()"],
  [/\$tc\s*\(/, "legacy $tc() -- use t() with pluralization"],
  [/\$te\s*\(/, "legacy $te() -- destructure `te` from useI18n()"],
  [/\$tm\s*\(/, "legacy $tm() -- destructure `tm` from useI18n()"],
  [/\$rt\s*\(/, "legacy $rt() -- destructure `rt` from useI18n()"],
  [/\$tTag\s*\(/, 'global $tTag -- use useTagTranslate() from src/i18n'],
  [/\$tagLang\b/, 'global $tagLang -- use useTagTranslate() from src/i18n'],
  [/\$i18n\b/, 'global $i18n -- use useI18n() or i18n.global'],
  [/legacy\s*:\s*true/, 'legacy API mode -- vue-i18n must stay in Composition API mode'],
]

function walk (dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (entry.endsWith('.vue') || entry.endsWith('.js')) out.push(path)
  }
  return out
}

const hits = []
for (const file of walk(SRC)) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const [re, hint] of FORBIDDEN) {
      if (re.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}: ${hint}\n    ${line.trim()}`)
    }
  })
}

// Positive assertion: the instance really is in Composition API mode, so a
// flip back to `legacy: true` cannot hide behind a green lint run.
const config = readFileSync(I18N_CONFIG, 'utf8')
if (!/legacy\s*:\s*false/.test(config)) {
  hits.push(`${relative(ROOT, I18N_CONFIG)}: missing \`legacy: false\` in createI18n()`)
}
if (!/globalInjection\s*:\s*false/.test(config)) {
  hits.push(`${relative(ROOT, I18N_CONFIG)}: missing \`globalInjection: false\` in createI18n()`)
}

if (hits.length) {
  console.error('i18n check failed - legacy vue-i18n APIs found:\n')
  for (const hit of hits) console.error(`  ${hit}`)
  console.error('\nSee src/i18n/CONVENTIONS.md.')
  process.exit(1)
}

console.log('i18n check OK - composition mode, no legacy $t/$tTag/$tagLang usage.')
