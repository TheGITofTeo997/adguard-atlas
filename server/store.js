import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * JSON file store for 2FA and the session signing key. Pass dir=null for in-memory only.
 * State changes are committed only after the new file has been written.
 */
export function createStore(dir) {
  const state = { twofa: null, pending: null };
  let file = null;
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      file = path.join(dir, 'atlas.json');
      if (fs.existsSync(file)) Object.assign(state, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (err) {
      console.warn(`⚠️  Data directory ${dir} not usable (${err.message}): settings like 2FA will NOT persist across restarts`);
      file = null;
    }
  }
  return {
    data: state,
    sessionSecret() {
      if (typeof state.sessionSecret === 'string' && /^[0-9a-f]{64}$/.test(state.sessionSecret)) {
        return state.sessionSecret;
      }
      const sessionSecret = crypto.randomBytes(32).toString('hex');
      try {
        this.update({ sessionSecret });
      } catch {
        console.warn('Could not save the session signing key. Set SESSION_SECRET or make DATA_DIR writable to keep sessions across restarts.');
      }
      return sessionSecret;
    },
    get persistent() { return file !== null; },
    update(patch) {
      const next = { ...state, ...patch };
      if (!dir) {
        Object.assign(state, next);
        return;
      }
      if (!file) throw new Error('2FA data directory is unavailable');
      try {
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
        fs.renameSync(tmp, file);
        Object.assign(state, next);
      } catch (err) {
        console.error('Failed to persist data:', err.message);
        throw err;
      }
    }
  };
}

