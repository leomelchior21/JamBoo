import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HttpSearchProvider,
  WikipediaSearchProvider,
  createEvidenceObject,
  extractEvidenceFacts,
  getSearchProviders,
  isLiveSearchConfigured,
} from '../api/search-provider.mjs';

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() { return body; },
  };
}

test('wikipedia provider maps API pages into evidence items', async () => {
  globalThis.fetch = async () => jsonResponse({
    query: {
      pages: [
        { index: 2, title: 'Second', extract: 'Second extract.', fullurl: 'https://en.wikipedia.org/wiki/Second' },
        { index: 1, title: 'First', extract: 'First extract.', fullurl: 'https://en.wikipedia.org/wiki/First' },
      ],
    },
  });
  const provider = new WikipediaSearchProvider('English');
  assert.equal(provider.configured, true);
  const items = await provider.search('anything', { limit: 2 });
  assert.deepEqual(items.map(item => item.title), ['First', 'Second']);
  assert.equal(items[0].url, 'https://en.wikipedia.org/wiki/First');
  assert.equal(items[0].provider, 'Wikipedia');
});

test('http search provider stays disabled until a URL is configured', () => {
  const unconfigured = new HttpSearchProvider({});
  assert.equal(unconfigured.configured, false);
  const configured = new HttpSearchProvider({ url: 'https://search.test/api' });
  assert.equal(configured.configured, true);
});

test('http search provider maps a configurable results path', async () => {
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.query, 'olivia rodrigo');
    assert.equal(request.max_results, 2);
    return jsonResponse({
      web: {
        results: [
          { title: 'A', snippet: 'Snippet A', link: 'https://a.test', published_date: '2026-01-02' },
          { title: 'B', content: 'Content B' },
        ],
      },
    });
  };
  const provider = new HttpSearchProvider({ url: 'https://search.test/api', key: 'secret', resultsPath: 'web.results' });
  const items = await provider.search('olivia rodrigo', { limit: 2 });
  assert.deepEqual(items.map(item => item.extract), ['Snippet A', 'Content B']);
  assert.equal(items[0].sourceDate, '2026-01-02');
});

test('extracts only usable historical evidence tied to the period', () => {
  const window = {
    eventFrom: '2025-01-01',
    eventTo: '2025-12-31',
    asOf: null,
    years: [2025],
  };
  const items = [
    {
      title: 'Starship',
      extract: 'In 2025, SpaceX launched Starship Flight 8 from Starbase in Texas. The vehicle splashed down in the ocean. The company later updated the launch pad in Florida.',
      provider: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Starship',
      sourceDate: null,
    },
    {
      title: 'Unrelated page',
      extract: 'This sentence has no period at all and should be filtered out completely because it is too short.',
      provider: 'Wikipedia',
      url: null,
      sourceDate: null,
    },
  ];
  const facts = extractEvidenceFacts(items, { route: 'historical', window, locale: 'en' });
  assert.equal(facts.length, 1);
  assert.match(facts[0].text, /2025/);
  assert.ok(facts.every(fact => !/current|latest|today|now/i.test(fact.text)));
  assert.ok(facts.every(fact => fact.source && fact.url === 'https://en.wikipedia.org/wiki/Starship'));
});

test('builds evidence objects with provenance and verification time', () => {
  const now = new Date('2026-03-15T12:00:00.000Z');
  const evidence = createEvidenceObject({
    title: 'Starship',
    text: 'In 2025, SpaceX launched Starship Flight 8 from Starbase in Texas.',
    source: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Starship',
    sourceDate: null,
  }, {
    route: 'historical',
    metric: 'launches',
    window: { eventFrom: '2025-01-01', eventTo: '2025-12-31', asOf: null },
    now,
  });
  assert.deepEqual(evidence, {
    claim: 'In 2025, SpaceX launched Starship Flight 8 from Starbase in Texas.',
    answer: null,
    metric: 'launches',
    eventFrom: '2025-01-01',
    eventTo: '2025-12-31',
    asOf: null,
    source: 'Wikipedia: Starship (https://en.wikipedia.org/wiki/Starship)',
    sourceDate: null,
    verifiedAt: now.toISOString(),
    route: 'historical',
  });
});

test('current categories require a live provider while historical falls back to Wikipedia', () => {
  delete process.env.SEARCH_API_URL;
  assert.equal(isLiveSearchConfigured(), false);
  assert.equal(getSearchProviders('current', 'English').length, 0);
  assert.equal(getSearchProviders('historical', 'English').length, 1);
  assert.equal(getSearchProviders('timeless', 'English').length, 1);

  process.env.SEARCH_API_URL = 'https://search.test/api';
  assert.equal(isLiveSearchConfigured(), true);
  assert.equal(getSearchProviders('current', 'English').length, 1);
  assert.equal(getSearchProviders('historical', 'English').length, 2);
  delete process.env.SEARCH_API_URL;
});
