import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const byte of buf) {
    val = (val << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

export function unbase32(str) {
  let bits = 0, val = 0;
  const out = [];
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    val = (val << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(key, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

export const generateSecret = () => base32(crypto.randomBytes(20));

export function otpauthUri({ secret, account, issuer = 'AdGuard Atlas' }) {
  const i = encodeURIComponent(issuer);
  return `otpauth://totp/${i}:${encodeURIComponent(account)}?secret=${secret}&issuer=${i}&algorithm=SHA1&digits=6&period=30`;
}

/** Returns the matched time-step counter (to store as lastCounter, blocking replays) or null. */
export function verifyTotp(secret, code, lastCounter = -1, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const key = unbase32(secret);
  const step = Math.floor(now / 30000);
  const given = Buffer.from(String(code));
  for (let d = -1; d <= 1; d++) {
    const counter = step + d;
    if (counter > lastCounter && crypto.timingSafeEqual(Buffer.from(hotp(key, counter)), given)) return counter;
  }
  return null;
}
