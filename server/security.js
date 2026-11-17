import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import { generateSecret, otpauthUri, verifyTotp } from './totp.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normRecovery = (c) => String(c).toLowerCase().replace(/[^a-f0-9]/g, '');
const TICKET_TTL = 5 * 60 * 1000;
const MAX_TICKET_ATTEMPTS = 5;

export function createSecurityRoutes({ auth, store, user }) {
  const attempts = new Map(); // 2FA ticket id -> failed attempts
  const json = express.json({ limit: '2kb' });
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true,
    standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts' }
  });

  // State-changing requests must come from our own origin (defence in depth on top of SameSite=Strict)
  const sameOrigin = (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) throw new Error('cross-origin'); }
      catch { return res.status(403).json({ error: 'forbidden' }); }
    }
    next();
  };

  /** TOTP code (replay-protected) or one-time recovery code. */
  function checkSecondFactor(code) {
    const t = store.data.twofa;
    if (!t?.enabled) return false;
    const c = String(code ?? '').trim();
    if (/^\d{6}$/.test(c)) {
      const counter = verifyTotp(t.secret, c, t.lastCounter ?? -1);
      if (counter === null) return false;
      t.lastCounter = counter;
      store.save();
      return true;
    }
    const i = t.recovery.indexOf(sha(normRecovery(c)));
    if (i === -1) return false;
    t.recovery.splice(i, 1);
    store.save();
    return true;
  }

  return {
    publicRoutes(app) {
      app.post('/api/login', sameOrigin, limiter, json, (req, res) => {
        const { username, password } = req.body ?? {};
        if (typeof username !== 'string' || typeof password !== 'string' || !auth.check(username, password)) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (store.data.twofa?.enabled) {
          const id = crypto.randomBytes(8).toString('hex');
          return res.json({ twofa: true, ticket: auth.seal({ k: '2fa', id }, TICKET_TTL) });
        }
        auth.issue(res);
        res.json({ ok: true });
      });

      app.post('/api/login/2fa', sameOrigin, limiter, json, (req, res) => {
        const ticket = auth.unseal(req.body?.ticket);
        if (!ticket || ticket.k !== '2fa') return res.status(401).json({ error: 'Session expired, sign in again' });
        const failed = attempts.get(ticket.id) ?? 0;
        if (failed >= MAX_TICKET_ATTEMPTS) return res.status(429).json({ error: 'Too many attempts, sign in again' });
        if (!checkSecondFactor(req.body?.code)) {
          if (attempts.size > 1000) attempts.clear();
          attempts.set(ticket.id, failed + 1);
          return res.status(401).json({ error: 'Invalid code' });
        }
        attempts.delete(ticket.id);
        auth.issue(res);
        res.json({ ok: true });
      });

      app.post('/api/logout', sameOrigin, (req, res) => {
        auth.clear(res);
        res.status(204).end();
      });
    },

    protectedRoutes(app) {
      app.get('/api/security', (req, res) => {
        const t = store.data.twofa;
        res.json({ twofa: !!t?.enabled, recoveryLeft: t?.recovery?.length ?? 0, persistent: store.persistent });
      });

      app.post('/api/2fa/setup', sameOrigin, limiter, json, async (req, res) => {
        if (store.data.twofa?.enabled) return res.status(409).json({ error: '2FA already enabled' });
        const secret = generateSecret();
        store.data.pending = { secret, created: Date.now() };
        store.save();
        const uri = otpauthUri({ secret, account: user });
        res.json({ secret, otpauth: uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
      });

      app.post('/api/2fa/enable', sameOrigin, limiter, json, (req, res) => {
        const p = store.data.pending;
        if (!p || Date.now() - p.created > 15 * 60 * 1000) return res.status(400).json({ error: 'Setup expired, start again' });
        const counter = verifyTotp(p.secret, String(req.body?.code ?? '').trim());
        if (counter === null) return res.status(401).json({ error: 'Invalid code' });
        const codes = Array.from({ length: 8 }, () => {
          const h = crypto.randomBytes(5).toString('hex');
          return `${h.slice(0, 5)}-${h.slice(5)}`;
        });
        store.data.twofa = { enabled: true, secret: p.secret, lastCounter: counter, recovery: codes.map((c) => sha(normRecovery(c))) };
        store.data.pending = null;
        store.save();
        res.json({ recoveryCodes: codes });
      });

      app.post('/api/2fa/disable', sameOrigin, limiter, json, (req, res) => {
        const { password, code } = req.body ?? {};
        if (!store.data.twofa?.enabled) return res.status(409).json({ error: '2FA is not enabled' });
        const okPassword = typeof password === 'string' && auth.check(user, password);
        const okCode = checkSecondFactor(code);
        if (!okPassword || !okCode) return res.status(401).json({ error: 'Invalid password or code' });
        store.data.twofa = null;
        store.save();
        res.json({ ok: true });
      });
    }
  };
}
