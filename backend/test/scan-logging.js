/* eslint-disable n/no-unpublished-require */
// Scan progress reporting: one message per line, a bounded snapshot, and a
// durable copy on disk.

process.env.FREEZE_CONFIG_FILE = '1';

const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const path = require('path');

// The module installs a stub over process.send unless one is already there, so
// the capture has to be in place before it is required.
const sent = [];
const realSend = process.send;
process.send = (message, callback) => {
  sent.push(message);
  if (typeof callback === 'function') callback();
  return true;
};

const { LOG } = require('../filesystem/scannerModules');
const scanLog = require('../filesystem/scanLog');

const eventsOf = name => sent.filter(m => m.event === name);
const initState = () => {
  sent.length = 0;
  process.emit('message', { emit: 'SCAN_INIT_STATE' });
  return eventsOf('SCAN_INIT_STATE')[0].payload;
};

describe('scan progress reporting', function () {
  after(function () {
    if (realSend) process.send = realSend;
    else delete process.send;
  });

  beforeEach(function () {
    sent.length = 0;
  });

  describe('one message per line', function () {
    it('sends a main log line as its own entry, not the whole log', function () {
      LOG.main.info('第一行');
      LOG.main.error('第二行');

      const messages = eventsOf('SCAN_MAIN_LOG');
      expect(messages).to.have.lengthOf(2);
      // The point of the delta: the second message must not carry the first.
      expect(messages[1].payload).to.eql({ entry: { level: 'error', message: '第二行' } });
      expect(eventsOf('SCAN_MAIN_LOGS')).to.be.empty;
    });

    it('sends a task log line as its own entry, not the whole task list', function () {
      LOG.task.add('100001');
      LOG.task.info('100001', '下载图片');

      expect(eventsOf('SCAN_TASK_ADD')[0].payload).to.eql({ rjcode: '100001' });
      expect(eventsOf('SCAN_TASK_LOG')[0].payload).to.eql({
        rjcode: '100001',
        entry: { level: 'info', message: '下载图片' },
      });
      expect(eventsOf('SCAN_TASKS')).to.be.empty;

      LOG.task.remove('100001', 'added');
      expect(eventsOf('SCAN_TASK_REMOVE')[0].payload).to.eql({ rjcode: '100001', result: 'added' });
    });

    it('reports a failed task once, with its logs', function () {
      LOG.task.add('100002');
      LOG.task.error('100002', '抓取失败');
      LOG.task.remove('100002', 'failed');

      const failed = eventsOf('SCAN_FAILED_TASK');
      expect(failed).to.have.lengthOf(1);
      expect(failed[0].payload.task.rjcode).to.equal('100002');
      expect(failed[0].payload.task.logs).to.have.lengthOf(1);
    });

    it('sends a result as its own entry', function () {
      LOG.result.add('100003', 'added', 7);
      expect(eventsOf('SCAN_RESULT')[0].payload).to.eql({
        result: { rjcode: '100003', result: 'added', count: 7 },
      });
      expect(eventsOf('SCAN_RESULTS')).to.be.empty;
    });
  });

  describe('the snapshot stays bounded', function () {
    // SCAN_INIT_STATE is sent on every page load and every reconnect, so it is
    // the one payload that carries accumulated state. A run over a large
    // library emits far more lines than this.
    it('keeps only the tail of the main log', function () {
      for (let i = 0; i < 700; i++) LOG.main.info(`行 ${i}`);

      const { mainLogs } = initState();
      expect(mainLogs).to.have.lengthOf(500);
      expect(mainLogs[mainLogs.length - 1].message).to.equal('行 699');
    });

    it('keeps only the tail of a task\'s own log', function () {
      LOG.task.add('100004');
      for (let i = 0; i < 300; i++) LOG.task.info('100004', `图片 ${i}`);

      const task = initState().tasks.find(task => task.rjcode === '100004');
      expect(task.logs).to.have.lengthOf(200);
      expect(task.logs[task.logs.length - 1].message).to.equal('图片 299');
      LOG.task.remove('100004', 'added');
    });

    it('keeps only the tail of the results', function () {
      for (let i = 0; i < 600; i++) LOG.result.add('100005', 'added', i);
      expect(initState().results).to.have.lengthOf(500);
    });
  });

  describe('the log file', function () {
    // The durable half: a dropped socket loses whatever arrived while it was
    // down, and the page keeps only a capped tail, so this file is the only
    // complete record of a long run.
    let filePath;

    after(function () {
      if (filePath) fs.rmSync(filePath, { force: true });
      fs.rmdirSync(scanLog.LOG_FOLDER_DIR, { recursive: false });
    });

    it('writes every line it is given, with level and work id', function () {
      filePath = scanLog.open('test');
      expect(filePath).to.be.a('string');
      expect(path.dirname(filePath)).to.equal(scanLog.LOG_FOLDER_DIR);

      scanLog.write('info', '共找到 3 个音声文件夹.');
      scanLog.write('warn', '下载失败', 'RJ100006');

      const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
      expect(lines).to.have.lengthOf(2);
      expect(lines[0]).to.match(/^\S+ INFO  共找到 3 个音声文件夹\.$/);
      expect(lines[1]).to.match(/^\S+ WARN  \[RJ100006\] 下载失败$/);
    });

    it('reopening the same run keeps the same file', function () {
      expect(scanLog.open('test')).to.equal(filePath);
    });
  });
});
