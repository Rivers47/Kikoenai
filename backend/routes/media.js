const express = require('express');
const router = express.Router();
const { config } = require('../config');
const fs = require('fs');
const path = require('path');
const jschardet = require('jschardet');
const { joinFragments } = require('./utils/url');
const { isValidRequest, workIdParam } = require('./utils/validate');
const { findLyricTracks } = require('./utils/lyrics');
const { resolveTrack } = require('./utils/track');

// The reverse proxy addresses the file on disk, so its URL is built from the
// work folder and the track's own path rather than from the track handle.
const offloadUrlFor = (basePath, rootFolder, work, track) => {
  const url = joinFragments(basePath, rootFolder.name, work.dir, track.subtitle || '', track.title);
  return process.platform === 'win32' ? url.replace(/\\/g, '/') : url;
};

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
        // iOS不支持audio/x-flac
        res.setHeader('Content-Type', `audio/flac`);
      }

      // Offload from express, 302 redirect to a virtual directory in a reverse proxy like Nginx
      // Only redirect media files, not including text files and lrcs because we need charset detection
      // so that the browser properly renders them
      if (config.offloadMedia && extName !== '.txt' && extName !== '.lrc') {
        // By default: /media/stream/VoiceWork/RJ123456/subdirs/track.mp3
        res.redirect(offloadUrlFor(config.offloadStreamPath, rootFolder, work, track));
      } else {
        // By default, serve file through express
        // dotfiles: 'allow' — Express 5's send rejects paths containing a dot-segment
        // (e.g. .hidden/track.opus) unless opted in; v4 served them by default.
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

      // Offload from express, 302 redirect to a virtual directory in a reverse proxy like Nginx
      if (config.offloadMedia) {
        // Note: you should set 'Content-Disposition: attachment' header in your reverse proxy
        // for the download virtual directory. By default the directory is /media/download
        res.redirect(offloadUrlFor(config.offloadDownloadPath, rootFolder, work, track));
      } else {
        // By default, serve file through express
        res.download(path.join(workDir, track.subtitle || '', track.title));
      }
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
