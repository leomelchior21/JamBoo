// Knowledge router: classifies each board category by how its facts can be
// trusted, and normalizes dates/ambiguity before any LLM or search call.
// MATH      -> deterministic code only
// TIMELESS  -> existing Qwen pipeline guarded by stable reference facts
// HISTORICAL-> defined past period, evidence retrieved for that period
// CURRENT   -> changing fact, live evidence required
export const KNOWLEDGE_ROUTES = Object.freeze(['math', 'timeless', 'historical', 'current']);

const MATH_PATTERN = /\b(?:math|maths|mathematics|arithmetic|addition|subtraction|multiplication|division|fractions?|decimals?|percentages?|percent|algebra|geometry|equations?|times tables?|mental math|calculus|calculo|matematica|matematicas|aritmetica|sumas?|restas?|multiplicaciones?|divisiones?|fracciones?|porcentajes?|geometria|ecuaciones?)\b/i;

const CURRENT_PATTERN = /\b(?:latest|current|currently|today|tonight|now|nowadays|right now|this year|next year|this month|upcoming|recent|recently|rankings?|ranked|standings?|most streamed|most played|most watched|most followed|most subscribed|most popular|record|as of|atualmente|atual|hoje|agora|este ano|mais recente|mais tocadas?|mais ouvidas?|mais vistas?|ultimo|ultima|actualmente|actual|hoy|ahora|mas reciente|mas escuchadas?|mas vistas?)\b/i;

const SUPERLATIVE_PATTERN = /\b(?:most|best|top|highest|lowest|greatest|biggest|largest|smallest|fastest|ranking|ranked|mais|melhor|maior|menor|mas|mejor|mayor|peor)\b/i;

const RELATIVE_PATTERN = /\b(?:as of|reigning|current(?:ly)?|latest|today|tonight|now(?:adays)?|this (?:year|month|week)|recent(?:ly)?|atualmente|atual|hoje|agora|este (?:ano|mes)|mais recente|actualmente|actual|hoy|ahora|este (?:ano|mes)|mas reciente)\b/i;

const RANGE_PATTERN = /\b(1[5-9]\d{2}|20\d{2})\s*(?:-|\u2013|\u2014|to|a|ate|until|through)\s*(1[5-9]\d{2}|20\d{2})\b/i;
const DECADE_PATTERN = /\b(1[5-9]\d{2}|20\d{2})s\b/i;
const YEAR_PATTERN = /\b(1[5-9]\d{2}|20\d{2})\b/g;
const LAST_YEAR_PATTERN = /\b(?:last year|previous year|ano passado|el ano pasado|ultimo ano)\b/i;
const THIS_YEAR_PATTERN = /\b(?:this year|current year|este ano|ano atual|ano actual)\b/i;
const AS_OF_PATTERN = /\b(?:today|tonight|right now|currently|now|hoje|agora|atualmente|hoy|ahora|actualmente)\b/i;

const METRIC_RULES = Object.freeze([
  {
    pattern: /\b(?:most|mais|mas)\s+(?:streamed|played|listened|tocadas?|tocada|ouvidas?|ouvida|escuchadas?|escuchada|reproducidas?|reproducida)\b/i,
    metric: 'global streams',
    query: 'global streams',
  },
  {
    pattern: /\b(?:most|mais|mas)\s+(?:watched|viewed|vistas?|vista|assistidas?|assistida)\b/i,
    metric: 'views',
    query: 'most views',
  },
  {
    pattern: /\b(?:best[- ]selling|mais vendidos?|mais vendidas?|mas vendidos?|mas vendidas?)\b/i,
    metric: 'certified sales',
    query: 'best selling',
  },
  {
    pattern: /\b(?:highest[- ]grossing|maior bilheteria|mayor recaudacion)\b/i,
    metric: 'box office gross',
    query: 'highest grossing',
  },
  {
    pattern: /\b(?:most|mais|mas)\s+(?:followed|seguidores|seguidos?)\b/i,
    metric: 'followers',
    query: 'most followers',
  },
  {
    pattern: /\b(?:most|mais|mas)\s+subscribed\b/i,
    metric: 'subscribers',
    query: 'most subscribers',
  },
]);

function normalizeForMatch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function yearWindow(fromYear, toYear) {
  return {
    eventFrom: `${fromYear}-01-01`,
    eventTo: `${toYear}-12-31`,
    asOf: null,
    years: Array.from({ length: toYear - fromYear + 1 }, (_, index) => fromYear + index),
    label: fromYear === toYear ? String(fromYear) : `${fromYear}-${toYear}`,
  };
}

