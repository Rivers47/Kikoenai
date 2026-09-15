const express = require('express');
const router = express.Router();
const { config } = require('../config');
const fs = require('fs');
const path = require('path');
const jschardet = require('jschardet');
const { transcodeFileName, transcodeToOpusLimited } = require('../filesystem/utils');
const { joinFragments } = require('./utils/url');
const { isValidRequest, workIdParam } = require('./utils/validate');
const { findLyricTracks } = require('./utils/lyrics');
const { resolveTrack } = require('./utils/track');

const offloadUrlFor = (basePath, rootFolder, work, track) => {
  const url = joinFragments(basePath, rootFolder.name, work.dir, track.subtitle || '', track.title);
  return process.platform === 'win32' ? url.replace(/\\/g, '/') : url;
};

const LOSSLESS_AUDIO_EXT_LIST = ['.wav', '.flac', '.alac', '.ape', '.tta'];
const TEXT_EXT_LIST = ['.txt', '.lrc', '.srt', '.ass', '.vtt'];

// GET (stream) a specific track from work folder
router.get('/stream/:id/*path',
  workIdParam(),
  async (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    try {
      const resolved = await resolveTrack(req, res);
      if (!resolved) return;
      const { work, rootFolder, workDir, track } = resolved;

      const fileName = path.join(workDir, track.subtitle || '', track.title);
      const extName = path.extname(fileName).toLocaleLowerCase();
      if (extName === '.txt' || extName === '.lrc') {
        const fileBuffer = fs.readFileSync(fileName);
        const charsetMatch = jschardet.detect(fileBuffer).encoding;
        if (charsetMatch) {
          res.setHeader('Content-Type', `text/plain; charset=${charsetMatch}`);
        }
      }
      if (extName === '.flac') {
        // iOS patch
        res.setHeader('Content-Type', `audio/flac`);
      }

      if (config.offloadMedia && extName !== '.txt' && extName !== '.lrc') {
        res.redirect(offloadUrlFor(config.offloadStreamPath, rootFolder, work, track));
      } else {
        // By default, serve file through express
        res.sendFile(fileName, { dotfiles: 'allow' });
      }
    } catch (err) {
      next(err);
    }
});

router.get('/download/:id/*path',
  workIdParam(),
  async (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    try {
      const resolved = await resolveTrack(req, res);
      if (!resolved) return;
      const { work, rootFolder, workDir, track } = resolved;

      if (config.offloadMedia) {
        res.redirect(offloadUrlFor(config.offloadDownloadPath, rootFolder, work, track));
      } else {
        // By default, serve file through express
        res.download(path.join(workDir, track.subtitle || '', track.title));
      }
    } catch (err) {
      next(err);
    }
});

// GET the best offline-friendly copy of a track
router.get('/offline/:id/*path',
  workIdParam(),
  async (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    try {
      const resolved = await resolveTrack(req, res);
      if (!resolved) return;
      const { workDir, track } = resolved;

      const fileName = path.join(workDir, track.subtitle || '', track.title);
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
        res.sendFile(fileName, { dotfiles: 'allow' });
        return;
      }

      if (!config.enableTranscoding) {
        res.status(503).send({error: '转码功能已禁用'});
        return;
      }

      const { mtimeMs } = await fs.promises.stat(fileName);
      const cachePath = path.join(
        config.transcodeCacheDir,
        transcodeFileName(req.params.id, track.shortFilePath, Math.round(mtimeMs), config.transcodeBitrate)
      );

      if (!fs.existsSync(cachePath)) {
        await transcodeToOpusLimited(fileName, cachePath, config.transcodeBitrate);
      }

      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.sendFile(cachePath, { dotfiles: 'allow' });
    } catch (err) {
      next(err);
    }
});

router.get('/check-lrc/:id/*path',
  workIdParam(),
  async (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    try {
      const { tracks, track } = await resolveTrack(req, res) || {};
      if (!track) return;

      const lyrics = findLyricTracks(track, tracks);
      if (lyrics.length) {
        console.log('Found lyrics file: ', lyrics.map(lyric => lyric.trackId).join(', '));
        res.send({
          result: true,
          message: 'Found lyrics file',
          lyrics,
        });
      } else {
        res.send({result: false, message:'Found no lyrics file', lyrics: []});
      }
    } catch (err) {
      next(err);
    }
});

module.exports = router;
