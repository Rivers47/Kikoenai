const express = require('express');
const { check, validationResult } = require('express-validator'); // 后端校验

const { md5 } = require('../auth/utils');
const {
  SESSION_COOKIE,
  getSessionSecret,
  sessionCookieOptions,
  createSession,
  destroySession,
} = require('../auth/session');
const db = require('../database/db');

const { config } = require('../config');

const router = express.Router();

// 用户登录
router.post('/me', [
  check('name')
    .isLength({ min: 5 })
    .withMessage('用户名长度至少为 5'),
  check('password')
    .isLength({ min: 5 })
    .withMessage('密码长度至少为 5')
], async (req, res) => {
  // Finds the validation errors in this request and wraps them in an object with handy functions
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).send({ errors: errors.array() });
  }

  const name = req.body.name;
  const password = req.body.password;

  try {
    const user = await db.knex('t_user')
      .where('name', '=', name)
      .andWhere('password', '=', md5(password))
      .first();

    if (!user) {
      res.set("WWW-Authenticate", "Bearer realm=\"Authorization Required\"");
      return res.status(401).send({ error: '用户名或密码错误.' });
    }

    const secret = await createSession(user.name);
    res.cookie(SESSION_COOKIE, secret, {
      ...sessionCookieOptions(),
      maxAge: config.expiresIn * 1000,
    });

    // `session` is only for non-browser clients, which send it back as
    // `Authorization: Bearer <session>`. The web app ignores this field and
    // authenticates with the HttpOnly cookie instead.
    res.send({
      user: { name: user.name, group: user.group },
      session: secret,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: '服务器错误' });
  }
});

// Log out: destroy the server-side session and clear the cookie
router.post('/logout', async (req, res) => {
  try {
    await destroySession(getSessionSecret(req));
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    res.send({ message: '已退出登录.' });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: '服务器错误' });
  }
});

// 获取用户信息
// Auth is handled by the middleware in api.js -- GET /auth/me is not a public route
router.get('/me', (req, res) => {
  // 同时告诉客户端，服务器是否启用用户验证
  const auth = config.auth;
  const user = config.auth
    ? { name: req.user.name, group: req.user.group }
    : { name: 'admin', group: 'administrator' };
  res.send({ user, auth });
});

module.exports = router;