export function resolveDateWindow(text, now = new Date()) {
  const source = normalizeForMatch(text);
  if (!source) return null;
  const currentYear = now.getFullYear();

  const range = source.match(RANGE_PATTERN);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    return yearWindow(Math.min(start, end), Math.max(start, end));
  }

  const decade = source.match(DECADE_PATTERN);
  if (decade) {
    const start = Number(decade[1]);
    if (start >= 1500 && start <= 2089) return yearWindow(start, start + 9);
  }

  if (LAST_YEAR_PATTERN.test(source)) return yearWindow(currentYear - 1, currentYear - 1);
  if (THIS_YEAR_PATTERN.test(source)) return yearWindow(currentYear, currentYear);

  const years = [...source.matchAll(YEAR_PATTERN)].map(match => Number(match[1]));
  if (years.length) return yearWindow(Math.min(...years), Math.max(...years));

  if (AS_OF_PATTERN.test(source)) {
    return { eventFrom: null, eventTo: null, asOf: now.toISOString(), years: [], label: 'as of now' };
  }
  return null;
}

// Returns the topic fragment that belongs to one category, or the whole topic
// when it was supplied as a single topic. Words written in a different topic
// fragment must not leak into unrelated categories.
function categoryScopeText(category, topic) {
  const topicText = String(topic ?? '').trim();
  if (!topicText) return '';
  const fragments = topicText.split(/[,;|\n]+/).map(fragment => fragment.trim()).filter(Boolean);
  if (fragments.length <= 1) return topicText;

  const categoryKey = normalizeForMatch(category).trim();
  if (!categoryKey) return '';
  const matching = fragments.filter(fragment => {
    const fragmentKey = normalizeForMatch(fragment).trim();
    return fragmentKey && (fragmentKey.includes(categoryKey) || categoryKey.includes(fragmentKey));
  });
  return matching.length === 1 ? matching[0] : '';
}

// Resolves the date window that belongs to one category. A year written in a
// different topic fragment (for example "SpaceX missions in 2025, Planets")
// must not leak into unrelated categories.
export function resolveCategoryWindow(category, topic, now = new Date()) {
  const direct = resolveDateWindow(category, now);
  if (direct) return direct;
  const scope = categoryScopeText(category, topic);
  return scope ? resolveDateWindow(scope, now) : null;
}

export function classifyCategory(category, topic = '', { now = new Date() } = {}) {
  const categoryText = normalizeForMatch(category);
  if (MATH_PATTERN.test(categoryText)) return 'math';

  const window = resolveCategoryWindow(category, topic, now);
  const currentYear = now.getFullYear();
  if (window?.years?.length) {
    return window.years.every(year => year < currentYear) ? 'historical' : 'current';
  }
  if (window?.asOf) return 'current';
  if (CURRENT_PATTERN.test(categoryText)) return 'current';
  if (CURRENT_PATTERN.test(normalizeForMatch(categoryScopeText(category, topic)))) return 'current';
  return 'timeless';
}

export function detectMetric(text) {
  const source = normalizeForMatch(text);
  for (const rule of METRIC_RULES) {
    if (rule.pattern.test(source)) return rule;
  }
  return null;
}

export function normalizeResearchQuery(category, topic, route, window = null) {
  const cleanCategory = String(category ?? '').trim();
  const cleanTopic = String(topic ?? '').trim();
  const metricRule = detectMetric(cleanCategory) ?? detectMetric(cleanTopic);
  const superlative = SUPERLATIVE_PATTERN.test(normalizeForMatch(cleanCategory));

  // A changing, ranked fact without an explicit metric cannot be searched
  // safely. Discard the candidate instead of asking the model to guess.
  if (route === 'current' && superlative && !metricRule) {
    return { query: null, metric: null, ambiguous: true, reason: 'unclear metric for a changing fact' };
  }

  const parts = [];
  const categoryKey = normalizeForMatch(cleanCategory);
  if (cleanTopic && cleanTopic.length <= 80) {
    const topicKey = normalizeForMatch(cleanTopic);
    if (topicKey && !categoryKey.includes(topicKey) && !topicKey.includes(categoryKey)) parts.push(cleanTopic);
  }
  if (cleanCategory) parts.push(cleanCategory);

  const years = window?.years ?? [];
  if (years.length && !years.some(year => categoryKey.includes(String(year)))) {
    parts.push(years.length === 1 ? String(years[0]) : `${years[0]} ${years[years.length - 1]}`);
  }
  if (metricRule && !metricRule.pattern.test(categoryKey)) parts.push(metricRule.query);

  return {
    query: parts.join(' ').replace(/\s+/g, ' ').trim() || null,
    metric: metricRule?.metric ?? null,
    ambiguous: false,
    reason: null,
  };
}

export { RELATIVE_PATTERN as EVIDENCE_RELATIVE_PATTERN };
