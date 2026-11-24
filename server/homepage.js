import { createHash, timingSafeEqual } from 'node:crypto';

const MINUTE_MS = 60_000;
const WINDOW_MINUTES = 15;
const digest = value => createHash('sha256').update(value).digest();

export class HomepageMetrics {
  #buckets = new Map();

  #activeMinute(now) {
    const minute = Math.floor(now / MINUTE_MS);
    for (const key of this.#buckets.keys()) {
      if (key <= minute - WINDOW_MINUTES) this.#buckets.delete(key);
    }
    return minute;
  }

  record(timestamp, lookups, now = Date.now()) {
    const minute = this.#activeMinute(now);
    const queryMinute = Math.min(Math.floor(Number(timestamp) / MINUTE_MS), minute);
    if (!Number.isFinite(queryMinute) || queryMinute <= minute - WINDOW_MINUTES) return;

    const countries = new Set(lookups.map(({ destination }) => destination?.country?.trim()));
    countries.delete(undefined);
    countries.delete('');
    countries.delete('Unknown');
    if (!countries.size) return;

    const counts = this.#buckets.get(queryMinute) ?? new Map();
    for (const country of countries) counts.set(country, (counts.get(country) ?? 0) + 1);
    this.#buckets.set(queryMinute, counts);
  }

  snapshot(now = Date.now()) {
    this.#activeMinute(now);
    const totals = new Map();
    for (const counts of this.#buckets.values()) {
      for (const [country, hits] of counts) totals.set(country, (totals.get(country) ?? 0) + hits);
    }
    const [topCountry, topCountryHits] = [...totals].sort(
      ([countryA, hitsA], [countryB, hitsB]) => hitsB - hitsA || countryA.localeCompare(countryB, 'en')
    )[0] ?? ['—', 0];
    return { topCountry, topCountryHits, countriesReached: totals.size, windowMinutes: WINDOW_MINUTES };
  }
}

export function createHomepageHandler(token, metrics) {
  const expected = token ? digest(token) : null;
  return (req, res) => {
    if (!expected) return res.status(404).json({ error: 'Homepage integration disabled' });
    const supplied = req.get('X-Atlas-Token');
    if (!supplied || !timingSafeEqual(digest(supplied), expected)) {
      return res.status(401).json({ error: 'Invalid Homepage token' });
    }
    return res.json(metrics.snapshot());
  };
}

