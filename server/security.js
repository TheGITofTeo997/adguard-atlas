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
      try { if (![req.headers.host, req.host].includes(new URL(origin).host)) throw new Error('cross-origin'); }
      catch { return res.status(403).json({ error: 'forbidden' }); }
    }
    next();
  };

  function saveSecurity(res, patch) {
    try {
      store.update(patch);
      return true;
    } catch {
      res.status(503).json({ error: 'Could not save 2FA settings. Check that the Docker /data volume is writable.' });
      return false;
    }
  }

  /** TOTP code (replay-protected) or one-time recovery code. */
  function checkSecondFactor(code) {
    const t = store.data.twofa;
    if (!t?.enabled) return { error: 'Two-factor authentication is unavailable' };
    const c = String(code ?? '').replace(/\s/g, '');
    if (/^\d{6}$/.test(c)) {
      const counter = verifyTotp(t.secret, c);
      if (counter === null) return { error: 'Invalid code. Check the time on your authenticator device.' };
      if (counter <= (t.lastCounter ?? -1)) return { error: 'This code was already used. Wait for the next code.' };
      return { state: { ...t, lastCounter: counter } };
    }
    const recovery = t.recovery ?? [];
    const i = recovery.indexOf(sha(normRecovery(c)));
    if (i === -1) return { error: 'Invalid recovery code' };
    return { state: { ...t, recovery: recovery.filter((_, index) => index !== i) } };
  }

  return {
    publicRoutes(app) {
      app.post('/api/login', sameOrigin, limiter, json, (req, res) => {
        const { username, password, remember } = req.body ?? {};
        if (typeof username !== 'string' || typeof password !== 'string' || !auth.check(username, password)) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (store.data.twofa?.enabled) {
          const id = crypto.randomBytes(8).toString('hex');
          return res.json({ twofa: true, ticket: auth.seal({ k: '2fa', id, remember: remember === true }, TICKET_TTL) });
        }
        auth.issue(res, remember);
        res.json({ ok: true });
      });

      app.post('/api/login/2fa', sameOrigin, limiter, json, (req, res) => {
        const ticket = auth.unseal(req.body?.ticket);
        if (!ticket || ticket.k !== '2fa') return res.status(401).json({ error: 'Session expired, sign in again' });
        const failed = attempts.get(ticket.id) ?? 0;
        if (failed >= MAX_TICKET_ATTEMPTS) return res.status(429).json({ error: 'Too many attempts, sign in again' });
        const factor = checkSecondFactor(req.body?.code);
        if (factor.error) {
          if (attempts.size > 1000) attempts.clear();
          attempts.set(ticket.id, failed + 1);
          return res.status(401).json({ error: factor.error });
        }
        if (!saveSecurity(res, { twofa: factor.state })) return;
        attempts.set(ticket.id, MAX_TICKET_ATTEMPTS);
        auth.issue(res, ticket.remember);
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
        const uri = otpauthUri({ secret, account: user });
        const qr = await QRCode.toDataURL(uri, { margin: 4, width: 240 });
        if (!saveSecurity(res, { pending: { secret, created: Date.now() } })) return;
        res.json({ secret, otpauth: uri, qr });
      });

      app.post('/api/2fa/enable', sameOrigin, limiter, json, (req, res) => {
        const p = store.data.pending;
        if (!p || Date.now() - p.created > 15 * 60 * 1000) return res.status(400).json({ error: 'Setup expired, start again' });
        const counter = verifyTotp(p.secret, String(req.body?.code ?? '').replace(/\s/g, ''));
        if (counter === null) return res.status(401).json({ error: 'Invalid code' });
        const codes = Array.from({ length: 8 }, () => {
          const h = crypto.randomBytes(5).toString('hex');
          return `${h.slice(0, 5)}-${h.slice(5)}`;
        });
        const twofa = { enabled: true, secret: p.secret, lastCounter: counter, recovery: codes.map((c) => sha(normRecovery(c))) };
        if (!saveSecurity(res, { twofa, pending: null })) return;
        res.json({ recoveryCodes: codes });
      });

      app.post('/api/2fa/disable', sameOrigin, limiter, json, (req, res) => {
        const { password, code } = req.body ?? {};
        if (!store.data.twofa?.enabled) return res.status(409).json({ error: '2FA is not enabled' });
        const okPassword = typeof password === 'string' && auth.check(user, password);
        if (!okPassword) return res.status(401).json({ error: 'Invalid password or code' });
        const factor = checkSecondFactor(code);
        if (factor.error) return res.status(401).json({ error: factor.error });
        if (!saveSecurity(res, { twofa: null, pending: null })) return;
        res.json({ ok: true });
      });
    }
  };
}

