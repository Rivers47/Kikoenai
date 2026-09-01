// Generates Quasar brand variables and Material theme CSS tokens
// from src/material-theme.json (Material Theme Builder export).
//
// Usage:  npm run theme        (or: node scripts/generate-theme.mjs)
//
// To change the theme: replace src/material-theme.json with a new
// Theme Builder export and re-run this script.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argbFromHex, hexFromArgb, TonalPalette, Blend } from '@material/material-color-utilities';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Optional: path to a theme JSON (defaults to src/material-theme.json)
const themePath = process.argv[2] ?? join(root, 'src/material-theme.json');
const theme = JSON.parse(readFileSync(themePath, 'utf8'));

const { schemes } = theme;
const light = schemes.light;
const dark = schemes.dark;
if (!light || !dark) {
  console.error('material-theme.json must contain "light" and "dark" schemes');
  process.exit(1);
}
// Optional contrast tiers (emitted only if present in the export)
const lightMedium = schemes['light-medium-contrast'];
const lightHigh = schemes['light-high-contrast'];
const darkMedium = schemes['dark-medium-contrast'];
const darkHigh = schemes['dark-high-contrast'];

// Semantic colors (positive/info/warning) have no standard Material role.
// They come from the export's extendedColors if present (tonal roles computed
// with Material's color utilities, honoring each color's harmonized flag);
// otherwise these constants are used as fallback.
const fallback = {
  positive: '#2E7D32',
  info: '#0277BD',
  warning: '#F9A825',
};

// Tones for [color, on-color, container, on-container], per scheme variant.
// The contrast tiers walk the tonal palette in the same direction Material's
// own contrast curves do: darker on light, lighter on dark. Without them a tier
// inherits the base tone while its surfaces move, so "more contrast" produced
// *less* — the light tiers measured 3.8:1 against surface-container-highest,
// below WCAG AA, while the base scheme managed 5.0:1.
const TONES = {
  light: [40, 100, 90, 10],
  lightMedium: [30, 100, 85, 5],
  lightHigh: [20, 100, 80, 0],
  dark: [80, 20, 30, 90],
  darkMedium: [85, 15, 35, 95],
  darkHigh: [90, 10, 40, 100],
};

// name -> per-variant roles, e.g. { positive: { light: { color, on, ... }, ... } }
const extended = {};
for (const c of theme.extendedColors ?? []) {
  const name = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let argb = argbFromHex(c.color);
  if (c.harmonized && theme.seed) argb = Blend.harmonize(argb, argbFromHex(theme.seed));
  const p = TonalPalette.fromInt(argb);
  extended[name] = Object.fromEntries(
    Object.entries(TONES).map(([variant, [color, on, container, onContainer]]) => [
      variant,
      {
        color: hexFromArgb(p.tone(color)),
        on: hexFromArgb(p.tone(on)),
        container: hexFromArgb(p.tone(container)),
        onContainer: hexFromArgb(p.tone(onContainer)),
      },
    ])
  );
}

// Semantic brand color used for $positive/$info/$warning (light scheme).
const semantic = (name) => extended[name]?.light.color ?? fallback[name];

// CSS variables for one extended color, in one scheme variant (a key of TONES).
const extendedVars = (name, variant) => {
  const e = extended[name][variant];
  return [
    `  --${name}: ${e.color};`,
    `  --${name}-rgb: ${hexToRgb(e.color)};`,
    `  --on-${name}: ${e.on};`,
    `  --on-${name}-rgb: ${hexToRgb(e.on)};`,
    `  --${name}-container: ${e.container};`,
    `  --${name}-container-rgb: ${hexToRgb(e.container)};`,
    `  --on-${name}-container: ${e.onContainer};`,
    `  --on-${name}-container-rgb: ${hexToRgb(e.onContainer)};`,
  ];
};

// Extended colors are emitted in every block, contrast tiers included: custom
// properties cascade, so a tier that omitted them would silently keep the base
// scheme's tone against its own, differently-lit surfaces.
const extendedBlock = (variant, indent = '') =>
  Object.keys(extended).length
    ? '\n' + indent + '  // extended colors from extendedColors\n' +
      Object.keys(extended)
        .flatMap((n) => extendedVars(n, variant))
        .map((line) => indent + line)
        .join('\n')
    : '';

