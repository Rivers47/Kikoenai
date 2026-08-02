import axios from "axios";
/**
 * 格式化 id，适配 8 位、6 位 id
 * @param {number} id
 * @return {string}
 */
export function formatID(id) {
  if (typeof id === 'string') return id; // already in final form ('123456', '01134567', 'd_215444')
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


