// Topic styles shape how questions should feel. The planner model classifies
// the board topic into one of these; a deterministic keyword classifier is the
// fallback for direct API calls or when the model omits the field.
export const TOPIC_STYLES = Object.freeze(['celebrity', 'games', 'sports', 'code', 'math', 'general']);

const STYLE_PATTERNS = [
  {
    style: 'games',
    pattern: /\b(?:games?|videogames?|video games?|jogos?|videojuegos?|roblox|minecraft|fortnite|mario|zelda|pokemon|gta|valorant|league of legends|among us|sonic|kirby|metroid|halo|overwatch|cs2|counter[- ]strike|clash royale|clash of clans|brawl stars|free fire|pubg|terraria|stardew|animal crossing|board ?games?|chess|xadrez|ajedrez)\b/i,
  },
  {
    style: 'sports',
    pattern: /\b(?:sports?|esportes?|deportes?|soccer|football|futebol|futbol|basketball|basquete|basquetbol|baseball|beisebol|tennis|tenis|volleyball|olympics?|olimpiadas?|nba|nfl|mlb|nhl|ufc|cricket|rugby|formula 1|formula one|motogp|world cup|copa do mundo|champions league|premier league)\b/i,
  },
  {
    style: 'celebrity',
    pattern: /\b(?:celebrit(?:y|ies)|celebridades?|famosos?|famosas?|singers?|cantores?|cantoras?|actors?|actress(?:es)?|atores?|atrizes?|musicians?|musicos?|artists?|artistas?|rappers?|bands?|bandas?|youtubers?|streamers?|influencers?|tiktokers?|authors?|escritores?|directors?|diretores?)\b/i,
  },
  {
    style: 'code',
    pattern: /\b(?:code|coding|programming|programacao|programacion|programar|python|javascript|typescript|scratch|arduino|html|css|java|robotics|robotica|computer science|computacao|informatica|computacion)\b/i,
  },
  {
    style: 'math',
    pattern: /\b(?:math|maths|mathematics|matematica|matematicas|arithmetic|aritmetica|algebra|geometr(?:y|ia)|fractions?|fracoes?|fracciones?|equations?|equacoes?|ecuaciones?)\b/i,
  },
];

function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function normalizeTopicStyle(value) {
  const normalized = fold(value).trim();
  return TOPIC_STYLES.includes(normalized) ? normalized : null;
}

export function classifyTopicStyle(topic) {
  const text = fold(topic);
  if (!text) return 'general';
  for (const rule of STYLE_PATTERNS) {
    if (rule.pattern.test(text)) return rule.style;
  }
  return 'general';
}

export function resolveTopicStyle(value, topic) {
  return normalizeTopicStyle(value) ?? classifyTopicStyle(topic);
}

const STYLE_ANGLES = Object.freeze({
  celebrity: 'career milestones, signature works, collaborations, awards, chart firsts, tours, and behind-the-scenes stories',
  games: 'game history, gameplay characteristics, characters, story and setting, developer, platform, and release facts',
  sports: 'records, legendary moments, firsts, rules trivia, iconic venues, nicknames, and rivalries',
  code: 'core concepts, how things work, debugging situations, choosing the right structure, and real-world applications',
  math: 'real-world applications, number patterns, estimation, and reasoning steps',
  general: 'foundations, key examples, how it works, patterns, applications, and connections',
});

export function styleAngles(style) {
  return STYLE_ANGLES[normalizeTopicStyle(style) ?? 'general'];
}

// Extra rules added to question-generation prompts.
export function styleInstruction(style, { preCoding = false } = {}) {
  switch (normalizeTopicStyle(style)) {
    case 'celebrity':
      return 'Question style: fun fact or trivia about this celebrity\'s career. Ask about debuts, breakthroughs, collaborations, signature works, awards, chart or box-office firsts, tours, or record milestones. Use only stable career facts. Never ask about private life, relationships, gossip, or changing numbers.';
    case 'games':
      return 'Question style: game trivia. Cover the game\'s history (release, developer, platform), characteristics (genre, mechanics, modes), characters (heroes, villains, allies), or story (setting, plot). Fun-fact tone with well-known, settled details.';
    case 'sports':
      return 'Question style: sports fun facts. Ask about records, firsts, iconic moments, rules trivia, nicknames, or famous venues. Prefer historical, settled facts over current standings.';
    case 'code':
      return preCoding
        ? 'Question style: computational-thinking trivia. Ask what a concept means, which everyday process matches it, or the best plain-language choice in a described situation. Never require code, syntax, or tool names.'
        : 'Question style: coding trivia. Ask what a concept or tool does, trace a short described sequence, pick the right structure for a situation, or identify a bug from a described symptom. Real snippets are allowed only when the topic clearly names a language.';
    case 'math':
      return 'Question style: math reasoning. Use real-world contexts and multi-step reasoning; arithmetic answers are computed by the server, so ask for the reasoning or the matching end result.';
    default:
      return '';
  }
}
