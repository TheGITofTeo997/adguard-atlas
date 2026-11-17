import { describe, it, expect } from 'vitest';
import { base32, unbase32, verifyTotp, generateSecret, otpauthUri } from '../server/totp.js';

// RFC 6238 test secret: ASCII "12345678901234567890"
const RFC_SECRET = base32(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('base32 round-trips', () => {
    const buf = Buffer.from('hello world, atlas');
    expect(unbase32(base32(buf)).equals(buf)).toBe(true);
  });
  it('matches the RFC 6238 vector (t=59s → 287082)', () => {
    expect(verifyTotp(RFC_SECRET, '287082', -1, 59_000)).toBe(1);
  });
  it('rejects wrong codes and malformed input', () => {
    expect(verifyTotp(RFC_SECRET, '000000', -1, 59_000)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abc', -1, 59_000)).toBeNull();
  });
  it('blocks replay of an already used time step', () => {
    expect(verifyTotp(RFC_SECRET, '287082', 1, 59_000)).toBeNull();
  });
  it('builds an otpauth URI', () => {
    const uri = otpauthUri({ secret: generateSecret(), account: 'admin' });
    expect(uri.startsWith('otpauth://totp/AdGuard%20Atlas:admin?secret=')).toBe(true);
  });
});
