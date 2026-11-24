import fs from 'node:fs';
import path from 'node:path';

/**
 * Tiny JSON file store for server-side state (2FA). Pass dir=null for in-memory only.
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

