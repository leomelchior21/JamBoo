export const QUIZ_LIMITS = Object.freeze({ columns: 8, rows: 6 });
export const QUESTION_TYPES = Object.freeze(['multiple', 'open', 'drawing', 'mixed']);
export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard', 'mixed']);

const TYPE_CYCLE = ['multiple', 'open', 'drawing'];
const DIFFICULTY_CYCLE = ['easy', 'medium', 'hard'];
const COGNITIVE_SKILLS = {
  easy: ['recognize', 'recall', 'identify', 'classify'],
  medium: ['explain', 'compare', 'connect facts', 'sequence', 'apply'],
  hard: ['infer', 'analyze', 'apply in a new situation', 'reason in steps', 'evaluate'],
};

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
      return {
        slotId: `${categoryIndex}-${rowIndex}`,
        category: cleanText(category),
        categoryIndex,
        rowIndex,
        points: (rowIndex + 1) * 100,
        difficulty,
        type,
        cognitiveSkill: skills[(seedHash + slotIndex) % skills.length],
      };
    })
  );
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

  const options = question.o ?? question.options;
  const answer = cleanText(question.a ?? question.answer);
  const rawIndex = question.i ?? question.correctIndex;
  const answerIndex = Number.isInteger(rawIndex) ? rawIndex : Number.parseInt(rawIndex, 10);
  const drawing = question.d === 1 || question.d === true || question.isDrawing === true;

  if (slot.type === 'multiple') {
    if (drawing) return { valid: false, reason: 'wrong question type' };
    if (!Array.isArray(options) || options.length !== 4 || options.some(option => !cleanText(option))) {
      return { valid: false, reason: 'multiple choice requires four options' };
    }
    if (new Set(options.map(normalizeText)).size !== 4) {
      return { valid: false, reason: 'duplicate answer option' };
    }
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
      return { valid: false, reason: 'invalid answerIndex' };
    }
    return {
      valid: true,
      question: { slotId: slot.slotId, q: prompt, o: options.map(cleanText), i: answerIndex },
    };
  }

  if (Array.isArray(options) || rawIndex !== undefined) {
    return { valid: false, reason: 'wrong question type' };
  }
  if (!answer) return { valid: false, reason: 'blank expected answer' };
  if (slot.type === 'drawing' && !drawing) {
    return { valid: false, reason: 'drawing marker missing' };
  }
  if (slot.type === 'open' && drawing) {
    return { valid: false, reason: 'wrong question type' };
  }
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
