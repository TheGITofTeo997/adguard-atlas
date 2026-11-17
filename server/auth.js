import crypto from 'node:crypto';

const COOKIE = 'atlas_session';
const TTL_MS = 12 * 60 * 60 * 1000;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

/**
 * Single-user session auth with zero extra dependencies.
 * - password hashed with scrypt (random salt per process), compared in constant time
 * - stateless signed tokens: base64url(payload).HMAC-SHA256. Used for the session cookie
 *   (HttpOnly + SameSite=Strict) and for the short-lived "password OK, 2FA pending" ticket.
 */
export function createAuth({ user, password, secret, secure = false }) {
  const salt = crypto.randomBytes(16);
  const pwHash = crypto.scryptSync(String(password), salt, 64);
  const userHash = sha(user);
  const sign = (s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  const seal = (obj, ttlMs) => {
    const payload = Buffer.from(JSON.stringify({ ...obj, exp: Date.now() + ttlMs })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  };

  const unseal = (token) => {
    if (typeof token !== 'string') return null;
    const [payload, sig, extra] = token.split('.');
    if (!payload || !sig || extra !== undefined || !same(sig, sign(payload))) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return data.exp > Date.now() ? data : null;
    } catch {
      return null;
    }
  };

  const readCookie = (header = '') => {
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return v.join('=');
    }
    return null;
  };

  const fromReq = (req) => {
    const data = unseal(readCookie(req.headers?.cookie));
    return data?.k === 'session' ? data : null;
  };

  return {
    fromReq,
    seal,
    unseal,
    check(u, p) {
      const h = crypto.scryptSync(String(p).slice(0, 256), salt, 64);
      const okPass = crypto.timingSafeEqual(h, pwHash);
      const okUser = crypto.timingSafeEqual(sha(u), userHash);
      return okPass && okUser;
    },
    issue(res) {
      res.cookie(COOKIE, seal({ k: 'session' }, TTL_MS), {
        httpOnly: true, sameSite: 'strict', secure, maxAge: TTL_MS, path: '/'
      });
    },
    clear(res) {
      res.clearCookie(COOKIE, { path: '/' });
    },
    require(req, res, next) {
      if (fromReq(req)) return next();
      if (req.method === 'GET' && req.accepts('html')) return res.redirect('/login/');
      res.status(401).json({ error: 'unauthorized' });
    }
  };
}
