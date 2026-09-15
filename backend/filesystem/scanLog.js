// On disk log of scan runs, stored in config/logs

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
    console.error(`Can't open log file: ${err.message}`);
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
