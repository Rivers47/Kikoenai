const path = require('path');
const express = require('express');
const router = express.Router();
const { param, query, body } = require('express-validator');
const db = require('../database/db');
const { getTrackList, toTree, scrapeWorkHashes } = require('../filesystem/utils');
const { config } = require('../config');
const normalize = require('./utils/normalize');
const { isValidRequest, workIdParam } = require('./utils/validate');
const { formatID, scrapeWorkMemo, coverFileName } = require('../filesystem/utils');
const { scrapeWorkMetadataFromDLsite } = require('../scraper/dlsite');
const { scrapeWorkMetadataFromFanza } = require('../scraper/fanza');

// Covers come from DLsite/Fanza and effectively never change, so cache them
// for a long time rather than paying a conditional request every time (a 304
// carries no image data but still costs a round trip).
// `public` is deliberate: covers are site-wide content with nothing user-specific
// in them, so a shared cache storing one leaks nothing. Per-user JSON is covered
// by the `private, no-cache` default in api.js.
const COVER_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const COVER_FALLBACK_MAX_AGE = 5 * 60;   // 5 minutes

const PAGE_SIZE = config.pageSize || 12;
const FIELDS = ['circle', 'tag', 'va', 'illustrator', 'script_writer', 'series'];

// GET work cover image
router.get('/cover/:id',
  workIdParam(),
  (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    const workId = req.params.id;
    const type = req.query.type || 'main'; // 'main', 'sam', '240x240', '360x360'
    // Must be set manually: sendFile's maxAge option only applies when the
    // response has no Cache-Control yet (send/index.js:
    // `if (this._cacheControl && !res.getHeader('Cache-Control'))`), and api.js
    // already sets a default on every /api response -- so the option is a no-op here.
    res.setHeader('Cache-Control', `public, max-age=${COVER_MAX_AGE}`);
    res.sendFile(path.join(config.coverFolderDir, coverFileName(workId, type)), {
      dotfiles: 'allow', /* Express 5: preserve v4 behavior */
    }, (err) => {
      if (err) {
        // The placeholder must be cached briefly, not for the full 30 days: the
        // real cover appears once the work is scraped or rescanned, and a long
        // max-age would leave no-image.jpg stuck in place until it expires.
        res.setHeader('Cache-Control', `public, max-age=${COVER_FALLBACK_MAX_AGE}`);
        res.sendFile(path.join(__dirname, '../static/no-image.jpg'), (err2) => {
          if (err2) {
            next(err2);
          }
        });
      }
    });
});

// GET work metadata
router.get('/work/:id',
  workIdParam(),
  (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    let username = 'admin';
    if (config.auth) {
      username = req.user.name;
    }
    db.getWorkMetadata(req.params.id, username)
      .then(work => {
        // work is an Array of length 1
        normalize(work);
        res.send(work[0]);
      })
      .catch(err => next(err));
  });

// GET work memo, lazily computing + caching per-file content hashes.
// This is the only endpoint that reads audio file bytes (SHA-256, mtime-
// invalidated, cached in t_work.memo.contentHash). The tree endpoint (GET /tracks/:id)
// does NOT hash, so it returns instantly even for multi-GB works; the frontend
// fetches this in parallel and merges hashes onto tree nodes by relPath.
router.get('/work/:id/memo',
  workIdParam(),
  async (req, res, next) => {
    if(!isValidRequest(req, res)) return;
    const work_id = req.params.id;
    try {
      const work = await db.knex('t_work')
        .select('root_folder', 'dir', 'memo')
        .where('id', '=', work_id)
        .first();
      if (!work) {
        res.status(404).send({error: `没有 id 为 "${work_id}" 的作品`});
        return;
      }
      const rootFolder = config.rootFolders.find(rf => rf.name === work.root_folder);
      if (!rootFolder) {
        res.status(500).send({error: `找不到文件夹: "${work.root_folder}"`});
        return;
      }
      const workDir = path.join(rootFolder.path, work.dir);
      const oldMemo = JSON.parse(work.memo) || {};
      const { memo, changed } = await scrapeWorkHashes(work_id, workDir, oldMemo);
      if (changed) {
        await db.setWorkMemo(work_id, memo);
      }
      // Return the hash map keyed by relPath — the frontend joins this onto
      // tree audio nodes (which carry relPath) to populate contentHash.
      res.send({ contentHash: memo.contentHash || memo.hash || {} });
    } catch (err) {
      console.error(err);
      res.status(500).send({error: '计算文件哈希失败'});
    }
  });

