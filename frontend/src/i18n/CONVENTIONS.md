# i18n conventions — READ BEFORE EDITING .vue FILES

This file is the single source of truth for the i18n migration. Every subagent
working on a .vue file must follow it exactly so keys stay consistent and
catalog files don't collide.

## Locales
- `zh-CN` — base/complete (fallbackLocale). Always has every key.
- `en-US`, `ja-JP` — complete, seeded at launch.
- `zh-TW` — complete.

## Two translation layers (kept apart)
1. **Static UI strings** → vue-i18n. Use `$t('scope.key')` in templates, `this.$t(...)` in Options API script.
2. **Dynamic tag names** → `translateTag(name, locale)` in `src/i18n/tags/index.js`, exposed as `$tTag(name)` by `src/boot/i18n.js`. Tag names are DATA (canonical Japanese from the backend), never go in the vue-i18n catalog.

**Tag display language is a separate setting from the UI language** (LocalStorage
`tag_language`, default `follow` = track the UI). `$tTag` resolves against it, not
against the vue-i18n locale. Any element rendering `$tTag` must also carry
`:lang="$tagLang"` so the browser picks the right Han glyph variants — see
`frontend/AGENTS.md` §2.10.

## Key naming
- Format: `<scope>.<id>` — lowercase scope, camelCase id.
- **Scope = the .vue file's name** (without `.vue`), lowercased. Examples:
  - `WorkDetails.vue` → scope `workdetails`
  - `Dashboard/Advanced.vue` → scope `advanced`
  - `WorkCard.vue` → scope `workcard`
- Each scope is a top-level object in every locale's catalog.
- **Shared/repeated strings** (OK, Cancel, Save, Delete, Loading, yes/no, search, etc.) live under scope `common`. Check existing `common` keys before adding a new one for a repeated concept; reuse if it exists.
- Ids should be descriptive: `workdetails.releaseDate`, not `workdetails.label3`.

## Catalog files (per-scope partials, no collisions)
Each .vue file you own gets **four partial files**, one per locale:
```
src/i18n/parts/<locale>/<scope>.js
```
Each exports a default object (the scope's keys for that locale). Example:
```js
// src/i18n/parts/en-US/workdetails.js
export default {
  releaseDate: 'Release date',
  tags: 'Tags',
}
```
The assembler `src/i18n/index.js` imports every partial and builds the full
catalog. **You only ever create/edit your own scope's files** — never touch
another scope's partial or `index.js`. This is what lets parallel agents not
clobber each other.

When you create a partial, also add the scope to ALL THREE locales (zh-CN,
en-US, ja-JP) even if you only fully translate one — copy the keys across so the
shape matches. If a locale's value is unknown, use the zh-CN value as a
placeholder (it will fall back anyway, but keeping the shape is cleaner).

## Editing a .vue file
1. Read the whole file first. Trace every Chinese string in template AND script.
2. For each user-visible Chinese string:
   - In templates: `标签` → `{{ $t('workdetails.tags') }}` (inside attributes too:
     `label="标签"` → `:label="$t('workdetails.tags')"`).
   - In Options API script: `this.$t('workdetails.tags')`. In `data()` return
     values that are labels, you usually want computed properties or inline
     `$t` in the template instead — prefer template binding.
   - Dynamic strings built with template literals: keep the structure, wrap the
     literal parts.
3. Do NOT translate: `console.log` messages, code identifiers, API field names,
   CSS classes, route names, comments, `name:` component registration.
4. Quasar component props that take arrays of `{label, value}` (e.g. `:options`):
     build the options array from `$t` values in a computed property so it
     re-renders on locale change.
5. Pluralization / interpolation: use `$t('key', { count: n })` with
   `{count}` placeholder in the message; keep it simple.
6. Add the keys you used to your scope's three partial files.

## After editing
- Run `npm test` (ESLint) in `frontend/` — must pass.
- Do NOT run `npm run build` yourself (heavy); the parent verifies all locales bundle.

## tag name display (tag chips)
Anywhere a tag NAME is shown read-only (`{{ tag.name }}`), replace with
`{{ $tTag(tag.name) }}`. This is the dynamic tag layer, NOT `$t`. The helper
falls back to the Japanese name when no translation exists.
Sites: WorkDetails.vue tag chips, OldWorkCard.vue tag chips, WorkCard.vue /
CoverSFW.vue tag tooltip, List.vue tag column.
In EditMetadata.vue (the editor), keep `tag.name` canonical for storage but show
the translated label in the option list (see EditMetadata section below).