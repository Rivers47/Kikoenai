// Preseed frontend/src/i18n/tags/{zh-CN,en-US,zh-TW}.json from DLsite's localized
// genre lists. REQUIRES YOUR PROXY (127.0.0.1:1080 via config/config.json — the
// same proxy build-tag-aliases.js uses).
//
// Fetches the maniax (doujin R18) genre list in 4 locales, extracts
// genre id -> localized name for each, and joins to the canonical Japanese key:
//   - ids present in old_tag_id.sqlite3  -> key = OLD ja name (matches existing
//     DB rows; for renamed tags this is the canonical old name)
//   - ids only on the current genre list (added since your backup) -> key =
//     CURRENT ja name (canonical for future rows, since no rename applies)
//
// Shadow tags DLsite delisted from the genre list (レイプ, 調教, 奴隷, …) are NOT
// seeded — fill those by hand in the JSON files. That's the known gap.
//
// Re-runnable: MERGES with existing entries so hand-edits survive. New genres
// are added; removed genres stay (harmless — unused keys are ignored). Delete
// the JSON file to regenerate from scratch.
//
//   cd backend && node scripts/build-tag-translations.js

const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const axios = require('../scraper/axios'); // proxy-aware, with retry

const FLOOR = 'maniax'; // doujin R18 — matches the scraper. Alt: 'pro' (commercial games, same genre ids, different listed subset)
const GENRE_LIST = (locale) =>
  `https://www.dlsite.com/${FLOOR}/genre/list` + (locale ? `?locale=${locale}` : '');

const OLD_DB = path.join(__dirname, '..', 'database', 'old_tag_id.sqlite3');
const TAGS_DIR = path.join(__dirname, '..', '..', 'frontend', 'src', 'i18n', 'tags');

// Strip leading ranking digits ("7悪堕ち" -> "悪堕ち") and trailing work counts
// ("ASMR(44,024)" -> "ASMR") from the hot-keywords sidebar links.
function cleanGenreName(raw) {
  let name = raw.replace(/^\d+/, '').trim();
  name = name.replace(/\(\d[\d,]*\)$/, '').trim();
  return name;
}

function getOldIdToName() {
  const rows = execSync(`sqlite3 "${OLD_DB}" "SELECT id, name FROM t_tag;"`, { encoding: 'utf8' });
  const map = new Map();
  for (const line of rows.trim().split('\n')) {
    if (!line) continue;
    const [id, ...nameParts] = line.split('|');
    map.set(parseInt(id, 10), nameParts.join('|').trim());
  }
  return map;
}

// Per-genre search page title: 「<localized genre name>」<localized works-list text>.
// The genre name between the corner brackets localizes with ?locale=. Works
// for shadow tags that the genre-list page delists (レイプ, 調教, …) since the
// search still resolves by genre id.
const SEARCH_URL = (id, locale) =>
  `https://www.dlsite.com/${FLOOR}/fsr/=/genre/${String(id).padStart(3, '0')}/` + (locale ? `?locale=${locale}` : '');

