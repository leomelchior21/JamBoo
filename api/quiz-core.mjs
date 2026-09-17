export const QUIZ_LIMITS = Object.freeze({ columns: 8, rows: 6 });
export const QUESTION_TYPES = Object.freeze(['multiple', 'open', 'drawing', 'mixed']);
export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard', 'mixed']);

const TYPE_CYCLE = ['multiple', 'open', 'drawing'];
const DIFFICULTY_CYCLE = ['easy', 'medium', 'hard'];
const MAX_MC_OPTION_LENGTH = 60;
const MAX_MC_OPTION_WORDS = 8;
const MAX_ANSWER_LENGTH = 80;
const MAX_ANSWER_WORDS = 12;
const MAX_PROMPT_LENGTH = 200;

const COGNITIVE_SKILLS = {
  easy: ['recognize', 'recall', 'identify', 'classify'],
  medium: ['explain', 'compare', 'connect facts', 'sequence', 'apply'],
  hard: ['infer', 'analyze', 'apply in a new situation', 'reason in steps', 'evaluate'],
};

export const COGNITIVE_LADDER = Object.freeze([
  Object.freeze({ points: 100, tier: 'foundation', skill: 'direct identification or recall' }),
  Object.freeze({ points: 200, tier: 'connection', skill: 'connect facts or concepts' }),
  Object.freeze({ points: 300, tier: 'application', skill: 'apply knowledge' }),
  Object.freeze({ points: 400, tier: 'reasoning', skill: 'evaluate plausible alternatives' }),
  Object.freeze({ points: 500, tier: 'challenge', skill: 'combine multiple pieces of information' }),
  Object.freeze({ points: 600, tier: 'expert', skill: 'difficult but still clear and unambiguous' }),
]);

const DIFFICULTY_TIER_SPANS = Object.freeze({
  easy: [0, 1],
  medium: [0, 2],
  hard: [3, 5],
  mixed: [0, 5],
});

const UNSTABLE_PROMPT_PATTERN = /\b(?:current(?:ly)?|latest|today|tonight|nowadays|right now|this (?:year|month|week)|recent(?:ly)?|upcoming|so far|as of|atualmente|atual|hoje|agora|este (?:ano|mes)|mais recente|ultimo|ultima|actualmente|actual|hoy|ahora|mas reciente)\b/;

const BANNED_OPTION_PATTERN = /^(?:all|none|both|todos?|todas?|nenhum|nenhuma|ningun|ninguna)\b/;

export function cognitiveTierForRow(difficulty, rowIndex, rows) {
  const span = DIFFICULTY_TIER_SPANS[difficulty] ?? DIFFICULTY_TIER_SPANS.mixed;
  const start = span[0];
  const end = span[1];
  if (!Number.isInteger(rows) || rows <= 1) return COGNITIVE_LADDER[start];
  const fraction = rowIndex / (rows - 1);
  const index = Math.min(end, start + Math.floor(fraction * (end - start) + 1e-9));
  return COGNITIVE_LADDER[index];
}

export function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value ?? '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function mixedDifficulty(rowIndex, rows) {
  if (rows === 1) return 'medium';
  if (rowIndex === rows - 1) return 'hard';
  return DIFFICULTY_CYCLE[Math.min(2, Math.floor((rowIndex * 3) / rows))];
}

