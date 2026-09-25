/* eslint-disable n/no-unpublished-require */
// Transcribing a work through an external ASR server. Three things here would
// break silently rather than loudly, so they get pinned:
//
//   - the upload must carry a Content-Length. A stream body is chunked by
//     default and the reference server rejects that outright, which is why the
//     client uses undici's request() rather than fetch().
//   - the response Content-Type decides the extension, and anything that is
//     not a subtitle has to be refused. Without that check a forgotten
//     `format=` writes a JSON document into a .srt and nothing notices until
//     someone opens the file.
//   - a subtitle sitting in the overlay folder has to appear in the work's
//     listing exactly as if it were in the work folder.

process.env.FREEZE_CONFIG_FILE = '1';

const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const knexLib = require('knex');
const { MockAgent, setGlobalDispatcher, getGlobalDispatcher } = require('undici');

const { config } = require('../config');
const { makeQueries } = require('../database/queries');
const { listWorkTracks, indexWorkFiles } = require('../filesystem/workFiles');
const { findLyricTracks } = require('../routes/utils/lyrics');
const { addWorkFileSchema } = require('./helpers/schema');
const { transcribe, AsrError } = require('../asr');
const { writeSidecar, transcribeWork } = require('../transcribe-work');

const ASR_ORIGIN = 'http://127.0.0.1:8000';

