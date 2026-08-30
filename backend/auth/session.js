const crypto = require('crypto');

const { knex } = require('../database/db');
const { config } = require('../config');

const SESSION_COOKIE = 'kikoeru_sid';

// The client holds the secret; only its SHA-256 is ever stored. A leaked database
// file therefore does not hand over live sessions.
const hashSecret = (secret) => crypto.createHash('sha256').update(secret).digest('hex');

/**
 * Read the session secret from the cookie (browsers) or from an
 * `Authorization: Bearer` header (scripts and other non-browser clients).
 */
const getSessionSecret = (req) => {
  if (req.cookies && req.cookies[SESSION_COOKIE]) {
    return req.cookies[SESSION_COOKIE];
  }
  if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
    return req.headers.authorization.split(' ')[1];
  }
  return null;
};

// Shared by res.cookie and res.clearCookie -- clearing only works when the
// options match those the cookie was set with.
const sessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  // Conditional on purpose: many self-hosted installs run plain HTTP on a LAN,
  // where an unconditional Secure flag would make login silently fail. Behind a
  // TLS-terminating reverse proxy, `false` is merely less strict, not broken.
  secure: config.httpsEnabled,
  // Scoped to where the app is actually served from, so an install under
  // config.basePath does not hand its session cookie to the other services
  // sharing the hostname. '/' when the app owns the whole host, as before.
  path: config.basePath || '/',
});

// Create a session and return the secret handed to the client (only its hash is stored)
const createSession = async (userName) => {
  const secret = crypto.randomBytes(32).toString('hex');
  await knex('t_session').insert({
    id: hashSecret(secret),
    user_name: userName,
    expires_at: Date.now() + config.expiresIn * 1000,
  });
  return secret;
};

// Returns { name, group } for a live session, or null.
// `group` is read from t_user on every request rather than captured at login, so
// demoting an administrator takes effect immediately instead of at token expiry.
const getSession = async (secret) => {
  if (!secret) {
    return null;
  }
  const row = await knex('t_session')
    .join('t_user', 't_session.user_name', 't_user.name')
    .select('t_user.name as name', 't_user.group as group')
    .where('t_session.id', '=', hashSecret(secret))
    .andWhere('t_session.expires_at', '>', Date.now())
    .first();

  return row || null;
};

const destroySession = (secret) => {
  if (!secret) {
    return Promise.resolve(0);
  }
  return knex('t_session').where('id', '=', hashSecret(secret)).del();
};

// Used after a password change to invalidate that user's other sessions immediately
const destroyUserSessions = (userName) => knex('t_session').where('user_name', '=', userName).del();

const sweepExpired = () => knex('t_session').where('expires_at', '<=', Date.now()).del();

module.exports = {
  SESSION_COOKIE,
  getSessionSecret,
  sessionCookieOptions,
  createSession,
  getSession,
  destroySession,
  destroyUserSessions,
  sweepExpired,
};