export function createSlotPlan(spec, categories) {
  if (!Number.isInteger(spec?.columns) || spec.columns < 1 || spec.columns > QUIZ_LIMITS.columns) {
    throw new Error('Invalid board column count');
  }
  if (!Number.isInteger(spec?.rows) || spec.rows < 1 || spec.rows > QUIZ_LIMITS.rows) {
    throw new Error('Invalid board row count');
  }
  if (!DIFFICULTIES.includes(spec.difficulty) || !QUESTION_TYPES.includes(spec.questionType)) {
    throw new Error('Invalid quiz mode');
  }
  if (!Array.isArray(categories) || categories.length !== spec.columns) {
    throw new Error('Invalid category count');
  }

  const seedHash = hashSeed(spec.seed);
  const typeOffset = seedHash % TYPE_CYCLE.length;
  return categories.flatMap((category, categoryIndex) =>
    Array.from({ length: spec.rows }, (_, rowIndex) => {
      const slotIndex = categoryIndex * spec.rows + rowIndex;
      const difficulty = spec.difficulty === 'mixed'
        ? mixedDifficulty(rowIndex, spec.rows)
        : spec.difficulty;
      const type = spec.questionType === 'mixed'
        ? TYPE_CYCLE[(slotIndex + typeOffset) % TYPE_CYCLE.length]
        : spec.questionType;
      const skills = COGNITIVE_SKILLS[difficulty];
      const tier = cognitiveTierForRow(spec.difficulty, rowIndex, spec.rows);
      return {
        slotId: `${categoryIndex}-${rowIndex}`,
        category: cleanText(category),
        categoryIndex,
        rowIndex,
        points: (rowIndex + 1) * 100,
        difficulty,
        type,
        cognitiveSkill: skills[(seedHash + slotIndex) % skills.length],
        tier: tier.tier,
        tierSkill: tier.skill,
      };
    })
  );
}

export function isUnstablePrompt(prompt) {
  return UNSTABLE_PROMPT_PATTERN.test(normalizeText(prompt));
}

export function isAnswerRevealed(prompt, answer) {
  const answerKey = normalizeText(answer);
  const words = answerKey.split(' ').filter(Boolean);
  if (!answerKey || answerKey.length < 4 || words.length > 6) return false;
  return ` ${normalizeText(prompt)} `.includes(` ${answerKey} `);
}

function isBannedOption(option) {
  const key = normalizeText(option);
  return !key || (BANNED_OPTION_PATTERN.test(key) && key.split(' ').length <= 5);
}

function optionProblem(options) {
  for (const option of options) {
    if (!option) return 'blank answer option';
    if (option.length > MAX_MC_OPTION_LENGTH || option.split(/\s+/).length > MAX_MC_OPTION_WORDS) {
      return 'answer option too long';
    }
  }
  if (new Set(options.map(normalizeText)).size !== options.length) return 'duplicate answer option';
  if (options.some(isBannedOption)) return 'banned answer option';
  return null;
}

function shuffleOptions(options, seed) {
  const rng = createRng(seed);
  for (let index = options.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [options[index], options[swapIndex]] = [options[swapIndex], options[index]];
  }
  return options;
}

function buildMultipleChoice(question, seed) {
  const answer = cleanText(question.a ?? question.answer);
  const givenOptions = question.o ?? question.options;
  const rawIndex = question.i ?? question.correctIndex;
  const givenIndex = Number.isInteger(rawIndex) ? rawIndex : Number.parseInt(rawIndex, 10);
  const distractors = question.x ?? question.distractors;

  if (Array.isArray(givenOptions) && givenOptions.length === 4) {
    const options = givenOptions.map(cleanText);
    if (answer) {
      const index = options.findIndex(option => normalizeText(option) === normalizeText(answer));
      if (index < 0) return null;
      if (Number.isInteger(givenIndex) && givenIndex >= 0 && givenIndex < 4 && givenIndex !== index) return null;
      return { options, index };
    }
    if (!Number.isInteger(givenIndex) || givenIndex < 0 || givenIndex >= 4) return null;
    return { options, index: givenIndex };
  }

  if (answer && Array.isArray(distractors) && distractors.length === 3) {
    const options = shuffleOptions([answer, ...distractors.map(cleanText)], seed);
    const index = options.findIndex(option => normalizeText(option) === normalizeText(answer));
    return index < 0 ? null : { options, index };
  }

  return null;
}