// GET track list in work folder
router.get('/tracks/:id',
  workIdParam(),
  async (req, res, next) => {
    if(!isValidRequest(req, res)) return;
    const work_id = req.params.id;

    try {
      const work = await db.knex('t_work')
        .select('title', 'root_folder', 'dir', 'memo')
        .where('id', '=', work_id)
        .first();

      if (!work) {
        res.status(404).send({error: `没有 id 为 "${work_id}" 的作品`});
        return;
      }
      const rootFolder = config.rootFolders.find(rootFolder => rootFolder.name === work.root_folder);
      if (rootFolder) {
        try {
          const workDir = path.join(rootFolder.path, work.dir);
          const memo = JSON.parse(work.memo) || {};
          // Build the tree from the directory listing + memo (durations). NO file
          // reads here — content hashing (which reads every audio file's bytes)
          // is deferred to GET /api/work/:id/memo so a multi-GB work doesn't
          // stall the tree. Audio nodes get contentHash from memo.contentHash where
          // already cached, null/undefined otherwise; the frontend merges the
          // late-arriving hashes reactively by relPath.
          const tracks = await getTrackList(work_id, workDir, memo);
          const tree = toTree(tracks, work.title, work.dir, rootFolder);
          // Bundle per-track progress for the requesting user
          const username = config.auth ? req.user.name : 'admin';
          const trackProgress = await db.getTrackProgress(username, work_id);
          res.send({ tree, trackProgress });
        } catch (err) {
          console.error(err);
          res.status(500).send({error: '获取文件列表失败，请检查文件是否存在或重新扫描清理'});
        }
      } else {
        res.status(500).send({error: `找不到文件夹: "${work.root_folder}"，请尝试重启服务器或重新扫描.`});
      }
    } catch (err) {
      next(err);
    }
});

// GET list of work ids without any search
router.get('/works', 
  query('page').optional().isInt(),
  query('order').optional().isIn(["release", "rating", "dl_count", "price", "rate_average_2dp", "review_count", "id", "created_at", "random", "betterRandom"]),
  query('sort').optional().isIn(['desc', 'asc']),
  query('nsfw').optional().isInt().isIn([0/* 无年龄限制 */, 1 /* 全年龄 */, 2 /* 仅R18 */]),
  query('seed').optional().isInt(),
   
  async (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    const currentPage = parseInt(req.query.page) || 1;
    // 通过 "音声id, 贩卖日, 评价, 用户评价, 售出数, 评论数量, 价格, 平均评价, 全年龄新作， 入库时间， 随机， 随机一个" 排序
    // ['id', 'release', 'rating', 'dl_count', 'review_count', 'price', 'rate_average_2dp', 'nsfw', 'created_at']
    const order = req.query.order || 'release';
    const sort = req.query.sort || 'desc';
    const nsfw = parseInt(req.query.nsfw || '0');
    const offset = (currentPage - 1) * PAGE_SIZE;
    const username = config.auth ? req.user.name : 'admin';
    const shuffleSeed = req.query.seed ? req.query.seed : 7;

    try {
      const { works, totalCount } = await db.getWorksBy({
        username, nsfw, order, sort, limit: PAGE_SIZE, offset, seed: shuffleSeed
      });
      normalize(works);
    
      res.send({
        works,
        pagination: {
          currentPage,
          pageSize: PAGE_SIZE,
          totalCount: totalCount[0]['count']
        }
      });
    } catch(err) {
      res.status(500).send({error: '服务器错误'});
      console.error(err);
      // next(err);
    }
});

