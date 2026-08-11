const express = require('express');
const router = express.Router();
const { query, body } = require('express-validator');
const { config } = require('../config');
const db = require('../database/db');
const normalize = require('./utils/normalize');
const { isValidRequest, workIdBody } = require('./utils/validate');

const PAGE_SIZE = config.pageSize || 12;


router.get('/',
  query('page').optional().isInt(),
  query('sort').optional().isIn(['desc', 'asc']),
  query('excludeFinished').optional().isIn(['all', 'listened']),
   
  async (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    const currentPage = parseInt(req.query.page) || 1;
    const sort = req.query.sort || 'desc';
    const offset = (currentPage - 1) * PAGE_SIZE;
    const username = config.auth ? req.user.name : 'admin';
    const excludeFinished = req.query.excludeFinished || 'listened';
    
    try {
      const {works, totalCount} = await db.getPlayHistory({
        username: username,
        limit: PAGE_SIZE,
        offset: offset,
        sortOption: sort,
        excludeFinished: excludeFinished,
      });
      // console.log(`works = ${works}, totalCount = ${totalCount[0]['count']}`)

      normalize(works, {dateOnly: true});

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
    }
});

// 更新播放状态
router.put('/',
  // Not body('work_id').isInt(): work ids are TEXT since migration
  // 20260802000000 -- DLsite ids are zero-padded digit strings and Fanza ids
  // are 'd_'-prefixed, so isInt() rejected every Fanza work with a 400. Use the
  // shared validator, which also self-heals legacy 7-digit ids. Matches the
  // DELETE below and every other work_id route.
  workIdBody(),
  body('state').isObject(),
   
  (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    let username = config.auth ? req.user.name : 'admin';

    // console.log('update historoy =', username, req.body.work_id, req.body.state)
    // console.log(`config.auth = ${config.auth}`)
    
    db.updatePlayHistory(username, req.body.work_id, JSON.stringify(req.body.state))
        .then(() => {
          res.send({ message: '更新历史成功' });
        }).catch((err) =>{
          res.status(500).send({ error: '更新播放历史失败，服务器错误' });
          console.error(err);
        });
});

// 删除播放历史，适用于当前场景下，某些文件被删除后，作品只有一个文件，无法播放正确文件的bug
router.delete('/',
  workIdBody(),
  async (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    let username = config.auth ? req.user.name : 'admin';
    try {
      await db.deletePlayHistory(username, req.body.work_id);
      res.send({message: '删除历史记录成功'});
    } catch (err) {
      console.error(err);
      next(err);
    }
});

module.exports = router;