describe('ASR client', () => {
  let realDispatcher, mockAgent, pool, seen;

  // undici's own mock dispatcher rather than a stub HTTP server: it needs no
  // socket, so the suite stays runnable where loopback is closed off, and the
  // interceptor sees the request options directly.
  const serve = (status, contentType, body, query = 'format=vtt') => {
    seen = null;
    pool.intercept({ path: `/transcribe?${query}`, method: 'POST' })
      .reply(status, (opts) => { seen = opts; return body; },
        contentType ? { headers: { 'content-type': contentType } } : {});
  };

  before(() => {
    realDispatcher = getGlobalDispatcher();
    process.env.KIKO_ASR_BASE_URL = ASR_ORIGIN;
  });

  after(() => {
    setGlobalDispatcher(realDispatcher);
    delete process.env.KIKO_ASR_BASE_URL;
    delete process.env.KIKO_ASR_QUERY;
  });

  let dir, audio;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
    pool = mockAgent.get(ASR_ORIGIN);

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-asr-'));
    audio = path.join(dir, '01 Track.mp3');
    fs.writeFileSync(audio, 'not really audio');
  });

  afterEach(async () => {
    await mockAgent.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('declares the file size up front and names its container', async () => {
    serve(200, 'application/x-subrip; charset=utf-8', '1\n00:00:00,000 --> 00:00:01,000\nはい\n');

    const result = await transcribe(audio);

    expect(result).to.deep.equal({
      ext: '.srt',
      body: '1\n00:00:00,000 --> 00:00:01,000\nはい\n',
    });
    // Content-Length is the header the reference server requires, and a stream
    // body would otherwise go out chunked and be refused. Its value is the
    // real file size, i.e. it was stat'd rather than guessed.
    expect(seen.headers['content-length']).to.equal(String(fs.statSync(audio).size));
    // Streamed, not buffered: a lossless track is comfortably over a gigabyte.
    expect(typeof seen.body.pipe).to.equal('function');
    // Only the extension matters on the far side, and the real filename would
    // put non-ASCII bytes in a header for no gain.
    expect(seen.headers['x-filename']).to.equal('x.mp3');
  });

  it('passes the configured query string through untouched', async () => {
    process.env.KIKO_ASR_QUERY = 'format=vtt&hotwords=%E6%9F%9A%E5%A7%AB&beam_size=5';
    serve(200, 'text/vtt; charset=utf-8', 'WEBVTT\n\n00:00.000 --> 00:01.000\nはい\n',
      'format=vtt&hotwords=%E6%9F%9A%E5%A7%AB&beam_size=5');

    expect((await transcribe(audio)).ext).to.equal('.vtt');
    delete process.env.KIKO_ASR_QUERY;
  });

  // The reference server defaults to JSON, which is unusable here, so an
  // unconfigured install would otherwise fail on its very first run. WebVTT
  // rather than SubRip because it is the only one of the three that can name a
  // speaker -- see the asrConfig comment.
  it('defaults to asking for WebVTT', async () => {
    serve(200, 'application/x-subrip', 'x');
    await transcribe(audio);
    expect(seen.path).to.equal('/transcribe?format=vtt');
  });

  it('sends no query string when one is configured empty', async () => {
    process.env.KIKO_ASR_QUERY = '';
    pool.intercept({ path: '/transcribe', method: 'POST' })
      .reply(200, (opts) => { seen = opts; return 'x'; },
        { headers: { 'content-type': 'application/x-subrip' } });

    await transcribe(audio);
    expect(seen.path).to.equal('/transcribe');
    delete process.env.KIKO_ASR_QUERY;
  });

  // The dialog takes a query string typed by a human, so the escaping is the
  // app's job, not theirs -- and it is merged onto the configured value rather
  // than replacing it, or adding hotwords to one work would drop format=vtt
  // and every track would fail on the content-type check.
  describe('a per-run query override', () => {
    const sent = async (query, expected) => {
      pool.intercept({ path: `/transcribe?${expected}`, method: 'POST' })
        .reply(200, 'x', { headers: { 'content-type': 'application/x-subrip' } });
      await transcribe(audio, { query });
    };

    it('keeps the configured keys alongside the new one', async () => {
      await sent('hotwords=柚姫,父さま',
        'format=vtt&hotwords=%E6%9F%9A%E5%A7%AB%2C%E7%88%B6%E3%81%95%E3%81%BE');
    });

    it('lets an overridden key win outright', async () => {
      await sent('format=vtt', 'format=vtt');
    });

    it('leaves the configured value alone when blank', async () => {
      await sent('', 'format=vtt');
    });

    it('encodes a literal space', async () => {
      await sent('hotwords=a b', 'format=vtt&hotwords=a+b');
    });

    // The one that silently loses data: everything after '#' would otherwise
    // be parsed as a fragment and never leave the client.
    it('encodes "#" instead of truncating the query there', async () => {
      await sent('hotwords=a#b&beam_size=5', 'format=vtt&hotwords=a%23b&beam_size=5');
    });

    it('tolerates a pasted leading "?"', async () => {
      await sent('?beam_size=5', 'format=vtt&beam_size=5');
    });

    it('keeps a repeated key repeated', async () => {
      await sent('lang=ja&lang=en', 'format=vtt&lang=ja&lang=en');
    });
  });

  it('sends a bearer token when one is configured', async () => {
    process.env.KIKO_ASR_API_KEY = 'sekrit';
    serve(200, 'application/x-subrip', 'x');
    await transcribe(audio);
    expect(seen.headers.authorization).to.equal('Bearer sekrit');
    delete process.env.KIKO_ASR_API_KEY;
  });

  // The reference server sends text/plain for both `format=lrc` and
  // `format=txt`, so the header cannot say which it is. .txt is the honest
  // reading; it is saved but will not be picked up as lyrics.
  it('saves a text/plain answer as .txt', async () => {
    serve(200, 'text/plain; charset=utf-8', '[00:00.00]はい\n');
    expect((await transcribe(audio)).ext).to.equal('.txt');
  });

  it('refuses a JSON answer and names the fix', async () => {
    serve(200, 'application/json', '{"text":"はい"}');
    try {
      await transcribe(audio);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(AsrError);
      expect(err.message).to.include('application/json');
      expect(err.message).to.include('format=vtt');
    }
  });

  it('refuses an answer that is not a subtitle at all', async () => {
    serve(200, 'application/octet-stream', 'nonsense');
    try {
      await transcribe(audio);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(AsrError);
      expect(err.message).to.include('application/octet-stream');
    }
  });

  it('reports a server error with its body', async () => {
    serve(503, 'text/plain', 'queue is full');
    try {
      await transcribe(audio);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(AsrError);
      expect(err.message).to.include('503');
      expect(err.message).to.include('queue is full');
    }
  });

  // A silent track. Writing the empty sidecar would make it look done and
  // block a retry after the VAD settings are fixed.
  it('returns null for an empty transcript rather than writing nothing', async () => {
    serve(200, 'application/x-subrip', '\n  \n');
    expect(await transcribe(audio)).to.equal(null);
  });

  // The two ways a request stops early. transcribe-work.js tells them apart by
  // name -- a cancel ends the run, a timeout fails one track -- so the shapes
  // matter, not just that something threw.
  it('propagates a caller cancel as an AbortError', async () => {
    pool.intercept({ path: '/transcribe?format=vtt', method: 'POST' })
      .reply(200, 'x', { headers: { 'content-type': 'application/x-subrip' } })
      .delay(5000);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    try {
      await transcribe(audio, { signal: controller.signal });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.name).to.equal('AbortError');
      // Not an AsrError: the run was stopped, nothing went wrong.
      expect(err).to.not.be.instanceOf(AsrError);
    }
  });

  it('reports its own timeout as a fixable configuration problem', async () => {
    process.env.KIKO_ASR_TIMEOUT_MS = '50';
    pool.intercept({ path: '/transcribe?format=vtt', method: 'POST' })
      .reply(200, 'x', { headers: { 'content-type': 'application/x-subrip' } })
      .delay(5000);

    try {
      await transcribe(audio);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(AsrError);
      expect(err.message).to.include('KIKO_ASR_TIMEOUT_MS');
    } finally {
      delete process.env.KIKO_ASR_TIMEOUT_MS;
    }
  });

  it('surfaces a transport failure instead of a bare "fetch failed"', async () => {
    // Nothing intercepts this origin and net connects are off, so the request
    // fails the way an unreachable ASR server would.
    process.env.KIKO_ASR_BASE_URL = 'http://127.0.0.1:9';
    try {
      await transcribe(audio);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(AsrError);
      expect(err.message).to.include('ASR request failed');
    } finally {
      process.env.KIKO_ASR_BASE_URL = ASR_ORIGIN;
    }
  });
});