async function getShadowName(id, locale) {
  try {
    const resp = await axios.retryGet(SEARCH_URL(id, locale), { retry: {} });
    // Prefer the <title> tag (「<name>」...); fall back to the first 「...」 in body.
    const m = resp.data.match(/「([^」]+)」/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function getIdToName(locale) {
  const resp = await axios.retryGet(GENRE_LIST(locale), { retry: {} });
  const $ = cheerio.load(resp.data);
  const map = new Map();
  $('a[href*="/genre/"]').each(function () {
    const href = $(this).attr('href') || '';
    const m = href.match(/\/genre\/(\d{3})(?:\/|$)/);
    if (!m) return;
    const id = parseInt(m[1], 10);
    const rawName = $(this).text().trim();
    const name = cleanGenreName(rawName);
    if (!name) return;
    // Prefer clean names over polluted ones (ranking-digit/work-count siblings).
    const existing = map.get(id);
    if (existing === undefined) map.set(id, name);
    else if (name !== existing && !/^\d/.test(name) && !/\(\d/.test(name)) {
      if (/^\d/.test(existing) || /\(\d/.test(existing)) map.set(id, name);
    }
  });
  return map;
}

function loadExisting(file) {
  const p = path.join(TAGS_DIR, file);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) || {}; } catch { return {}; }
}

function writeJson(file, obj) {
  fs.writeFileSync(path.join(TAGS_DIR, file), JSON.stringify(obj, null, 2) + '\n');
}

(async () => {
  console.log('Fetching DLsite genre lists (needs proxy)...');
  const [jaMap, zhCNMap, enUSMap, zhTWMap] = await Promise.all([
    getIdToName(null),        // default ja
    getIdToName('zh_CN'),
    getIdToName('en_US'),
    getIdToName('zh_TW'),
  ]);
  console.log(`  ja=${jaMap.size} zh_CN=${zhCNMap.size} en_US=${enUSMap.size} zh_TW=${zhTWMap.size}`);

  const oldMap = getOldIdToName();
  console.log(`  old DB=${oldMap.size}`);

  // Build canonical-key -> id. For old-DB ids use the old name (canonical).
  // For new ids (listed but not in old DB) use the current ja name (canonical
  // for future rows — no rename map entry applies).
  const keyToId = new Map();
  for (const [id, oldName] of oldMap) {
    if (jaMap.has(id)) keyToId.set(oldName, id); // only if still on the list
  }
  for (const [id, jaName] of jaMap) {
    if (!oldMap.has(id)) keyToId.set(jaName, id); // genuinely new genre
  }

  // Skip entries where the localized name equals the key (kanji overlap with
  // ja/zh — no point storing identity; falls back to the key anyway).
  function buildMap(locMap) {
    const out = {};
    for (const [key, id] of keyToId) {
      const val = locMap.get(id);
      if (val && val !== key) out[key] = val;
    }
    return out;
  }

  // Merge: preserve existing manual entries, add new seeded ones.
  function merge(file, seeded) {
    const existing = loadExisting(file);
    let added = 0, kept = 0;
    for (const [k, v] of Object.entries(seeded)) {
      if (!(k in existing)) { existing[k] = v; added++; }
      else kept++;
    }
    writeJson(file, existing);
    console.log(`  ${file}: ${added} seeded, ${kept} existing preserved, ${Object.keys(existing).length} total`);
    return existing;
  }

  console.log('\nWriting translation maps...');
  merge('zh-CN.json', buildMap(zhCNMap));
  merge('en-US.json', buildMap(enUSMap));
  merge('zh-TW.json', buildMap(zhTWMap));

  // Shadow tags: old-DB ids not on the genre list. Fetch their localized
  // names from the per-genre search page (?locale=) and merge those too.
  const shadowIds = [...oldMap.entries()].filter(([id]) => !jaMap.has(id));
  if (shadowIds.length) {
    console.log(`\nFetching ${shadowIds.length} shadow tags via per-genre search pages...`);
    const shadowSeeded = { 'zh-CN': {}, 'en-US': {}, 'zh-TW': {} };
    let got = 0;
    for (let i = 0; i < shadowIds.length; i++) {
      const [id, oldName] = shadowIds[i];
      const [zh, en, tw] = await Promise.all([
        getShadowName(id, 'zh_CN'),
        getShadowName(id, 'en_US'),
        getShadowName(id, 'zh_TW'),
      ]);
      let any = false;
      if (zh && zh !== oldName) { shadowSeeded['zh-CN'][oldName] = zh; any = true; }
      if (en && en !== oldName) { shadowSeeded['en-US'][oldName] = en; any = true; }
      if (tw && tw !== oldName) { shadowSeeded['zh-TW'][oldName] = tw; any = true; }
      if (any) got++;
      console.log(`  [${i + 1}/${shadowIds.length}] id=${id}  ${oldName}  -> zh="${zh || '-'}" en="${en || '-'}" tw="${tw || '-'}"`);
      await new Promise(r => setTimeout(r, 250));
    }
    console.log(`\n  shadow tags localized: ${got}/${shadowIds.length}`);
    merge('zh-CN.json', shadowSeeded['zh-CN']);
    merge('en-US.json', shadowSeeded['en-US']);
    merge('zh-TW.json', shadowSeeded['zh-TW']);

    // Still-unseeded shadow tags (search page gave nothing) — fill by hand.
    const stillMissing = shadowIds.filter(([id, oldName]) =>
      !shadowSeeded['en-US'][oldName] && !shadowSeeded['zh-CN'][oldName] && !shadowSeeded['zh-TW'][oldName]);
    if (stillMissing.length) {
      console.log(`\nStill NOT seeded (no localized search title) — fill by hand: ${stillMissing.length}`);
      for (const [id, name] of stillMissing) console.log(`  ${id} ${name}`);
    }
  }
  console.log('\nDone.');
})().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});