// Material roles exposed as CSS custom properties (beyond Quasar's brand colors).
const tokenRoles = [
  ['on-primary', 'onPrimary'],
  ['on-secondary', 'onSecondary'],
  ['on-tertiary', 'onTertiary'],
  ['on-error', 'onError'],
  ['primary-container', 'primaryContainer'],
  ['on-primary-container', 'onPrimaryContainer'],
  ['secondary-container', 'secondaryContainer'],
  ['on-secondary-container', 'onSecondaryContainer'],
  ['tertiary-container', 'tertiaryContainer'],
  ['on-tertiary-container', 'onTertiaryContainer'],
  ['error-container', 'errorContainer'],
  ['on-error-container', 'onErrorContainer'],
  ['surface', 'surface'],
  ['on-surface', 'onSurface'],
  ['on-surface-variant', 'onSurfaceVariant'],
  ['surface-container', 'surfaceContainer'],
  ['surface-container-high', 'surfaceContainerHigh'],
  ['surface-container-highest', 'surfaceContainerHighest'],
  ['outline', 'outline'],
  ['outline-variant', 'outlineVariant'],
  ['inverse-surface', 'inverseSurface'],
  ['inverse-on-surface', 'inverseOnSurface']
];

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

const header = `// GENERATED by scripts/generate-theme.mjs from src/material-theme.json
// Do not edit by hand — replace the JSON and run \`npm run theme\` instead.
// Seed: ${theme.seed ?? 'unknown'}
`;

// --- quasar.variables.scss: light-scheme roles mapped to Quasar brand colors ---
const quasarVars = `${header}
// Light-scheme roles. Dark-scheme overrides live in material-theme.scss
// as CSS custom properties (body.body--dark).
$primary   : ${light.primary};
$secondary : ${light.secondary};
$accent    : ${light.tertiary};

$dark      : ${dark.surface}; // dark-mode page background

$positive  : ${semantic('positive')};
$negative  : ${light.error};
$info      : ${semantic('info')};
$warning   : ${semantic('warning')};
`;

// --- material-theme.scss: extended tokens + dark-mode brand overrides ---
const vars = (scheme, brand) => {
  const lines = [];
  // RGB triplets of brand colors, for alpha variants: rgb(var(--primary-rgb) / 0.5)
  lines.push(
    `  --primary-rgb: ${hexToRgb(scheme.primary)};`,
    `  --secondary-rgb: ${hexToRgb(scheme.secondary)};`,
    `  --accent-rgb: ${hexToRgb(scheme.tertiary)};`,
    `  --negative-rgb: ${hexToRgb(scheme.error)};`,
    ''
  );
  if (brand) {
    lines.push(
      '  // brand colors (Quasar components read these CSS vars)',
      `  --q-primary: ${scheme.primary};`,
      `  --q-secondary: ${scheme.secondary};`,
      `  --q-accent: ${scheme.tertiary};`,
      `  --q-negative: ${scheme.error};`,
      // dark variants of the extended (semantic) colors
      ...['positive', 'info', 'warning']
        .filter((n) => extended[n])
        .map((n) => `  --q-${n}: ${extended[n].dark.color};`),
      ''
    );
  }
  for (const [name, role] of tokenRoles) {
    if (!scheme[role]) throw new Error(`Missing role "${role}" in scheme`);
    // The *-rgb triplet allows alpha variants: rgb(var(--surface-rgb) / 0.5)
    lines.push(`  --${name}: ${scheme[role]};`, `  --${name}-rgb: ${hexToRgb(scheme[role])};`);
  }
  return lines.join('\n');
};

// Contrast tiers need explicit brand overrides too (their primary differs
// from the base scheme's, including in light mode).
let contrastBlocks = '';