describe('subtitle overlay', () => {
  let knex, dbApi, root, workDir, lyricDir, savedLyricDir;

  const write = (base, relPath) => {
    const full = path.join(base, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'x');
  };

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-overlay-'));
    workDir = path.join(root, 'w1');
    lyricDir = path.join(root, 'lyrics');
    fs.mkdirSync(workDir);

    savedLyricDir = config.lyricFolderDir;
    config.lyricFolderDir = lyricDir;

    knex = knexLib({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await knex.schema.createTable('t_work', (t) => {
      t.string('id').primary(); t.string('root_folder'); t.string('dir');
    });
    await addWorkFileSchema(knex);
    await knex('t_work').insert({ id: '000001', root_folder: 'root', dir: 'w1' });
    dbApi = { knex, ...makeQueries(knex) };
  });

  afterEach(async () => {
    config.lyricFolderDir = savedLyricDir;
    await knex.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists an overlay subtitle as though it sat beside the audio', async () => {
    write(workDir, '01 Track.mp3');
    write(lyricDir, '000001/01 Track.srt');

    const tracks = await indexWorkFiles('000001', workDir, undefined, dbApi);

    expect(tracks.map(t => t.shortFilePath)).to.deep.equal(['01 Track.mp3', '01 Track.srt']);
    // Which is the whole point: lyric discovery needs no knowledge of the
    // overlay, because by the time it runs there is only one listing.
    expect(findLyricTracks(tracks[0], tracks)).to.deep.equal([
      { trackId: '000001/01 Track.srt', lyricExtension: '.srt' },
    ]);
  });

  it('keeps a subfolder overlay in its subfolder', async () => {
    write(workDir, 'CD1/01 Track.mp3');
    write(lyricDir, '000001/CD1/01 Track.srt');

    const tracks = await indexWorkFiles('000001', workDir, undefined, dbApi);

    expect(tracks.map(t => t.shortFilePath)).to.deep.equal(['CD1/01 Track.mp3', 'CD1/01 Track.srt']);
    expect(tracks[1].subtitle).to.equal('CD1');
  });

  // rel_path is the primary key, so a file in both places has to collapse to
  // one row. The library wins: a sidecar the user put there by hand should
  // beat a generated one left over from when the mount was read-only.
  it('lets the library copy win over an overlay of the same name', async () => {
    write(workDir, '01 Track.mp3');
    fs.writeFileSync(path.join(workDir, '01 Track.srt'), 'from the library');
    write(lyricDir, '000001/01 Track.srt');

    const tracks = await indexWorkFiles('000001', workDir, undefined, dbApi);

    expect(tracks.filter(t => t.ext === '.srt')).to.have.lengthOf(1);
  });

  it('reads back from the database without walking either folder again', async () => {
    write(workDir, '01 Track.mp3');
    write(lyricDir, '000001/01 Track.srt');
    await indexWorkFiles('000001', workDir, undefined, dbApi);

    // Both folders gone; the listing is a database read by now.
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(lyricDir, { recursive: true, force: true });

    const tracks = await listWorkTracks('000001', workDir, { indexedAt: 'now', dbApi });
    expect(tracks.map(t => t.shortFilePath)).to.deep.equal(['01 Track.mp3', '01 Track.srt']);
  });

  it('leaves a work with no overlay folder alone', async () => {
    write(workDir, '01 Track.mp3');
    const tracks = await indexWorkFiles('000001', workDir, undefined, dbApi);
    expect(tracks.map(t => t.shortFilePath)).to.deep.equal(['01 Track.mp3']);
  });
});

