// Deterministic math questions. Arithmetic answers are always computed in
// code; the model is never allowed to supply them.
import { hashSeed } from './quiz-core.mjs';

const PHRASES = Object.freeze({
  English: {
    question: expression => `What is ${expression}?`,
    drawing: expression => `Show your working for ${expression} on the board and circle the answer.`,
    criteria: expression => `Correct working and result for ${expression}`,
  },
  Portuguese: {
    question: expression => `Quanto é ${expression}?`,
    drawing: expression => `Mostre o cálculo de ${expression} no quadro e circule a resposta.`,
    criteria: expression => `Cálculo e resultado corretos de ${expression}`,
  },
  Spanish: {
    question: expression => `¿Cuánto es ${expression}?`,
    drawing: expression => `Muestra el cálculo de ${expression} en el tablero y encierra la respuesta.`,
    criteria: expression => `Cálculo y resultado correctos de ${expression}`,
  },
});

const QUESTION_CUE_PATTERN = /^(?:(?:what|how\s+much)\s+is|(?:calculate|solve|compute|evaluate)|quanto\s+(?:e|é)|cuanto\s+es|calcule|calcula)\s*:?\s*/i;
const PURE_EXPRESSION_PATTERN = /^\d+(?:\.\d+)?(?:\s*[+\-*/]\s*\d+(?:\.\d+)?)+$/;

function folding(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[¿¡\s]+/, '');
}

function normalizeOperators(value) {
  return String(value ?? '')
    .replace(/\u2212/g, '-')
    .replace(/[×✕✖]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/(?<=\d)\s*[xX]\s*(?=\d)/g, '*')
    .trim();
}

function applyOperator(stack, operator) {
  const right = stack.pop();
  const left = stack.pop();
  if (left === undefined || right === undefined) return false;
  if (operator === '+') stack.push(left + right);
  else if (operator === '-') stack.push(left - right);
  else if (operator === '*') stack.push(left * right);
  else if (operator === '/') stack.push(right === 0 ? Number.NaN : left / right);
  else return false;
  return true;
}

function evaluateTokens(tokens) {
  const values = [];
  const operators = [];
  const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };
  for (const token of tokens) {
    if (/^\d+(?:\.\d+)?$/.test(token)) {
      values.push(Number(token));
      continue;
    }
    if (token === '(') {
      operators.push(token);
      continue;
    }
    if (token === ')') {
      while (operators.length && operators[operators.length - 1] !== '(') {
        if (!applyOperator(values, operators.pop())) return null;
      }
      if (!operators.length) return null;
      operators.pop();
      continue;
    }
    while (
      operators.length &&
      operators[operators.length - 1] !== '(' &&
      precedence[operators[operators.length - 1]] >= precedence[token]
    ) {
      if (!applyOperator(values, operators.pop())) return null;
    }
    operators.push(token);
  }
  while (operators.length) {
    const operator = operators.pop();
    if (operator === '(' || !applyOperator(values, operator)) return null;
  }
  return values.length === 1 ? values[0] : null;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return null;
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(4)));
}

// Returns the exact computed result only when the text is pure arithmetic
// (optionally wrapped in a short question cue), otherwise null.
export function solveArithmetic(text) {
  const folded = folding(normalizeOperators(text));
  const stripped = folded.replace(QUESTION_CUE_PATTERN, '').replace(/\s*[?=]+\s*$/, '');
  if (!PURE_EXPRESSION_PATTERN.test(stripped)) return null;
  const tokens = stripped.match(/\d+(?:\.\d+)?|[+\-*/]/g);
  if (!tokens || tokens.join('') !== stripped.replace(/\s+/g, '')) return null;
  const value = evaluateTokens(tokens);
  return value === null ? null : formatNumber(value);
}

export function verifyArithmeticAnswer(prompt, answer) {
  const computed = solveArithmetic(prompt);
  if (computed === null) return { checked: false, valid: true, computed: null };
  const submitted = Number(String(answer ?? '').replace(',', '.').trim());
  if (!Number.isFinite(submitted)) return { checked: true, valid: false, computed };
  return { checked: true, valid: Math.abs(submitted - Number(computed)) < 1e-9, computed };
}

function createRng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function randomInt(rng, minimum, maximum) {
  return minimum + Math.floor(rng() * (maximum - minimum + 1));
}

