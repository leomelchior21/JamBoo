import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCategory,
  detectMetric,
  normalizeResearchQuery,
  resolveCategoryWindow,
  resolveDateWindow,
} from '../api/knowledge-router.mjs';

const NOW = new Date('2026-03-15T12:00:00.000Z');

test('classifies math, current, historical, and timeless categories', () => {
  assert.equal(classifyCategory('Multiplication tables', 'Math practice', { now: NOW }), 'math');
  assert.equal(classifyCategory('Fractions', 'Matemática', { now: NOW }), 'math');
  assert.equal(classifyCategory('Latest records', 'Olympics', { now: NOW }), 'current');
  assert.equal(classifyCategory('Most streamed songs', 'Olivia Rodrigo', { now: NOW }), 'current');
  assert.equal(classifyCategory('SpaceX missions in 2025', 'SpaceX', { now: NOW }), 'historical');
  assert.equal(classifyCategory('Most streamed song in 2023', 'Olivia Rodrigo', { now: NOW }), 'historical');
  assert.equal(classifyCategory('Songs', 'Olivia Rodrigo', { now: NOW }), 'timeless');
  assert.equal(classifyCategory('Mars geography', 'SpaceX, Mars', { now: NOW }), 'timeless');
  assert.equal(classifyCategory('Career', 'Missions this year', { now: NOW }), 'current');
});

test('normalizes relative and explicit dates into event windows', () => {
  assert.deepEqual(resolveDateWindow('most played song of last year', NOW), {
    eventFrom: '2025-01-01',
    eventTo: '2025-12-31',
    asOf: null,
    years: [2025],
    label: '2025',
  });
  assert.deepEqual(resolveDateWindow('released in 2023', NOW).eventFrom, '2023-01-01');
  assert.deepEqual(resolveDateWindow('released in 2023', NOW).eventTo, '2023-12-31');
  assert.deepEqual(resolveDateWindow('between 2018 and 2021', NOW).years, [2018, 2019, 2020, 2021]);
  assert.deepEqual(resolveDateWindow('the 1990s', NOW).years, [1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999]);
  assert.equal(resolveDateWindow('this year', NOW).years[0], 2026);
  assert.equal(resolveDateWindow('today', NOW).asOf, NOW.toISOString());
  assert.equal(resolveDateWindow('no period here', NOW), null);
});

test('date windows and current words do not leak across topic fragments', () => {
  const topic = 'Multiplication tables, SpaceX missions in 2025, Planets';
  assert.equal(classifyCategory('Planets', topic, { now: NOW }), 'timeless');
  assert.equal(classifyCategory('SpaceX missions in 2025', topic, { now: NOW }), 'historical');
  assert.equal(resolveCategoryWindow('Planets', topic, NOW), null);
  assert.equal(resolveCategoryWindow('SpaceX missions in 2025', topic, NOW).eventFrom, '2025-01-01');
  assert.equal(classifyCategory('Latest missions', 'SpaceX missions in 2025, Planets', { now: NOW }), 'current');
  assert.equal(classifyCategory('Planets', 'SpaceX missions in 2025, Planets', { now: NOW }), 'timeless');
});

test('normalizes vague metrics into explicit research queries', () => {
  const metric = detectMetric('most played song');
  assert.equal(metric.metric, 'global streams');

  const historical = normalizeResearchQuery('Most played song', 'Olivia Rodrigo', 'historical', resolveDateWindow('2023', NOW));
  assert.equal(historical.ambiguous, false);
  assert.equal(historical.metric, 'global streams');
  assert.equal(historical.query, 'Olivia Rodrigo Most played song 2023');

  const current = normalizeResearchQuery('Most played song', 'Olivia Rodrigo', 'current', { years: [], asOf: NOW.toISOString() });
  assert.equal(current.ambiguous, false);
  assert.equal(current.metric, 'global streams');

  const vague = normalizeResearchQuery('Best albums', 'Olivia Rodrigo', 'current', { years: [], asOf: NOW.toISOString() });
  assert.equal(vague.ambiguous, true);
  assert.equal(vague.query, null);
});
