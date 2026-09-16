// Modular retrieval layer. `SearchProvider` is the only contract the quiz
// engine talks to, so a real web-search API can be plugged in through
// environment variables without touching generation logic. Everything here
// runs server-side only.
import { EVIDENCE_RELATIVE_PATTERN } from './knowledge-router.mjs';

const WIKIPEDIA_LANGUAGES = Object.freeze({
  English: { host: 'en.wikipedia.org', locale: 'en' },
  Portuguese: { host: 'pt.wikipedia.org', locale: 'pt' },
  Spanish: { host: 'es.wikipedia.org', locale: 'es' },
});

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RESULT_LIMIT = 3;
const CURRENT_EVIDENCE_MAX_AGE_DAYS = 45;

export function localeForLanguage(language) {
  return WIKIPEDIA_LANGUAGES[language]?.locale ?? 'en';
}

export function isLiveSearchConfigured() {
  return Boolean(process.env.SEARCH_API_URL?.trim());
}

function readPath(value, path) {
  return String(path ?? '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current && typeof current === 'object' ? current[key] : undefined), value);
}

async function fetchWithTimeout(url, init, { signal, timeoutMs }) {
  const controller = new AbortController();
  const relay = () => controller.abort();
  signal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}

export class SearchProvider {
  constructor(name) {
    this.name = name;
  }

  get configured() {
    return false;
  }

  async search(_query, _options) {
    return [];
  }
}

export class WikipediaSearchProvider extends SearchProvider {
  constructor(language = 'English') {
    super('Wikipedia');
    this.language = WIKIPEDIA_LANGUAGES[language] ? language : 'English';
  }

  get configured() {
    return true;
  }

  async search(query, { limit = DEFAULT_RESULT_LIMIT, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const wikipedia = WIKIPEDIA_LANGUAGES[this.language];
    const endpoint = new URL(`https://${wikipedia.host}/w/api.php`);
    endpoint.search = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '0',
      gsrlimit: String(limit),
      prop: 'extracts|info',
      inprop: 'url',
      exintro: '1',
      explaintext: '1',
      exchars: '900',
      format: 'json',
      formatversion: '2',
    });

    const response = await fetchWithTimeout(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'JamBooQuiz/1.0',
      },
    }, { signal, timeoutMs });
    if (!response.ok) throw new Error(`Wikipedia returned HTTP ${response.status}`);

    const body = await response.json();
    const pages = Array.isArray(body?.query?.pages)
      ? [...body.query.pages].sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      : [];
    return pages
      .map(page => ({
        title: String(page.title ?? '').trim(),
        extract: typeof page.extract === 'string' ? page.extract.replace(/\s+/g, ' ').trim() : '',
        url: typeof page.fullurl === 'string' ? page.fullurl : null,
        sourceDate: null,
        provider: this.name,
        locale: wikipedia.locale,
      }))
      .filter(item => item.extract);
  }
}

// Generic adapter for an HTTP JSON search API. The endpoint receives
// {query, max_results} as JSON and is expected to answer with a results
// array (results path configurable). A specific vendor can be supported by
// adding a small subclass without changing the quiz engine.
export class HttpSearchProvider extends SearchProvider {
  constructor({ url, key = null, resultsPath = 'results', name = 'WebSearch', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    super(name);
    this.url = url ?? null;
    this.key = key;
    this.resultsPath = resultsPath;
    this.timeoutMs = timeoutMs;
  }

  get configured() {
    return Boolean(this.url);
  }

  async search(query, { limit = DEFAULT_RESULT_LIMIT, signal, timeoutMs = this.timeoutMs } = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.key) headers.Authorization = `Bearer ${this.key}`;

    const response = await fetchWithTimeout(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, max_results: limit }),
    }, { signal, timeoutMs });
    if (!response.ok) throw new Error(`Search provider returned HTTP ${response.status}`);

    const body = await response.json();
    const results = readPath(body, this.resultsPath);
    return (Array.isArray(results) ? results : [])
      .map(item => ({
        title: String(item?.title ?? item?.name ?? '').trim(),
        extract: String(item?.content ?? item?.snippet ?? item?.extract ?? item?.description ?? item?.text ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
        url: item?.url ?? item?.link ?? null,
        sourceDate: item?.published_date ?? item?.publishedDate ?? item?.date ?? null,
        provider: this.name,
        locale: null,
      }))
      .filter(item => item.extract)
      .slice(0, limit);
  }
}