// GET name of a circle/tag/VA/illustrator/script_writer/series
for (const field of FIELDS) {
  router.get(`/${field}s/:id`,
    (req, res, next) => {
      if(!isValidRequest(req, res)) return;

      return db.getMetadata({field, id: req.params.id})
        .then(item => {
          if (item) {
            res.send(item); 
          } else {
            const errorMessage= {
              'circle': `社团${req.params.id}不存在`,
              'tag': `标签${req.params.id}不存在`,
              'va': `声优${req.params.id}不存在`,
              'illustrator': `イラスト${req.params.id}不存在`,
              'script_writer': `シナリオ${req.params.id}不存在`,
              'series': `シリーズ${req.params.id}不存在`
            };
            res.status(404).send({error: errorMessage[field]});
          }
        })
        .catch(err => next(err));
  });
}

 
router.get('/search', async (req, res, next) => {
  // const keyword = req.params.keyword ? req.params.keyword.trim() : '';
  const keyword = req.query.keyword ? req.query.keyword.trim() : '';

  const currentPage = parseInt(req.query.page) || 1;
  // 通过 "音声id, 贩卖日, 用户评价， 售出数, 评论数量, 价格, 平均评价, 全年龄新作" 排序
  // ['id', 'release', 'rating', 'dl_count', 'review_count', 'price', 'rate_average_2dp', 'nsfw']
  const order = req.query.order || 'release';
  const sort = req.query.sort || 'desc';
  const nsfw = parseInt(req.query.nsfw || '0'); 
  const offset = (currentPage - 1) * PAGE_SIZE;
  const username = config.auth ? req.user.name : 'admin';
  const shuffleSeed = req.query.seed ? req.query.seed : 7;
  
  try {
    const { works, totalCount } = await db.getWorksByKeyWord({
      keyword, username, nsfw, order, sort, limit: PAGE_SIZE, offset, seed: shuffleSeed
    });
    normalize(works);

    res.send({
      works,
      pagination: {
        currentPage,
        pageSize: PAGE_SIZE,
        totalCount: totalCount[0]['count']
      }
    });
  } catch(err) {
    res.status(500).send({error: '查询过程中出错'});
    console.error(err);
    // next(err);
  }
});

// GET list of work ids, restricted by circle/tag/VA/illustrator/script_writer/series
for (const field of FIELDS) {
  router.get(`/${field}s/:id/works`,
     
    async (req, res, next) => {
      if(!isValidRequest(req, res)) return;

      const currentPage = parseInt(req.query.page) || 1;
      // 通过 "音声id, 贩卖日, 用户评价, 售出数, 评论数量, 价格, 平均评价, 全年龄新作" 排序
      // ['id', 'release', 'rating', 'dl_count', 'review_count', 'price', 'rate_average_2dp, 'nsfw']
      const order = req.query.order || 'release';
      const sort = req.query.sort || 'desc'; // ['desc', 'asc]
      const nsfw = parseInt(req.query.nsfw || '0'); 
      const offset = (currentPage - 1) * PAGE_SIZE;
      const username = config.auth ? req.user.name : 'admin';
      const shuffleSeed = req.query.seed ? req.query.seed : 7;

      try {
        const { works, totalCount } = await db.getWorksBy({
          id: req.params.id, field,
          username, nsfw, order, sort, limit: PAGE_SIZE, offset, seed: shuffleSeed
        });

        normalize(works);

        res.send({
          works,
          pagination: {
            currentPage,
            pageSize: PAGE_SIZE,
            totalCount: totalCount[0]['count']
          }
        });
      } catch(err) {
        res.status(500).send({error: '查询过程中出错'});
        console.error(err);
        // next(err);
      }
  });
}

// GET list of circles/tags/VAs/illustrators/script_writers/series
for (const field of FIELDS) {
  router.get(`/${field}s/`,
    (req, res, next) => {
      if(!isValidRequest(req, res)) return;

      db.getLabels(field)
        .orderBy(`name`, 'asc')
        .then(list => res.send(list))
        .catch(err => next(err));
  });
}