// Automatic: follows the OS/browser "increase contrast" accessibility setting.
if (lightHigh || darkHigh) {
  contrastBlocks += `
// High contrast, applied automatically when the user prefers more contrast.
@media (prefers-contrast: more) {
${lightHigh ? `  :root {
${vars(lightHigh, true)}${extendedBlock('lightHigh', '  ')}
  }
` : ''}${darkHigh ? `  body.body--dark {
${vars(darkHigh, true)}${extendedBlock('darkHigh', '  ')}
  }
` : ''}}
`;
}

// Manual: add class="contrast-medium"/"contrast-high" on <body> to force a tier
// (e.g. from an in-app accessibility setting). Placed last so it wins over the
// media query.
for (const [cls, lt, dk, ltVariant, dkVariant] of [
  ['contrast-medium', lightMedium, darkMedium, 'lightMedium', 'darkMedium'],
  ['contrast-high', lightHigh, darkHigh, 'lightHigh', 'darkHigh'],
]) {
  if (!lt && !dk) continue;
  contrastBlocks += `
// Manual ${cls} override.
${lt ? `body.${cls} {
${vars(lt, true)}${extendedBlock(ltVariant)}
}
` : ''}${dk ? `body.body--dark.${cls} {
${vars(dk, true)}${extendedBlock(dkVariant)}
}
` : ''}`;
}

// --- Utility classes for theme tokens ---
// Quasar generates bg-*/text-on-* utilities only for its built-in brand
// colors (primary, secondary, negative, ...). The M3 *-container / on-*
// tokens below have no Quasar equivalent, so we emit the matching utility
// classes here. This keeps `npm run theme` self-contained: replacing the
// theme JSON and re-running produces a complete set of utilities, so a
// container (e.g. error-container) can't be silently dropped the way it
// was when these lived only in hand-maintained app.scss.
//
// Bare `text-on-<role>` for the M3 on-colors (also not all provided by
// Quasar) and surface/on-surface helpers are included for the same reason.
const containerRoles = ['primary', 'secondary', 'tertiary', 'error'];
// Extended (semantic) colors are emitted only when present in extendedColors.
const extendedContainerRoles = ['positive', 'info', 'warning'];
const bareOnRoles = ['primary', 'secondary', 'tertiary', 'error', 'positive', 'info', 'warning'];

const utilities = `${header}
// Utility classes for Material theme tokens, generated alongside the CSS
// variables above. Usable with Quasar color props, e.g.
//   color="primary-container" text-color="on-primary-container"
// Keep these in sync with the variables emitted above; do not hand-edit.

// Container backgrounds + their on-colors
${containerRoles
  .map(
    (r) => `.bg-${r}-container { background: var(--${r}-container) !important; }
.text-on-${r}-container { color: var(--on-${r}-container) !important; }`
  )
  .join('\n')}
${extendedContainerRoles
  .filter((r) => extended[r])
  .map(
    (r) => `.bg-${r}-container { background: var(--${r}-container) !important; }
.text-on-${r}-container { color: var(--on-${r}-container) !important; }`
  )
  .join('\n')}

// Surface container helpers (only highest is used today)
.bg-surface-container-highest { background: var(--surface-container-highest) !important; }

// Bare on-color text helpers (on-<role>); Quasar provides some, but not all M3 roles
${bareOnRoles
  .filter((r) => extended[r] || ['primary', 'secondary', 'tertiary', 'error'].includes(r))
  .map((r) => `.text-on-${r} { color: var(--on-${r}) !important; }`)
  .join('\n')}
.text-on-surface { color: var(--on-surface) !important; }
.text-on-surface-variant { color: var(--on-surface-variant) !important; }
`;

const tokens = `${header}
// Material roles Quasar doesn't have. Use as var(--primary-container) etc.
:root {
${vars(light, false)}${extendedBlock('light')}
}

body.body--dark {
${vars(dark, true)}${extendedBlock('dark')}
}
${contrastBlocks}`;

writeFileSync(join(root, 'src/css/quasar.variables.scss'), quasarVars);
writeFileSync(join(root, 'src/css/material-theme.scss'), tokens);
writeFileSync(join(root, 'src/css/theme-utilities.scss'), utilities);
console.log('Generated src/css/quasar.variables.scss, material-theme.scss and theme-utilities.scss');