function tierIndexForSlot(slot) {
  const order = ['foundation', 'connection', 'application', 'reasoning', 'challenge', 'expert'];
  const index = order.indexOf(slot?.tier);
  if (index >= 0) return index;
  if (slot?.difficulty === 'hard') return 4;
  if (slot?.difficulty === 'medium') return 2;
  return 0;
}

function createExpression(slot, rng) {
  const tier = tierIndexForSlot(slot);
  if (tier >= 4) {
    const left = randomInt(rng, 3, 12);
    const right = randomInt(rng, 3, 12);
    const addend = randomInt(rng, 2, 20);
    return rng() < 0.5 ? `${left} × ${right} + ${addend}` : `${left} × ${right} - ${addend}`;
  }
  if (tier >= 2) {
    const roll = rng();
    if (roll < 0.4) {
      const divisor = randomInt(rng, 2, 9);
      const quotient = randomInt(rng, 2, 9);
      return `${divisor * quotient} ÷ ${divisor}`;
    }
    if (roll < 0.7) return `${randomInt(rng, 11, 19)} × ${randomInt(rng, 2, 9)}`;
    return `${randomInt(rng, 20, 99)} + ${randomInt(rng, 20, 99)}`;
  }
  if (rng() < 0.5) return `${randomInt(rng, 2, 20)} + ${randomInt(rng, 2, 20)}`;
  const left = randomInt(rng, 10, 40);
  const right = randomInt(rng, 1, Math.max(1, left - 1));
  return `${left} - ${right}`;
}

function buildMathOptions(answer, expression, rng) {
  const correct = Number(answer);
  const numbers = expression.split(/[^\d.]+/).filter(Boolean).map(Number);
  const candidates = new Set([correct + 1, correct - 1, correct + 2, correct - 2, correct + 10, correct - 10]);
  if (numbers.length >= 2) {
    candidates.add(numbers[0] + numbers[1]);
    candidates.add(Math.abs(numbers[0] - numbers[1]));
    candidates.add(numbers[0] * numbers[1]);
  }
  if (numbers.length >= 3) {
    candidates.add(numbers[0] * (numbers[1] + numbers[2]));
    candidates.add(numbers[1] * numbers[2]);
  }
  const allowNegative = correct < 0;
  const pool = [...candidates].filter(value =>
    Number.isFinite(value) && Number.isInteger(value) && value !== correct && (allowNegative || value >= 0)
  );
  const distractors = [];
  while (distractors.length < 3 && pool.length) {
    const index = Math.floor(rng() * pool.length);
    distractors.push(String(pool.splice(index, 1)[0]));
  }
  let filler = correct + 3;
  while (distractors.length < 3) {
    const value = String(filler);
    if (value !== String(answer) && !distractors.includes(value)) distractors.push(value);
    filler += 1;
  }
  const options = [...distractors];
  const correctIndex = Math.floor(rng() * 4);
  options.splice(correctIndex, 0, String(answer));
  return { options, correctIndex };
}

export function generateMathQuestion(slot, spec = {}) {
  const language = PHRASES[spec.language] ? spec.language : 'English';
  const phrase = PHRASES[language];
  const rng = createRng(hashSeed(`${spec.seed ?? 'jamboo'}:${spec.mathSalt ?? 0}:${slot.category ?? ''}:${slot.slotId}`));
  const expression = createExpression(slot, rng);
  const answer = solveArithmetic(expression);
  const evidence = {
    claim: `${expression} = ${answer}`,
    answer,
    metric: 'arithmetic',
    eventFrom: null,
    eventTo: null,
    asOf: null,
    source: 'JamBoo deterministic calculator',
    sourceUrl: null,
    sourceDate: null,
    route: 'math',
  };

  if (slot.type === 'multiple') {
    const { options, correctIndex } = buildMathOptions(answer, expression, rng);
    return {
      question: { slotId: slot.slotId, q: phrase.question(expression), o: options, i: correctIndex },
      evidence,
    };
  }
  if (slot.type === 'drawing') {
    return {
      question: { slotId: slot.slotId, q: phrase.drawing(expression), a: phrase.criteria(expression), d: 1 },
      evidence,
    };
  }
  return {
    question: { slotId: slot.slotId, q: phrase.question(expression), a: answer },
    evidence,
  };
}
