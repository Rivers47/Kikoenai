import axios from "axios";
import { apiUrl } from './base-path';
// Single implementation of the search grammar — see FilterTerms.vue.
import { formatSearchTerm } from '../../backend/database/search-query';

/**
 * Work ids are canonical everywhere in the app: DLsite ids are zero-padded
 * digits, Fanza ids are `d` + digits (`d215444`). Fanza's own underscore form
 * (`d_215444`) is only used when addressing DMM itself — see backend
 * `work-id.js`, which owns the same two helpers.
 */
export function isFanzaId(id) {
  return /^d_?\d+$/i.test(String(id));
}

/** `d215444` → `d_215444`, the content id DMM's own URLs take. */
export function fanzaCid(id) {
  return String(id).replace(/^d(\d+)$/i, 'd_$1');
}

/**
 * 格式化 id，适配 8 位、6 位 id
 * @param {number} id
 * @return {string}
 */
export function formatID(id) {
  if (typeof id === 'string') return id; // already in final form ('123456', '01134567', 'd215444')
  if (id >= 1000000) {
    // 大于 7 位数，则补全为 8 位
    id = `0${id}`.slice(-8);
  } else {
    // 否则补全为 6 位
    id = `000000${id}`.slice(-6);
  }

  return id;
}

export function formatSeconds(seconds) {
  let h = Math.floor(seconds / 3600) < 10
    ? '0' + Math.floor(seconds / 3600)
    : Math.floor(seconds / 3600)

  let m = Math.floor((seconds / 60 % 60)) < 10
    ? '0' + Math.floor((seconds / 60 % 60))
    : Math.floor((seconds / 60 % 60))

  let s = Math.floor((seconds % 60)) < 10
    ? '0' + Math.floor((seconds % 60))
    : Math.floor((seconds % 60))

  return h === "00"
    ? m + ":" + s
    : h + ":" + m + ":" + s
}

// 解决字符串到正则当中的问题
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

export function basenameWithoutExt(string) {
  const extIdx = string.lastIndexOf('.');
  return extIdx >= 0 ? string.substr(0, extIdx) : string;
}

export function extname(string) {
  const extIdx = string.lastIndexOf('.');
  return extIdx >= 0 ? string.substr(extIdx) : "";
}

/**
 * Narrows a backend track node down to the fields the player and the play
 * history actually read.
 *
 * The whole queue is serialized into every PUT /api/history body, so anything
 * carried here is re-uploaded on every sync. The dropped fields are all either
 * unused on queue items or derivable: `type` (the queue is audio-only by
 * construction), `relPath` (only used to merge memo hashes onto tree nodes in
 * Work.vue), and `mediaDownloadUrl` (only used by WorkTree's download button,
 * which reads the tree node, not the queue).
 *
 * `mediaStreamUrl` is kept only when it is NOT the derivable default -- i.e.
 * when config.offloadMedia points it at a different host. Carrying the default
 * is actively harmful: AudioElement's `source` computed tests mediaStreamUrl
 * first, so a present-but-default value shadows the downloaded-copy branch and
 * a downloaded track streams instead of playing from Cache Storage.
 */
export function toQueueItem(node) {
  const trackId = node.trackId || node.hash;
  const item = {
    trackId,
    contentHash: node.contentHash,
    title: node.title,
    duration: node.duration,
    workTitle: node.workTitle,
  };
  if (node.mediaStreamUrl && node.mediaStreamUrl !== apiUrl(`/api/media/stream/${trackId}`)) {
    item.mediaStreamUrl = node.mediaStreamUrl;
  }
  return item;
}



/**
 * Route to every work carrying a label. There is one filter mechanism, so a
 * label link is an anchored term rather than an id lookup — which is what lets
 * the result be narrowed further instead of replaced.
 *
 * `field` is a search namespace (tag, va, circle, illustrator, script_writer,
 * series) and `name` the canonical name, not a translated display string.
 */
export function labelRoute(field, name) {
  return { path: '/works', query: { keyword: formatSearchTerm({ field, value: name, exact: true }) } };
}