// Ordered providers per route. CURRENT facts require live search; when no
// web provider is configured the category fails safely instead of letting
// the model recall a changing fact.
export function getSearchProviders(route, language) {
  const providers = [];
  if (isLiveSearchConfigured()) {
    providers.push(new HttpSearchProvider({
      url: process.env.SEARCH_API_URL.trim(),
      key: process.env.SEARCH_API_KEY?.trim() || null,
      resultsPath: process.env.SEARCH_API_RESULTS_PATH?.trim() || 'results',
      name: process.env.SEARCH_API_NAME?.trim() || 'WebSearch',
    }));
  }
  if (route !== 'current') providers.push(new WikipediaSearchProvider(language));
  return providers;
}

export async function collectEvidence(providers, query, { limit = DEFAULT_RESULT_LIMIT, minimum = 1, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const items = [];
  for (const provider of providers) {
    if (items.length >= minimum) break;
    if (!provider.configured) continue;
    try {
      const results = await provider.search(query, { limit, signal, timeoutMs });
      items.push(...results);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(`[evidence] provider ${provider.name} failed: ${error.message}`);
    }
  }
  return items;
}

function createSegmenter(locale) {
  return typeof Intl?.Segmenter === 'function'
    ? new Intl.Segmenter(locale, { granularity: 'sentence' })
    : null;
}

function isFreshEnough(sourceDate, now) {
  if (!sourceDate) return true;
  const parsed = Date.parse(sourceDate);
  if (!Number.isFinite(parsed)) return true;
  return now.getTime() - parsed <= CURRENT_EVIDENCE_MAX_AGE_DAYS * 86400000;
}

function isUsableEvidenceFact(text, { route, window, title = '', sourceDate = null, now = new Date() }) {
  if (!text || text.length < 35 || text.length > 360) return false;
  if (/\.{3}$|\u2026$/.test(text)) return false;

  if (route === 'current') return isFreshEnough(sourceDate, now);

  if (EVIDENCE_RELATIVE_PATTERN.test(text)) return false;

  if (route === 'historical') {
    const years = window?.years ?? [];
    if (years.length) {
      const textHasYear = years.some(year => text.includes(String(year)));
      const titleHasYear = years.some(year => String(title).includes(String(year)));
      if (!textHasYear && !titleHasYear) return false;
    }
  }
  return true;
}

// Converts provider results into stable evidence facts: {title, text, ...}.
export function extractEvidenceFacts(items, {
  route = 'timeless',
  window = null,
  locale = 'en',
  minimumFacts = 1,
  limit = 12,
  now = new Date(),
} = {}) {
  const segmenter = createSegmenter(locale);
  const facts = [];
  const seen = new Set();
  const target = Math.min(limit, minimumFacts + 4);

  for (const item of items) {
    const extract = typeof item?.extract === 'string' ? item.extract.replace(/\s+/g, ' ').trim() : '';
    if (!extract) continue;
    const sentences = segmenter
      ? Array.from(segmenter.segment(extract), part => part.segment)
      : (extract.match(/[^.!?]+[.!?]+/g) ?? [extract]);
    for (const sentence of sentences) {
      const text = sentence.trim();
      if (!isUsableEvidenceFact(text, { route, window, title: item.title, sourceDate: item.sourceDate, now })) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
        title: item.title,
        text,
        source: item.provider,
        url: item.url ?? null,
        sourceDate: item.sourceDate ?? null,
      });
      if (facts.length >= target) return facts;
    }
  }
  return facts;
}

export function createEvidenceObject(fact, { route, metric = null, window = null, now = new Date() } = {}) {
  const sourceLabel = fact.url ? `${fact.source}: ${fact.title} (${fact.url})` : `${fact.source}: ${fact.title}`;
  return {
    claim: fact.text,
    answer: null,
    metric,
    eventFrom: window?.eventFrom ?? null,
    eventTo: window?.eventTo ?? null,
    asOf: window?.asOf ?? null,
    source: sourceLabel,
    sourceDate: fact.sourceDate ?? null,
    verifiedAt: now.toISOString(),
    route,
  };
}
