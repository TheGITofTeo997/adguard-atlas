import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAuth } from '../server/auth.js';

const make = () => createAuth({ user: 'admin', password: 'correct horse', secret: 'test-secret', secure: false });

function issueToken(auth) {
  let token;
  auth.issue({ cookie: (name, value) => { token = value; } });
  return token;
}
const reqWith = (token) => ({ headers: { cookie: token ? `atlas_session=${token}` : '' } });

afterEach(() => vi.useRealTimers());

describe('auth — credentials', () => {
  it('accepts the right credentials', () => {
    expect(make().check('admin', 'correct horse')).toBe(true);
  });
  it('rejects wrong password or username', () => {
    const auth = make();
    expect(auth.check('admin', 'nope')).toBe(false);
    expect(auth.check('root', 'correct horse')).toBe(false);
  });
});

describe('auth — session cookie', () => {
  it('accepts an issued token', () => {
    const auth = make();
    expect(auth.fromReq(reqWith(issueToken(auth)))).toBeTruthy();
  });
  it('rejects missing, tampered and foreign-secret tokens', () => {
    const auth = make();
    const token = issueToken(auth);
    expect(auth.fromReq(reqWith(null))).toBeNull();
    expect(auth.fromReq(reqWith(token.slice(0, -2) + 'xx'))).toBeNull();
    const other = createAuth({ user: 'admin', password: 'x', secret: 'other-secret' });
    expect(other.fromReq(reqWith(token))).toBeNull();
  });
  it('rejects expired tokens', () => {
    vi.useFakeTimers();
    const auth = make();
    const token = issueToken(auth);
    vi.advanceTimersByTime(13 * 60 * 60 * 1000);
    expect(auth.fromReq(reqWith(token))).toBeNull();
  });
});

describe('auth — require middleware', () => {
  it('redirects unauthenticated page requests to the login page', () => {
    const res = { redirect: vi.fn() };
    make().require({ method: 'GET', headers: {}, accepts: () => true }, res, vi.fn());
    expect(res.redirect).toHaveBeenCalledWith('/login/');
  });
  it('returns 401 JSON for unauthenticated API requests', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    make().require({ method: 'POST', headers: {}, accepts: () => false }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('calls next() with a valid session', () => {
    const auth = make();
    const next = vi.fn();
    auth.require({ ...reqWith(issueToken(auth)), method: 'GET', accepts: () => true }, {}, next);
    expect(next).toHaveBeenCalled();
  });
});
