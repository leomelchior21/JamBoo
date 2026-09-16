import assert from 'node:assert/strict';
import test from 'node:test';

import { VerifiedQuestionCache, cacheTtlMs, evidenceCacheKey } from '../api/question-cache.mjs';

test('stores and returns verified questions within their TTL', () => {
  let now = 1_000_000;
  const cache = new VerifiedQuestionCache({ now: () => now });
  const key = evidenceCacheKey('In 2025, SpaceX launched Starship Flight 8.', 'multiple', 'English');
  const stored = cache.set(key, {
    question: { q: 'Which company launched Starship Flight 8 in 2025?', o: ['SpaceX', 'NASA', 'Blue Origin', 'Roscosmos'], i: 0 },
    evidence: { claim: 'In 2025, SpaceX launched Starship Flight 8.' },
    route: 'historical',
    language: 'English',
  });
  assert.ok(stored);
  assert.ok(cache.get(key));

  now += cacheTtlMs('historical') + 1;
  assert.equal(cache.get(key), null);
});

test('current facts expire faster than historical and timeless facts', () => {
  assert.ok(cacheTtlMs('current') < cacheTtlMs('historical'));
  assert.ok(cacheTtlMs('historical') < cacheTtlMs('timeless'));
  assert.equal(cacheTtlMs('math'), 0);
});

test('never caches math facts and clears safely', () => {
  const cache = new VerifiedQuestionCache();
  const key = evidenceCacheKey('6 × 7 = 42', 'open', 'English');
  assert.equal(cache.set(key, { question: { q: 'What is 6 × 7?', a: '42' }, route: 'math' }), null);
  const stored = cache.set(key, { question: { q: 'What is 6 × 7?', a: '42' }, route: 'timeless' });
  assert.ok(stored);
  cache.clear();
  assert.equal(cache.size, 0);
});

test('evidence cache keys are stable and language aware', () => {
  const english = evidenceCacheKey('The sky is blue', 'open', 'English');
  assert.equal(english, evidenceCacheKey('The sky is blue', 'open', 'English'));
  assert.notEqual(english, evidenceCacheKey('The sky is blue', 'open', 'Portuguese'));
  assert.notEqual(english, evidenceCacheKey('The sky is blue', 'drawing', 'English'));
});
