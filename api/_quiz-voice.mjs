export const TOPIC_VOICES = Object.freeze([
  'celebrity',
  'games',
  'sports',
  'music',
  'movies',
  'history',
  'science',
  'geography',
  'code',
  'math',
  'general',
]);

const VOICE_RULES = Object.freeze([
  {
    voice: 'games',
    pattern: /\b(?:games?|videogames?|video games?|e-?sports?|jogos?|videojuegos?|roblox|minecraft|fortnite|mario|zelda|pokemon|gta|valorant|league of legends|among us|sonic|kirby|metroid|halo|overwatch|counter[- ]strike|clash royale|clash of clans|brawl stars|free fire|pubg|terraria|stardew|animal crossing|board ?games?|chess|xadrez|ajedrez)\b/i,
  },
  {
    voice: 'music',
    pattern: /\b(?:music|musica|musique|bands?|bandas?|albums?|discos?|songs?|musicas?|canciones?|rock|pop|jazz|k-?pop|hip[- ]?hop|rappers?|guitar|guitarra|piano|violin|drums|beatles|taylor swift|beyonce|drake|billie eilish)\b/i,
  },
  {
    voice: 'movies',
    pattern: /\b(?:movies?|films?|cinema|series?|netflix|disney|pixar|anime|manga|cartoons?|desenhos?|marvel|dc comics|harry potter|star wars|senhor dos aneis|lord of the rings)\b/i,
  },
  {
    voice: 'sports',
    pattern: /\b(?:sports?|esportes?|deportes?|soccer|football|futebol|futbol|basketball|basquete|basquetbol|baseball|beisebol|tennis|tenis|volleyball|olympics?|olimpiadas?|nba|nfl|mlb|nhl|ufc|cricket|rugby|formula 1|formula one|motogp|world cup|copa do mundo|champions league|premier league)\b/i,
  },
  {
    voice: 'celebrity',
    pattern: /\b(?:celebrit(?:y|ies)|celebridades?|famosos?|famosas?|singers?|cantores?|cantoras?|actors?|actress(?:es)?|atores?|atrizes?|musicians?|musicos?|artists?|artistas?|directors?|diretores?|youtubers?|streamers?|influencers?|tiktokers?|authors?|escritores?)\b/i,
  },
  {
    voice: 'code',
    pattern: /\b(?:code|coding|programming|programacao|programacion|programar|python|javascript|typescript|scratch|arduino|html|css|java|robotics|robotica|computer science|computacao|informatica|computacion)\b/i,
  },
  {
    voice: 'math',
    pattern: /\b(?:math|maths|mathematics|matematica|matematicas|arithmetic|aritmetica|algebra|geometr(?:y|ia)|fractions?|fracoes?|fracciones?|equations?|equacoes?|ecuaciones?|percentages?|porcentagem|multiplication|multiplicacao|division|divisao)\b/i,
  },
  {
    voice: 'geography',
    pattern: /\b(?:geography|geografia|countries|paises|flags?|bandeiras|continents?|continentes|capitals?|capitais|rivers?|rios|mountains?|montanhas|oceans?|oceanos|maps?|mapas|volcanoes?|volcanes?|vulcoes?)\b/i,
  },
  {
    voice: 'science',
    pattern: /\b(?:science|ciencia|biology|biologia|physics|fisica|chemistry|quimica|space|espaco|planets?|planetas?|solar system|sistema solar|human body|corpo humano|animals?|animais|plants?|plantas|atoms?|energia|gravity|gravidade|ecosystems?|ecossistemas?|dinosaurs?|dinossauros?)\b/i,
  },
  {
    voice: 'history',
    pattern: /\b(?:history|historia|revolution|revolucao|revolucion|wars?|guerras?|empires?|imperios?|ancient|antiga|antiguidade|medieval|kings?|queens?|reis|rainhas|independence|independencia|civil rights|direitos civis|cold war|guerra fria|pharaohs?|faraos?|pyramids?|piramides?)\b/i,
  },
]);

const VOICE_INSTRUCTIONS = Object.freeze({
  celebrity: "Voice: playful pop-culture energy. Ask about career firsts, signature works, famous collaborations, stage moments and milestones that fans know by heart. Stay on public career facts.",
  games: 'Voice: gamer trivia-night energy. Ask about origins, characters, memorable levels, gameplay mechanics, studios and features players still talk about.',
  sports: 'Voice: sports-bar energy. Ask about famous moments, rules, nicknames, legendary venues and settled records from the past, never today standings.',
  music: 'Voice: music-fan energy. Ask about songs, albums, instruments, band members, eras and award milestones.',
  movies: 'Voice: movie-night energy. Ask about characters, plot turns, directors, famous lines and film eras.',
  history: 'Voice: time-traveler energy. Ask about causes, turning points, key people and everyday life, and use only dates you are completely certain about.',
  science: 'Voice: curious-scientist energy. Ask why things happen, what things are made of and how systems work, using everyday examples.',
  geography: 'Voice: world-traveler energy. Ask about capitals, landmarks, rivers, mountains, flags and cultural traditions.',
  code: 'Voice: hacker-lab energy. Ask what a concept or tool does, trace a short everyday sequence, or pick the right idea for a described situation.',
  math: 'Voice: puzzle-master energy. Ask about reasoning, patterns and real-life number situations.',
  general: 'Voice: curious quiz-host energy. Ask about origins, meanings, famous examples, timeless records and how things work.',
});

const PRECODING_INSTRUCTION = 'Voice: curious quiz-host energy for pre-coding learners. Ask about everyday logic, order of steps, patterns and clear instructions. Never use code, syntax, tool names or programming vocabulary.';

const VOICE_ANGLES = Object.freeze({
  celebrity: 'career milestones, signature works, collaborations, awards and stage moments',
  games: 'game history, characters, gameplay, developers, platforms and memorable levels',
  sports: 'legendary moments, rules, nicknames, iconic venues and settled records',
  music: 'songs, albums, instruments, band members and musical eras',
  movies: 'characters, scenes, directors, quotes and film eras',
  history: 'causes, turning points, key people and everyday life',
  science: 'how things work, what things are made of and everyday examples',
  geography: 'countries, capitals, landmarks, nature and cultures',
  code: 'core concepts, how things work, real situations and everyday logic',
  math: 'patterns, reasoning and real-life number situations',
  general: 'origins, meanings, famous examples and how things work',
});

function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function normalizeTopicVoice(value) {
  const normalized = fold(value).trim();
  return TOPIC_VOICES.includes(normalized) ? normalized : null;
}

export function classifyTopicVoice(topic) {
  const text = fold(topic);
  if (!text) return 'general';
  for (const rule of VOICE_RULES) {
    if (rule.pattern.test(text)) return rule.voice;
  }
  return 'general';
}

export function resolveTopicVoice(value, topic) {
  return normalizeTopicVoice(value) ?? classifyTopicVoice(topic);
}

export function voiceInstruction(voice, { preCoding = false } = {}) {
  if (preCoding) return PRECODING_INSTRUCTION;
  return VOICE_INSTRUCTIONS[normalizeTopicVoice(voice) ?? 'general'];
}

export function voiceAngles(voice) {
  return VOICE_ANGLES[normalizeTopicVoice(voice) ?? 'general'];
}