// PUT - manually edit work metadata (admin only)
router.put('/work/:id',
  workIdParam(),
  body('title').isString().notEmpty(),
  body('nsfw').isBoolean(),
  body('release').optional().isString(),
  body('circle').isString(),
  body('tags').isArray(),
  body('vas').isArray(),
  body('illustrators').isArray(),
  body('scriptWriters').isArray(),
  body('series').optional(),
  async (req, res) => {
    if (!isValidRequest(req, res)) return;

    // Admin gate
    if (config.auth && req.user.name !== 'admin') {
      return res.status(403).send({ error: '只有 admin 账号能编辑作品元数据.' });
    }

    const workId = req.params.id;

    try {
      // Normalize input: coerce list elements to {id, name}, skip empty names, trim, deduplicate by name
      const normalizeList = (items) => {
        const seen = new Set();
        return items
          .map(item => (typeof item === 'string' ? { name: item.trim() } : { name: (item.name || '').trim() }))
          .filter(item => item.name !== '' && !seen.has(item.name) && seen.add(item.name))
          .map(item => ({ id: item.id, name: item.name }));
      };

      const data = {
        title: req.body.title.trim(),
        nsfw: req.body.nsfw,
        release: req.body.release != null ? req.body.release : '',
        circle: req.body.circle.trim(),
        tags: normalizeList(req.body.tags || []),
        vas: normalizeList(req.body.vas || []),
        illustrators: normalizeList(req.body.illustrators || []),
        scriptWriters: normalizeList(req.body.scriptWriters || []),
        series: req.body.series != null && req.body.series.name
          ? { name: req.body.series.name.trim() }
          : null,
      };

      await db.editWorkMetadata(workId, data);

      // Re-fetch and return updated metadata
      const username = config.auth ? req.user.name : 'admin';
      const work = await db.getWorkMetadata(workId, username);
      normalize(work);
      res.send({ message: '元数据更新成功', metadata: work[0] });
    } catch (err) {
      console.error(err);
      res.status(500).send({ error: '更新元数据失败' });
    }
  }
);

// 刷新单个作品文件夹中的文件信息记录，例如音频文件发生变动后，通过这个请求重新扫描音频文件时长
router.post('/work/scan/:id',
  workIdParam(),
  async function(req, res) {
    if(!isValidRequest(req, res)) return;

    const work_id = req.params.id;
    try {
      const work = await db.knex('t_work')
        .select('root_folder', 'dir', 'memo')
        .where('id', '=', work_id)
        .first();
      if (!work) {
        res.status(404).send({error: `没有 id 为 "${work_id}" 的作品`});
        return;
      }
      const rootFolder = config.rootFolders.find(rootFolder => rootFolder.name === work.root_folder);
      if (!rootFolder) {
        res.status(500).send({error: "扫描作品文件失败，没有找到rootFolder: " + work.root_folder});
        return;
      }
      const memo = await scrapeWorkMemo(work_id, path.join(rootFolder.path, work.dir), JSON.parse(work.memo));
      await db.setWorkMemo(work_id, memo);
      res.send({ memo });
    } catch (err) {
      console.error(err);
      res.status(500).send({error: "扫描作品文件失败：" + err.message});
    }
  } 
);

// refresh metadata of a work from DLsite or Fanza, and update the database
router.post('/refresh/:id',
  workIdParam(),
  async function(req, res) {
    if(!isValidRequest(req, res)) return;

    const work_id = req.params.id;
    try {
      let metadata;
      if (String(work_id).startsWith('d_')) {
        metadata = await scrapeWorkMetadataFromFanza(work_id);
      } else {
        metadata = await scrapeWorkMetadataFromDLsite(work_id);
      }
      metadata.id = work_id;
      await db.updateWorkMetadata(metadata, { refreshAll: true });
      res.send({ message: 'Refresh metadata for work ' + work_id + ' successful', metadata });
    } catch (err) {
      console.error(err);
      res.status(500).send({error: "Failed to refresh metadata for work " + work_id + ": " + err.message});
    }
  }
);

module.exports = router;
