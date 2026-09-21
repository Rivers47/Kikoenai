/*
 * Read a work's track list out of its scraped description.
 *
 * Orchestration only: it pulls the work, its files and its description
 * together and hands them to the pure pipeline in track-titles.js, which knows
 * nothing about the database. Keeping that split is what lets
 * test/track-titles.js exercise the prompt and the verbatim guard with no
 * database at all.
 *
 * Driven over Socket.IO rather than a route (socket.js), because a local model
 * regularly takes longer to answer than a reverse proxy will hold a request
 * open -- nginx's proxy_read_timeout defaults to 60s and Cloudflare caps a
 * request at 100s regardless of the origin. The scanner has the same shape and
 * the same reason; see backend/AGENTS.md §2.5.
 *
 * It proposes and writes nothing. Applying a list is
 * PUT /api/work/:id/file-metadata, which the admin reaches after reviewing it.
 */

const path = require('path');

const db = require('./database/db');
const { config } = require('./config');
const { listWorkTracks } = require('./filesystem/workFiles');
const { isFanzaId } = require('./work-id');
const { WORK_ID_RE, normalizeWorkId } = require('./routes/utils/validate');
const {
  AUDIO_EXT,
  isLlmConfigured,
  htmlToText,
  structuredTitles,
  distinctTrackNames,
  buildHaystack,
  buildPrompt,
  callModel,
  collectTitles,
} = require('./track-titles');

/**
 * A failure the caller is expected to show the user, as opposed to a bug.
 * The message is the whole payload -- socket.js only needs to tell the two
 * apart so it can decide what to log.
 */
class SuggestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SuggestError';
  }
}

/**
 * @param {String} rawWorkId straight from the client -- a socket handler has no
 *   express-validator chain in front of it, so it is checked here.
 * @returns {Promise<{titles: String[], trackCount: Number, source: String, unverified: Number}>}
 *   `titles` is an **ordered list**, not a per-file mapping: placement is the
 *   caller's job, and the dialog fills a chosen folder positionally. It can be
 *   shorter than `trackCount` when the model returned fewer, which is why both
 *   are reported. `unverified` counts titles that were not found in the
 *   description -- reworded or invented -- which the caller should warn about
 *   rather than hide.
 */
async function suggestTrackTitles(rawWorkId) {
  if (typeof rawWorkId !== 'string' || !WORK_ID_RE.test(rawWorkId)) {
    throw new SuggestError(`"${rawWorkId}" 不是有效的作品 id.`);
  }
  const workId = normalizeWorkId(rawWorkId);

  const work = await db.knex('t_work')
    .select('root_folder', 'dir', 'description', 'description_parts')
    .where('id', workId)
    .first();
  if (!work) {
    throw new SuggestError(`没有 id 为 "${workId}" 的作品`);
  }

  const description = htmlToText(work.description);
  if (!description) {
    // Fanza is a dead end rather than a "refresh it" case: scraper/fanza.js
    // extracts no description at all, so POST /api/refresh changes nothing.
    throw new SuggestError(isFanzaId(workId)
      ? 'Fanza 作品没有抓取到简介，无法提取音轨标题（仅支持 DLsite 作品）.'
      : `作品 ${workId} 没有简介，请先刷新元数据.`);
  }

  const rootFolder = config.rootFolders.find(rf => rf.name === work.root_folder);
  if (!rootFolder) {
    throw new SuggestError(`找不到文件夹: "${work.root_folder}"`);
  }

  const tracks = await listWorkTracks(workId, path.join(rootFolder.path, work.dir));
  const audio = tracks.filter(t => AUDIO_EXT.includes(t.ext));
  if (!audio.length) {
    throw new SuggestError(`作品 ${workId} 没有音频文件.`);
  }

  // Distinct names, not files: variant folders repeat the same tracks, and the
  // dialog applies one list per folder anyway.
  const trackNames = distinctTrackNames(audio);
  const parts = work.description_parts ? JSON.parse(work.description_parts) : [];
  const structured = structuredTitles(parts);

  // DLsite published the list itself and it lines up with the tracks on disk --
  // no model call needed.
  if (structured.length && structured.length === trackNames.length) {
    return { titles: structured, trackCount: trackNames.length, source: 'structured', unverified: 0 };
  }

  if (!isLlmConfigured()) {
    throw new SuggestError('服务器未配置 LLM (KIKO_LLM_BASE_URL / KIKO_LLM_MODEL).');
  }

  // mapping:false -- collectTitles places titles by position and never reads a
  // file mapping, so asking for one would only burn output tokens.
  const parsed = await callModel(buildPrompt(description, structured), trackNames, { mapping: false });
  // collectTitles, not validate: this is a proposal the admin reviews, and a
  // title dropped for not being verbatim leaves a gap that shifts every later
  // one onto the wrong file when the list is applied positionally.
  const { titles, unverified } = collectTitles(parsed, buildHaystack(description, parts));

  return { titles, trackCount: trackNames.length, source: 'llm', unverified };
}

module.exports = { suggestTrackTitles, SuggestError };
