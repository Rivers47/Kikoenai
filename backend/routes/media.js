const express = require('express');
const router = express.Router();
const { config } = require('../config');
const db = require('../database/db');
const { param } = require('express-validator');
const fs = require('fs');
const path = require('path');
const jschardet = require('jschardet');
const { getTrackList, getContentHashLimited, transcodeFileName, transcodeToOpusLimited } = require('../filesystem/utils');
const { joinFragments } = require('./utils/url');
const { isValidRequest, workIdParam } = require('./utils/validate');

// Sources that get transcoded for the offline-copy endpoint (see /offline
// below) -- everything else is either text (charset-detected and served as-is)
// or already-lossy audio (served as-is, re-encoding it would only lose quality).
const LOSSLESS_AUDIO_EXT_LIST = ['.wav', '.flac'];
const TEXT_EXT_LIST = ['.txt', '.lrc', '.srt', '.ass', '.vtt'];

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

// GET the best offline-friendly copy of a track: lossless audio (.wav/.flac)
// is transcoded to Opus on first request and cached on disk thereafter;
// already-lossy audio and text/subtitle files are served as-is. Named for
// what it's for (an offline-downloadable copy), not for what it does
// internally, since most requests don't actually transcode anything.
router.get('/offline/:id/:index',
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
        if (!rootFolder) {
          res.status(500).send({error: `找不到文件夹: "${work.root_folder}"，请尝试重启服务器或重新扫描.`});
          return;
        }

        getTrackList(req.params.id, path.join(rootFolder.path, work.dir), JSON.parse(work.memo))
          .then(async (tracks) => {
            const track = tracks[req.params.index];
            if (!track) {
              res.status(404).send({error: `没有找到对应的曲目`});
              return;
            }

            // This route always serves through Express itself, ignoring
            // config.offloadMedia -- the nginx offload path maps straight to
            // the original on-disk file, and a transcoded/cached file has no
            // place in that mapping.
            const fileName = path.join(rootFolder.path, work.dir, track.subtitle || '', track.title);
            const extName = path.extname(fileName).toLocaleLowerCase();

            if (TEXT_EXT_LIST.includes(extName)) {
              const fileBuffer = fs.readFileSync(fileName);
              const charsetMatch = jschardet.detect(fileBuffer).encoding;
              if (charsetMatch) {
                res.setHeader('Content-Type', `text/plain; charset=${charsetMatch}`);
              }
              res.sendFile(fileName, { dotfiles: 'allow' });
              return;
            }

            if (!LOSSLESS_AUDIO_EXT_LIST.includes(extName)) {
              // Already-lossy audio (or any other file type) -- serve as-is,
              // re-encoding lossy source would only waste CPU and lose quality.
              res.sendFile(fileName, { dotfiles: 'allow' });
              return;
            }

            if (!config.enableTranscoding) {
              res.status(503).send({error: '转码功能已禁用'});
              return;
            }

            try {
              // Never trust a client-supplied hash -- resolve it server-side.
              // track.contentHash is only populated once GET /api/work/:id/memo
              // has run for this work; fall back to computing it here so this
              // route is self-sufficient.
              const contentHash = track.contentHash || await getContentHashLimited(fileName);
              const cachePath = path.join(config.transcodeCacheDir, transcodeFileName(req.params.id, contentHash));

              if (!fs.existsSync(cachePath)) {
                await transcodeToOpusLimited(fileName, cachePath, config.transcodeBitrate);
              }

              // Content-addressed by hash -- truly immutable, so this can be
              // cached even longer than covers (which can only assert 30 days
              // since DLsite/Fanza could replace the source image).
              res.setHeader('Cache-Control', 'public, max-age=31536000');
              res.sendFile(cachePath, { dotfiles: 'allow' });
            } catch (err) {
              next(err);
            }
          })
          .catch(err => next(err));
      })
      .catch(err => next(err));
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
              const fileDir = path.join(rootFolder.path, work.dir, track.subtitle || '');



              let foundLyricFileName = "";
              let foundLyricExtension = "";
              const supportedLyricExtensions = [".lrc", ".srt", ".vtt"];
              const trackTitle = track.title;
              for (const ext of supportedLyricExtensions) {
                // 几种不同的查找歌词文件的方式
                const tryFileLocs = [
                  trackTitle.substring(0, trackTitle.lastIndexOf(".")) + ext, // sometitle.mp3 -> sometitle.lrc
                  trackTitle.substring(0, trackTitle.lastIndexOf(".")) + ext.toUpperCase(), // sometitle.mp3 -> sometitle.LRC
                  trackTitle + ext, // sometitle.mp3 -> sometitle.mp3.lrc
                  trackTitle + ext.toUpperCase(), // sometitle.mp3 -> sometitle.mp3.LRC
                ];
                for (const tryFileLoc of tryFileLocs) {
                  if (fs.existsSync(path.join(fileDir, tryFileLoc))) {
                    foundLyricFileName = tryFileLoc;
                    break;
                  }
                }
                if (foundLyricFileName != "") {
                  foundLyricExtension = ext;
                  break;
                }
              }


              if (foundLyricFileName != "") {
                console.log('找到歌词文件');
                const subtitleToFind = track.subtitle;
                console.log('歌词文件名： ', foundLyricFileName);
                // 文件名、子目录名相同
                tracks.forEach(trackItem => {
                  if (trackItem.title === foundLyricFileName && subtitleToFind === trackItem.subtitle) {
                      res.send({result: true, message:'找到歌词文件', trackId: trackItem.trackId, lyricExtension: foundLyricExtension});
                  }
                });
              } else {
                res.send({result: false, message:'不存在歌词文件', trackId: ''});
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