describe('writeSidecar', () => {
  let root, workDir, lyricDir, savedLyricDir;

  const track = (relPath) => {
    const slash = relPath.lastIndexOf('/');
    return {
      title: slash === -1 ? relPath : relPath.substring(slash + 1),
      subtitle: slash === -1 ? null : relPath.substring(0, slash),
      shortFilePath: relPath,
    };
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-write-'));
    workDir = path.join(root, 'w1');
    lyricDir = path.join(root, 'lyrics');
    fs.mkdirSync(workDir);
    savedLyricDir = config.lyricFolderDir;
    config.lyricFolderDir = lyricDir;
  });

  afterEach(() => {
    config.lyricFolderDir = savedLyricDir;
    fs.chmodSync(workDir, 0o755);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes beside the audio when the library folder takes it', async () => {
    const result = await writeSidecar('000001', workDir, track('01 Track.mp3'), '.srt', 'subtitle');

    expect(result).to.deep.equal({ relPath: '01 Track.srt', overlay: false });
    expect(fs.readFileSync(path.join(workDir, '01 Track.srt'), 'utf8')).to.equal('subtitle');
    expect(fs.existsSync(lyricDir)).to.equal(false);
  });

  it('keeps a subfolder track in its subfolder', async () => {
    fs.mkdirSync(path.join(workDir, 'CD1'));
    const result = await writeSidecar('000001', workDir, track('CD1/01 Track.mp3'), '.vtt', 'subtitle');

    expect(result).to.deep.equal({ relPath: 'CD1/01 Track.vtt', overlay: false });
    expect(fs.existsSync(path.join(workDir, 'CD1/01 Track.vtt'))).to.equal(true);
  });

  // The whole reason the overlay exists: a library mounted read-only must not
  // make transcription fail, it must make it land somewhere else.
  it('falls back to the overlay when the library folder refuses the write', async function () {
    fs.chmodSync(workDir, 0o555);
    // Root ignores the mode bits, so on a root test runner this proves
    // nothing -- the real read-only case there is EROFS, which needs a mount.
    try {
      fs.writeFileSync(path.join(workDir, '.probe'), 'x');
      fs.unlinkSync(path.join(workDir, '.probe'));
      this.skip();
    } catch { /* good: the folder really is unwritable */ }

    const result = await writeSidecar('000001', workDir, track('01 Track.mp3'), '.srt', 'subtitle');

    expect(result).to.deep.equal({ relPath: '01 Track.srt', overlay: true });
    expect(fs.readFileSync(path.join(lyricDir, '000001/01 Track.srt'), 'utf8')).to.equal('subtitle');
  });

  it('leaves no temp file behind', async () => {
    await writeSidecar('000001', workDir, track('01 Track.mp3'), '.srt', 'subtitle');
    expect(fs.readdirSync(workDir)).to.deep.equal(['01 Track.srt']);
  });
});

