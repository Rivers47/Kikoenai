// Shared scanning helpers for the theme guards (check-theme-classes.mjs and
// check-theme-contrast.mjs). Kept in one place so both agree on what a tag, an
// attribute and a line number are.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const read = (path) => readFileSync(path, 'utf8')

export const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

export const lineOf = (text, index) => text.slice(0, index).split('\n').length

// Strings inside a bound value: :color="cond ? 'on-primary' : 'negative'"
export const LITERALS = /'([^']*)'|"([^"]*)"/g

export function walkVueFiles (dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walkVueFiles(path))
    else if (entry.endsWith('.vue')) out.push(path)
  }
  return out
}

// Hand-rolled instead of a regex so that `>` inside a quoted attribute value
// (v-if="a > b", :label="x > 0") cannot truncate a tag.
//
// Yields closing tags too (`closing: true`, no attrs) so a caller can track
// nesting, and reports `selfClosing` so it knows what to push on its stack.
export function* tags (text) {
  let i = 0
  while ((i = text.indexOf('<', i)) !== -1) {
    if (text[i + 1] === '/' && text[i + 2] === 'q' && text[i + 3] === '-') {
      let k = i + 2
      while (k < text.length && /[-\w]/.test(text[k])) k += 1
      yield { name: text.slice(i + 2, k), attrs: [], index: i, closing: true, selfClosing: false }
      i = k
      continue
    }
    if (!(text[i + 1] === 'q' && text[i + 2] === '-' && /[a-zA-Z0-9]/.test(text[i + 3] ?? ''))) {
      i += 1
      continue
    }
    let j = i + 1
    while (j < text.length && /[-\w]/.test(text[j])) j += 1
    const name = text.slice(i + 1, j)
    const attrs = []
    let selfClosing = false
    while (j < text.length && text[j] !== '>') {
      while (j < text.length && /\s/.test(text[j])) j += 1
      if (text[j] === '>' || j >= text.length) break
      if (text[j] === '/') { selfClosing = true; j += 1; continue }
      const nameStart = j
      while (j < text.length && !/[\s=/>]/.test(text[j])) j += 1
      const attrName = text.slice(nameStart, j)
      while (j < text.length && /\s/.test(text[j])) j += 1
      let value = null
      if (text[j] === '=') {
        j += 1
        while (j < text.length && /\s/.test(text[j])) j += 1
        const quote = text[j]
        if (quote === '"' || quote === "'") {
          const end = text.indexOf(quote, j + 1)
          value = text.slice(j + 1, end === -1 ? text.length : end)
          j = end === -1 ? text.length : end + 1
        } else {
          const start = j
          while (j < text.length && !/[\s>]/.test(text[j])) j += 1
          value = text.slice(start, j)
        }
      }
      if (attrName) attrs.push({ name: attrName, value, start: nameStart, end: j })
    }
    yield { name, attrs, index: i, closing: false, selfClosing }
    i = j + 1
  }
}
