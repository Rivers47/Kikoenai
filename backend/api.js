const routes = require('./routes');

const { config } = require('./config');
const { getSession, getSessionSecret } = require('./auth/session');

// Routes reachable without a session.
//
// NOTE: `app.use('/api', ...)` strips the mount path before the middleware runs,
// so these are matched against req.path -- '/auth/me', NOT '/api/auth/me'.
// Getting this wrong either locks out login or leaves the whole API open.
//
// The method matters: POST /auth/me is the login endpoint and must be public,
// while GET /auth/me returns the current user and must not be.
const PUBLIC_ROUTES = [
  { method: 'POST', path: '/auth/me' }, // 登录
  { method: 'GET', path: '/health' },
];

const isPublic = (req) => PUBLIC_ROUTES.some(
  (route) => route.method === req.method && route.path === req.path
);

// app.js 的错误处理中间件按 err.name 识别验证错误并返回 401
const unauthorized = (message) => {
  const err = new Error(message);
  err.name = 'UnauthorizedError';
  return err;
};

// 校验会话，通过后把 { name, group } 挂到 req.user 上（与原 JWT 中间件的形状一致）
const authenticate = async (req, res, next) => {
  if (isPublic(req)) {
    return next();
  }

  try {
    const user = await getSession(getSessionSecret(req));
    if (!user) {
      return next(unauthorized('登录状态已失效，请重新登录.'));
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = (app) => {
  if (config.auth) {
    // CSRF: the session cookie is SameSite=Lax, which still allows top-level
    // cross-site GET navigation. That is safe only because every state-changing
    // route here is POST/PUT/DELETE. Adding a GET with side effects would
    // reintroduce CSRF -- use a non-GET method instead.
    app.use('/api', authenticate);
  }

  app.use('/api', routes);
};