// The whole loop, with an in-memory database and a mocked ASR server. The
// selection is the part worth pinning: the dialog sends relPaths, and sending
// the wrong ones means transcribing hours of audio nobody asked for.
describe('transcribeWork', () => {
  let knex, dbApi, mockAgent, realDispatcher, pool, root, workDir, savedLyricDir, savedRootFolders;

  const write = (relPath, body = 'x') => {
    const full = path.join(workDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };

  const reply = (times) => {
    pool.intercept({ path: '/transcribe?format=vtt', method: 'POST' })
      .reply(200, '1\n00:00:00,000 --> 00:00:01,000\nはい\n',
        { headers: { 'content-type': 'application/x-subrip' } })
      .times(times);
  };

  before(() => {
    realDispatcher = getGlobalDispatcher();
    process.env.KIKO_ASR_BASE_URL = ASR_ORIGIN;
  });

  after(() => {
    setGlobalDispatcher(realDispatcher);
    delete process.env.KIKO_ASR_BASE_URL;
  });

  beforeEach(async () => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
    pool = mockAgent.get(ASR_ORIGIN);

    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-tw-'));
    workDir = path.join(root, 'w1');
    fs.mkdirSync(workDir);

    savedLyricDir = config.lyricFolderDir;
    savedRootFolders = config.rootFolders;
    config.lyricFolderDir = path.join(root, 'lyrics');
    config.rootFolders = [{ name: 'root', path: root }];

    knex = knexLib({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await knex.schema.createTable('t_work', (t) => {
      t.string('id').primary(); t.string('root_folder'); t.string('dir');
    });
    await addWorkFileSchema(knex);
    await knex('t_work').insert({ id: '000001', root_folder: 'root', dir: 'w1' });
    dbApi = { knex, ...makeQueries(knex) };
  });

  afterEach(async () => {
    config.lyricFolderDir = savedLyricDir;
    config.rootFolders = savedRootFolders;
    await mockAgent.close();
    await knex.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('transcribes only the selected tracks', async () => {
    write('01.mp3'); write('02.mp3'); write('03.mp3');
    reply(1);

    const tally = await transcribeWork('000001', { only: ['02.mp3'], dbApi });

    expect(tally.written).to.equal(1);
    expect(fs.existsSync(path.join(workDir, '02.srt'))).to.equal(true);
    expect(fs.existsSync(path.join(workDir, '01.srt'))).to.equal(false);
    expect(fs.existsSync(path.join(workDir, '03.srt'))).to.equal(false);
  });

  it('transcribes everything when no selection is given', async () => {
    write('01.mp3'); write('02.mp3');
    reply(2);

    const tally = await transcribeWork('000001', { dbApi });
    expect(tally.written).to.equal(2);
  });

  it('skips a track that already has a subtitle', async () => {
    write('01.mp3'); write('01.srt', 'mine');
    write('02.mp3');
    reply(1);

    const tally = await transcribeWork('000001', { dbApi });

    expect(tally).to.include({ written: 1, skipped: 1 });
    // Not overwritten -- a hand-made sidecar is never replaced.
    expect(fs.readFileSync(path.join(workDir, '01.srt'), 'utf8')).to.equal('mine');
  });

  it('makes the new subtitle visible in the work listing', async () => {
    write('01.mp3');
    reply(1);
    await transcribeWork('000001', { dbApi });

    const rows = await dbApi.getWorkFiles('000001');
    expect(rows.map(r => r.rel_path).sort()).to.deep.equal(['01.mp3', '01.srt']);
  });

  // A stale dialog listing files a rescan has since renamed. Distinct from
  // "this work has no audio", which is a different thing to tell the admin.
  it('reports a selection that matches nothing', async () => {
    write('01.mp3');
    try {
      await transcribeWork('000001', { only: ['gone.mp3'], dbApi });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(AsrError);
      expect(err.message).to.include('不存在');
    }
  });
});
