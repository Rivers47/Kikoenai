// Durable, on-disk record of a scan run.
//
// The Scanner page is a live tail, not an archive: what it holds is capped so a
// long run cannot grow its payloads without bound, and a dropped socket loses
// whatever arrived while it was down. The file has neither limit, so it is the
// thing to read when a scan needs explaining after the fact.
//
// Writes go through a plain fd with writeSync: a scan ends in process.exit(),
// which does not drain a WriteStream, and the tail of a long run is exactly the
// part worth keeping. Lines are short and the run is network-bound, so the
// synchronous write costs nothing measurable.

const fs = require('fs');
const path = require('path');

const { dataRoot } = require('../config');

const LOG_FOLDER_DIR = path.join(dataRoot, 'logs');
const KEEP_RUNS = 10;

let fd = null;
let filePath = null;

// Sortable and filename-safe: 2026-09-14T08-30-00
const stamp = () => new Date().toISOString().slice(0, 19).replace(/:/g, '-');

/**
 * Deletes all but the most recent KEEP_RUNS logs, so an install that scans
 * nightly does not accumulate them forever.
 */
function pruneOldLogs() {
  try {
    const logs = fs.readdirSync(LOG_FOLDER_DIR)
      .filter(name => /^scan-.*\.log$/.test(name))
      .sort();
    for (const name of logs.slice(0, -KEEP_RUNS)) {
      fs.unlinkSync(path.join(LOG_FOLDER_DIR, name));
    }
  } catch { /* pruning is housekeeping; never fail a scan over it */ }
}

/**
 * Opens the log file for this run.
 * @param {String} runName Short name of the run, e.g. 'scan' or 'files'.
 * @returns {String|null} The log's path, or null if it could not be opened.
 */
function open(runName) {
  if (fd !== null) return filePath;
  try {
    fs.mkdirSync(LOG_FOLDER_DIR, { recursive: true });
    pruneOldLogs();
    filePath = path.join(LOG_FOLDER_DIR, `scan-${stamp()}-${runName}.log`);
    fd = fs.openSync(filePath, 'a');
  } catch (err) {
    // A read-only or missing data root must not stop the scan itself.
    console.error(`无法创建扫描日志文件: ${err.message}`);
    fd = null;
    filePath = null;
  }
  return filePath;
}

/**
 * Appends one line. No-op when the file could not be opened.
 * @param {String} level Log level, e.g. 'info'.
 * @param {String} message The message.
 * @param {String} [taskId] Work the message belongs to, if any.
 */
function write(level, message, taskId) {
  if (fd === null) return;
  const prefix = taskId ? `[${taskId}] ` : '';
  try {
    fs.writeSync(fd, `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${prefix}${message}\n`);
  } catch { /* a full or unlinked disk must not stop the scan */ }
}

module.exports = { open, write, LOG_FOLDER_DIR };
