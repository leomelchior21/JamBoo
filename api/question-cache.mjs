// Verified question cache. Entries carry the evidence metadata they were
// generated from. Warm serverless instances reuse them; cold instances simply
// start empty, which is safe because every entry is revalidated against a
// fresh evidence retrieval before reuse.
import { normalizeText } from './quiz-core.mjs';

const TTL_MS = Object.freeze({
  timeless: 30 * 24 * 60 * 60 * 1000,
  historical: 7 * 24 * 60 * 60 * 1000,
  current: 6 * 60 * 60 * 1000,
  math: 0,
});

export function cacheTtlMs(route) {
  return TTL_MS[route] ?? 0;
}

export function evidenceCacheKey(claim, questionType, language) {
  return `${language}|${questionType}|${normalizeText(claim).slice(0, 160)}`;
}

export class VerifiedQuestionCache {
  constructor({ now = () => Date.now(), maxEntries = 400 } = {}) {
    this.entries = new Map();
    this.now = now;
    this.maxEntries = maxEntries;
  }

  get size() {
    this.prune();
    return this.entries.size;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  set(key, { question, evidence = null, route = 'timeless', language = 'English' } = {}) {
    if (!key || !question) return null;
    const ttl = cacheTtlMs(route);
    if (ttl <= 0) return null;
    const storedAt = this.now();
    const entry = {
      question,
      evidence,
      route,
      language,
      storedAt,
      expiresAt: storedAt + ttl,
    };
    this.entries.set(key, entry);
    this.prune();
    return entry;
  }

  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
  }

  clear() {
    this.entries.clear();
  }
}

export const verifiedQuestionCache = new VerifiedQuestionCache();
