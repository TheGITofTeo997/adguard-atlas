import fs from 'node:fs';
import path from 'node:path';

/**
 * Tiny JSON file store for server-side state (2FA). Pass dir=null for in-memory only.
 * If the directory is not writable the app keeps working but nothing persists.
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
    save() {
      if (!file) return;
      try {
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
        fs.renameSync(tmp, file);
      } catch (err) {
        console.error('Failed to persist data:', err.message);
      }
    }
  };
}
