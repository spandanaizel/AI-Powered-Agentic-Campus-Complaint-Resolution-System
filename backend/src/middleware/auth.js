import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { config } from '../config/env.js';
import { unauthorized, forbidden } from '../utils/errors.js';

export const COOKIE_NAME = 'ccrs_session';

export function issueSession(res, user) {
  const token = jwt.sign({ sub: String(user._id), tv: user.tokenVersion }, config.jwtSecret, { expiresIn: config.jwtTtl });
  const decoded = jwt.decode(token);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/api',
    expires: new Date(decoded.exp * 1000),
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/api' });
}

/**
 * Authenticates from the httpOnly cookie. The role is ALWAYS read from the database, never from
 * the token or the request, and the token is rejected if the account was deactivated or its
 * tokenVersion changed (logout, role change).
 */
export async function requireAuth(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next(unauthorized());
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret); } catch { return next(unauthorized('Your session has expired. Please sign in again.')); }
  const user = await User.findById(payload.sub);
  if (!user || !user.active || user.tokenVersion !== payload.tv) return next(unauthorized('Your session has expired. Please sign in again.'));
  req.user = user;
  return next();
}

export const requireRole = (...roles) => (req, _res, next) => (
  roles.includes(req.user?.role) ? next() : next(forbidden())
);

/**
 * CSRF defence for cookie auth: SameSite=Strict cookie + a required custom header on unsafe
 * methods. Browsers cannot send custom headers cross-origin without a CORS preflight, and CORS
 * only allows the configured frontend origin(s).
 */
export function requireCsrfHeader(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'XMLHttpRequest') return next(forbidden('Missing X-Requested-With header'));
  return next();
}
