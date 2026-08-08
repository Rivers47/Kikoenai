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
  { method: 'POST', path: '/auth/me' }, // login
  { method: 'GET', path: '/health' },
];

const isPublic = (req) => PUBLIC_ROUTES.some(
  (route) => route.method === req.method && route.path === req.path
);

// The error handler in app.js keys off err.name to return a 401
const unauthorized = (message) => {
  const err = new Error(message);
  err.name = 'UnauthorizedError';
  return err;
};

// Validate the session, then attach { name, group } to req.user
// (same shape the old JWT middleware produced, so no route needs changing)
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

/**
 * Default cache policy for every /api response.
 *
 * `private` is the load-bearing part: it stops a shared cache (e.g. an nginx
 * proxy_cache in front of the app) from storing the response. RFC 9111's
 * protection for authenticated requests only covers the Authorization header,
 * NOT cookies -- and this app is cookie-authenticated. Without an explicit
 * `private`, a shared cache could store per-user responses like /api/auth/me,
 * /api/history or /api/review and serve one user's data to another, since
 * nginx does not key on Cookie by default.
 *
 * `no-cache` rather than `no-store`: the browser may still store the response
 * but must revalidate before using it, which preserves the 304s from Express's
 * default ETag instead of forcing a full re-download every time.
 *
 * Routes wanting real caching (e.g. covers) override this with res.setHeader.
 */
const apiCacheDefaults = (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-cache');
  next();
};

module.exports = (app) => {
  // Mounted before auth so 401 responses carry the header too
  app.use('/api', apiCacheDefaults);

  if (config.auth) {
    // CSRF: the session cookie is SameSite=Lax, which still allows top-level
    // cross-site GET navigation. That is safe only because every state-changing
    // route here is POST/PUT/DELETE. Adding a GET with side effects would
    // reintroduce CSRF -- use a non-GET method instead.
    app.use('/api', authenticate);
  }

  app.use('/api', routes);
};