export function validateQuestionForSlot(question, slot) {
  if (!question || typeof question !== 'object' || Array.isArray(question)) {
    return { valid: false, reason: 'missing question object' };
  }
  if (question.slotId !== slot.slotId) {
    return { valid: false, reason: 'slotId mismatch' };
  }
  const prompt = cleanText(question.q ?? question.question);
  if (!prompt) return { valid: false, reason: 'blank question' };
  if (prompt.length > MAX_PROMPT_LENGTH) return { valid: false, reason: 'question too long' };

  const drawing = question.d === 1 || question.d === true || question.isDrawing === true;
  const answer = cleanText(question.a ?? question.answer);
  const rawOptions = question.o ?? question.options;
  const rawIndex = question.i ?? question.correctIndex;

  if (slot.type === 'multiple') {
    if (drawing) return { valid: false, reason: 'wrong question type' };
    const choice = buildMultipleChoice(question, hashSeed(`${slot.slotId}:${prompt}`));
    if (!choice) return { valid: false, reason: 'multiple choice requires four options' };
    const problem = optionProblem(choice.options);
    if (problem) return { valid: false, reason: problem };
    if (isAnswerRevealed(prompt, choice.options[choice.index])) {
      return { valid: false, reason: 'answer revealed in question' };
    }
    if (isUnstablePrompt(prompt)) return { valid: false, reason: 'question uses a changing fact' };
    return {
      valid: true,
      question: {
        slotId: slot.slotId,
        q: prompt,
        o: choice.options,
        i: choice.index,
        a: choice.options[choice.index],
      },
    };
  }

  if (Array.isArray(rawOptions) || rawIndex !== undefined || Array.isArray(question.x)) {
    return { valid: false, reason: 'wrong question type' };
  }
  if (!answer) return { valid: false, reason: 'blank expected answer' };
  if (answer.length > MAX_ANSWER_LENGTH || answer.split(/\s+/).length > MAX_ANSWER_WORDS) {
    return { valid: false, reason: 'expected answer too long' };
  }
  if (slot.type === 'drawing' && !drawing) return { valid: false, reason: 'drawing marker missing' };
  if (slot.type === 'open' && drawing) return { valid: false, reason: 'wrong question type' };
  if (slot.type !== 'drawing' && isAnswerRevealed(prompt, answer)) {
    return { valid: false, reason: 'answer revealed in question' };
  }
  if (isUnstablePrompt(prompt)) return { valid: false, reason: 'question uses a changing fact' };
  return {
    valid: true,
    question: slot.type === 'drawing'
      ? { slotId: slot.slotId, q: prompt, a: answer, d: 1 }
      : { slotId: slot.slotId, q: prompt, a: answer },
  };
}

function tokenSimilarity(left, right) {
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'como', 'da', 'de', 'do', 'does', 'el', 'explain', 'la', 'o',
    'por', 'que', 'the', 'what', 'which', 'why', 'como', 'explique', 'qual', 'quais', 'porque',
  ]);
  const tokens = value => new Set(normalizeText(value).split(' ')
    .filter(token => token && !stopWords.has(token))
    .map(token => token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token));
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size < 4 || rightTokens.size < 4) return 0;
  let intersection = 0;
  leftTokens.forEach(token => { if (rightTokens.has(token)) intersection += 1; });
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

export function isDuplicateQuestion(prompt, previousPrompts) {
  const key = normalizeText(prompt);
  return previousPrompts.some(previous => {
    const previousKey = normalizeText(previous);
    return key === previousKey || tokenSimilarity(key, previousKey) >= 0.82;
  });
}

export function validateCompleteQuiz(slots, questions) {
  if (!Array.isArray(slots) || !Array.isArray(questions) || slots.length !== questions.length) {
    return { valid: false, reason: 'question count does not match board plan' };
  }
  const slotIds = new Set(slots.map(slot => slot?.slotId));
  if (slotIds.size !== slots.length) return { valid: false, reason: 'duplicate planned slot' };

  const bySlot = new Map();
  for (const question of questions) {
    if (!slotIds.has(question?.slotId)) return { valid: false, reason: 'unexpected slotId' };
    if (bySlot.has(question.slotId)) return { valid: false, reason: 'duplicate slotId' };
    bySlot.set(question.slotId, question);
  }

  const normalized = [];
  const prompts = [];
  for (const slot of slots) {
    const result = validateQuestionForSlot(bySlot.get(slot.slotId), slot);
    if (!result.valid) return result;
    const prompt = result.question.q;
    if (isDuplicateQuestion(prompt, prompts)) {
      return { valid: false, reason: 'duplicate question' };
    }
    prompts.push(prompt);
    normalized.push(result.question);
  }
  return { valid: true, questions: normalized };
}
