const express = require('express');
const router = express.Router();
const { config } = require('../config');
const db = require('../database/db');
const { param } = require('express-validator');
const fs = require('fs');
const path = require('path');
const jschardet = require('jschardet');
const { getTrackList } = require('../filesystem/utils');
const { joinFragments } = require('./utils/url');
const { isValidRequest, workIdParam } = require('./utils/validate');
const { findLyricTracks } = require('./utils/lyrics');

// GET (stream) a specific track from work folder
router.get('/stream/:id/:index',
  workIdParam(),
  param('index').isInt(),
  (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    db.knex('t_work')
      .select('root_folder', 'dir', 'memo')
      .where('id', '=', req.params.id)
      .first()
      .then((work) => {
        if (!work) {
          res.status(404).send({error: `没有 id 为 "${req.params.id}" 的作品`});
          return;
        }
        const rootFolder = config.rootFolders.find(rootFolder => rootFolder.name === work.root_folder);
        if (rootFolder) {
          getTrackList(req.params.id, path.join(rootFolder.path, work.dir), JSON.parse(work.memo))
            .then((tracks) => {
              const track = tracks[req.params.index];

              const fileName = path.join(rootFolder.path, work.dir, track.subtitle || '', track.title);
              const extName = path.extname(fileName).toLocaleLowerCase();
              if (extName === '.txt' || extName === '.lrc') {
                const fileBuffer = fs.readFileSync(fileName);
                const charsetMatch = jschardet.detect(fileBuffer).encoding;
                if (charsetMatch) {
                  res.setHeader('Content-Type', `text/plain; charset=${charsetMatch}`);
                }
              }
              if (extName === '.flac') {
                // iOS不支持audio/x-flac
                res.setHeader('Content-Type', `audio/flac`);
              }

              // Offload from express, 302 redirect to a virtual directory in a reverse proxy like Nginx
              // Only redirect media files, not including text files and lrcs because we need charset detection
              // so that the browser properly renders them
              if (config.offloadMedia && extName !== '.txt' && extName !== '.lrc') {
                // Path controlled by config.offloadMedia and config.offloadStreamPath
                // By default: /media/stream/VoiceWork/RJ123456/subdirs/track.mp3
                // If the folder is deeper: /media/stream/VoiceWork/second/RJ123456/subdirs/track.mp3
                const baseUrl = config.offloadStreamPath;
                let offloadUrl = joinFragments(baseUrl, rootFolder.name, work.dir, track.subtitle || '', track.title);
                if (process.platform === 'win32') {
                  offloadUrl = offloadUrl.replace(/\\/g, '/');
                }

                res.redirect(offloadUrl);
              } else {
                // By default, serve file through express
                // dotfiles: 'allow' — Express 5's send rejects paths containing a dot-segment
                // (e.g. .hidden/track.opus) unless opted in; v4 served them by default.
                res.sendFile(fileName, { dotfiles: 'allow' });
              }
            })
            .catch(err => next(err));
        } else {
          res.status(500).send({error: `找不到文件夹: "${work.root_folder}"，请尝试重启服务器或重新扫描.`});
        }
      })
      .catch(err => next(err));
});

router.get('/download/:id/:index',
  workIdParam(),
  param('index').isInt(),
  (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    db.knex('t_work')
      .select('root_folder', 'dir', 'memo')
      .where('id', '=', req.params.id)
      .first()
      .then((work) => {
        if (!work) {
          res.status(404).send({error: `没有 id 为 "${req.params.id}" 的作品`});
          return;
        }
        const rootFolder = config.rootFolders.find(rootFolder => rootFolder.name === work.root_folder);
        if (rootFolder) {
          getTrackList(req.params.id, path.join(rootFolder.path, work.dir), JSON.parse(work.memo))
            .then((tracks) => {
              const track = tracks[req.params.index];

              // Offload from express, 302 redirect to a virtual directory in a reverse proxy like Nginx
              if (config.offloadMedia) {
                // Path controlled by config.offloadMedia and config.offloadDownloadPath
                // By default: /media/download/VoiceWork/RJ123456/subdirs/track.mp3
                // If the folder is deeper: /media/download/VoiceWork/second/RJ123456/subdirs/track.mp3
                const baseUrl = config.offloadDownloadPath;
                let offloadUrl = joinFragments(baseUrl, rootFolder.name, work.dir, track.subtitle || '', track.title);
                if (process.platform === 'win32') {
                  offloadUrl = offloadUrl.replace(/\\/g, '/');
                }

                // Note: you should set 'Content-Disposition: attachment' header in your reverse proxy for the download virtual directory
                // By default the directory is /media/download
                res.redirect(offloadUrl);
              } else {
                // By default, serve file through express
                res.download(path.join(rootFolder.path, work.dir, track.subtitle || '', track.title));
              }
            })
            .catch(err => next(err));
        } else {
          res.status(500).send({error: `找不到文件夹: "${work.root_folder}"，请尝试重启服务器或重新扫描.`});
        }
      });
});

router.get('/check-lrc/:id/:index',
  workIdParam(),
  param('index').isInt(),
  (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    db.knex('t_work')
      .select('root_folder', 'dir', 'memo')
      .where('id', '=', req.params.id)
      .first()
      .then((work) => {
        if (!work) {
          res.status(404).send({error: `没有 id 为 "${req.params.id}" 的作品`});
          return;
        }
        const rootFolder = config.rootFolders.find(rootFolder => rootFolder.name === work.root_folder);
        if (rootFolder) {
          getTrackList(req.params.id, path.join(rootFolder.path, work.dir), JSON.parse(work.memo))
            .then((tracks) => {
              const track = tracks[req.params.index];
              const lyrics = findLyricTracks(track, tracks);

              if (lyrics.length) {
                console.log('Found lyrics file: ', lyrics.map(lyric => lyric.trackId).join(', '));
                res.send({
                  result: true,
                  message: 'Found lyrics file',
                  lyrics,
                  // Single-file fields kept for clients cached from before
                  // multi-speaker lyrics existed: the PWA can serve a bundle
                  // older than the backend it talks to.
                  trackId: lyrics[0].trackId,
                  lyricExtension: lyrics[0].lyricExtension,
                });
              } else {
                res.send({result: false, message:'Found no lyrics file', trackId: '', lyrics: []});
              }
            })
            .catch(err => next(err));
        } else {
          res.status(500).send({error: `找不到文件夹: "${work.root_folder}"，请尝试重启服务器或重新扫描.`});
        }
      })
      .catch(err => next(err));
});

// GET (stream) a specific track from work folder
module.exports = router;