import { hashSeed } from './quiz-core.mjs';

const MATH_CATEGORY_PATTERN = /\b(?:math|maths|mathematics|arithmetic|addition|subtraction|multiplication|division|fractions?|decimals?|percentages?|percent|algebra|geometry|equations?|times tables?|mental math|calculo|matematica|matematicas|aritmetica|sumas?|somas?|restas?|subtracoes?|multiplicaciones?|multiplicacoes?|divisiones?|divisoes?|fracciones?|fracoes?|porcentajes?|porcentagens?|geometria|ecuaciones?|equacoes?|algebras?)\b/i;

const PHRASES = Object.freeze({
  English: {
    question: expression => `What is ${expression}?`,
    drawing: expression => `Show your working for ${expression} on the board and circle the answer.`,
    criteria: answer => `Correct working and result ${answer}`,
  },
  Portuguese: {
    question: expression => `Quanto é ${expression}?`,
    drawing: expression => `Mostre o cálculo de ${expression} no quadro e circule a resposta.`,
    criteria: answer => `Cálculo e resultado corretos: ${answer}`,
  },
  Spanish: {
    question: expression => `¿Cuánto es ${expression}?`,
    drawing: expression => `Muestra el cálculo de ${expression} en el tablero y encierra la respuesta.`,
    criteria: answer => `Cálculo y resultado correctos: ${answer}`,
  },
});

const CONTEXTS = Object.freeze({
  English: {
    add: [
      (a, b) => `There are ${a} red cubes and ${b} blue cubes in a box. How many cubes are there in total?`,
      (a, b) => `A bus has ${a} passengers. At the next stop ${b} more get on. How many passengers are on the bus now?`,
      (a, b) => `Lena reads ${a} pages on Monday and ${b} pages on Tuesday. How many pages does she read in total?`,
      (a, b) => `A shop sells ${a} drinks in the morning and ${b} drinks in the afternoon. How many drinks is that altogether?`,
    ],
    sub: [
      (a, b) => `There are ${a} birds sitting on a wire. ${b} fly away. How many birds remain?`,
      (a, b) => `A jar has ${a} sweets. Tom eats ${b} of them. How many sweets are left?`,
      (a, b) => `The temperature is ${a}°C and then drops by ${b}°C. What is the new temperature?`,
      (a, b) => `${a} seats on a plane are booked. ${b} passengers cancel. How many booked seats remain?`,
    ],
    mul: [
      (a, b) => `Each box holds ${a} pencils. How many pencils are in ${b} boxes?`,
      (a, b) => `A pizza is cut into ${a} slices. How many slices are there in ${b} pizzas?`,
      (a, b) => `A class lines up in ${b} rows with ${a} students in each row. How many students are in the class?`,
      (a, b) => `A packet has ${a} stickers. How many stickers are in ${b} packets?`,
    ],
    div: [
      (a, b) => `${a} stickers are shared equally among ${b} friends. How many stickers does each friend get?`,
      (a, b) => `A ${a} m rope is cut into ${b} equal pieces. How long is each piece?`,
      (a, b) => `${a} chairs are arranged into ${b} equal rows. How many chairs are in each row?`,
      (a, b) => `${a} marbles are packed equally into ${b} bags. How many marbles go in each bag?`,
    ],
  },
  Portuguese: {
    add: [
      (a, b) => `Há ${a} cubos vermelhos e ${b} cubos azuis numa caixa. Quantos cubos há no total?`,
      (a, b) => `Um ônibus tem ${a} passageiros. Na próxima parada entram mais ${b}. Quantos passageiros há agora?`,
      (a, b) => `Lena lê ${a} páginas na segunda e ${b} páginas na terça. Quantas páginas ela lê no total?`,
      (a, b) => `Uma loja vende ${a} bebidas de manhã e ${b} à tarde. Quantas bebidas vendeu ao todo?`,
    ],
    sub: [
      (a, b) => `Há ${a} pássaros num fio e ${b} voam para longe. Quantos pássaros ficam?`,
      (a, b) => `Um pote tem ${a} balas. Tom come ${b}. Quantas balas sobraram?`,
      (a, b) => `A temperatura está em ${a}°C e cai ${b}°C. Qual é a nova temperatura?`,
      (a, b) => `${a} lugares de um avião estão reservados. ${b} passageiros cancelam. Quantas reservas ficam?`,
    ],
    mul: [
      (a, b) => `Cada caixa tem ${a} lápis. Quantos lápis há em ${b} caixas?`,
      (a, b) => `Uma pizza é cortada em ${a} fatias. Quantas fatias há em ${b} pizzas?`,
      (a, b) => `A turma forma ${b} filas com ${a} alunos em cada fila. Quantos alunos há na turma?`,
      (a, b) => `Um pacote tem ${a} figurinhas. Quantas figurinhas há em ${b} pacotes?`,
    ],
    div: [
      (a, b) => `${a} figurinhas são divididas igualmente entre ${b} amigos. Quantas figurinhas cada um recebe?`,
      (a, b) => `Uma corda de ${a} m é cortada em ${b} pedaços iguais. Qual é o comprimento de cada pedaço?`,
      (a, b) => `${a} cadeiras são organizadas em ${b} fileiras iguais. Quantas cadeiras há em cada fileira?`,
      (a, b) => `${a} bolinhas são colocadas igualmente em ${b} sacos. Quantas bolinhas vão em cada saco?`,
    ],
  },
  Spanish: {
    add: [
      (a, b) => `Hay ${a} cubos rojos y ${b} cubos azules en una caja. ¿Cuántos cubos hay en total?`,
      (a, b) => `Un autobús lleva ${a} pasajeros. En la próxima parada suben ${b} más. ¿Cuántos pasajeros lleva ahora?`,
      (a, b) => `Lena lee ${a} páginas el lunes y ${b} páginas el martes. ¿Cuántas páginas lee en total?`,
      (a, b) => `Una tienda vende ${a} bebidas por la mañana y ${b} por la tarde. ¿Cuántas bebidas vendió en total?`,
    ],
    sub: [
      (a, b) => `Hay ${a} pájaros en un cable y ${b} se van volando. ¿Cuántos pájaros quedan?`,
      (a, b) => `Un frasco tiene ${a} caramelos. Tom se come ${b}. ¿Cuántos caramelos quedan?`,
      (a, b) => `La temperatura es de ${a}°C y baja ${b}°C. ¿Cuál es la nueva temperatura?`,
      (a, b) => `${a} asientos de un avión están reservados. ${b} pasajeros cancelan. ¿Cuántas reservas quedan?`,
    ],
    mul: [
      (a, b) => `Cada caja tiene ${a} lápices. ¿Cuántos lápices hay en ${b} cajas?`,
      (a, b) => `Una pizza se corta en ${a} porciones. ¿Cuántas porciones hay en ${b} pizzas?`,
      (a, b) => `La clase forma ${b} filas con ${a} estudiantes en cada fila. ¿Cuántos estudiantes hay?`,
      (a, b) => `Un paquete tiene ${a} pegatinas. ¿Cuántas pegatinas hay en ${b} paquetes?`,
    ],
    div: [
      (a, b) => `${a} pegatinas se reparten en partes iguales entre ${b} amigos. ¿Cuántas pegatinas recibe cada uno?`,
      (a, b) => `Una cuerda de ${a} m se corta en ${b} trozos iguales. ¿Cuánto mide cada trozo?`,
      (a, b) => `${a} sillas se colocan en ${b} filas iguales. ¿Cuántas sillas hay en cada fila?`,
      (a, b) => `${a} canicas se guardan por igual en ${b} bolsas. ¿Cuántas canicas van en cada bolsa?`,
    ],
  },
});

const DRAWING_PHRASES = Object.freeze({
  English: context => `Draw a sketch that shows this problem: ${context}`,
  Portuguese: context => `Faça um desenho que mostre este problema: ${context}`,
  Spanish: context => `Haz un dibujo que muestre este problema: ${context}`,
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

export function isMathCategory(text) {
  return MATH_CATEGORY_PATTERN.test(folding(text));
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

function createProblem(slot, rng) {
  const tier = tierIndexForSlot(slot);
  if (tier >= 4) {
    const left = randomInt(rng, 3, 12);
    const right = randomInt(rng, 3, 12);
    const product = left * right;
    const addend = randomInt(rng, 2, Math.max(2, Math.min(20, product - 1)));
    return rng() < 0.5
      ? { expression: `${left} × ${right} + ${addend}` }
      : { expression: `${left} × ${right} - ${addend}` };
  }
  if (tier >= 2) {
    const roll = rng();
    if (roll < 0.35) {
      const divisor = randomInt(rng, 2, 9);
      const quotient = randomInt(rng, 2, 9);
      return { expression: `${divisor * quotient} ÷ ${divisor}`, op: 'div', a: divisor * quotient, b: divisor };
    }
    if (roll < 0.7) {
      const a = randomInt(rng, 11, 19);
      const b = randomInt(rng, 2, 9);
      return { expression: `${a} × ${b}`, op: 'mul', a, b };
    }
    const a = randomInt(rng, 20, 99);
    const b = randomInt(rng, 20, 99);
    return { expression: `${a} + ${b}`, op: 'add', a, b };
  }
  if (rng() < 0.5) {
    const a = randomInt(rng, 2, 20);
    const b = randomInt(rng, 2, 20);
    return { expression: `${a} + ${b}`, op: 'add', a, b };
  }
  const a = randomInt(rng, 10, 40);
  const b = randomInt(rng, 1, a - 1);
  return { expression: `${a} - ${b}`, op: 'sub', a, b };
}

function buildOptions(answer, problem, rng) {
  const correct = Number(answer);
  const numbers = [problem.a, problem.b].filter(value => Number.isFinite(value));
  const candidates = new Set([
    correct + 1, correct - 1, correct + 2, correct - 2, correct + 3, correct - 3,
    correct + 10, correct - 10,
  ]);
  if (numbers.length >= 2) {
    candidates.add(numbers[0] + numbers[1]);
    candidates.add(Math.abs(numbers[0] - numbers[1]));
    candidates.add(numbers[0] * numbers[1]);
    if (numbers[1] !== 0) candidates.add(numbers[0] / numbers[1]);
  }
  const pool = [...candidates].filter(value =>
    Number.isFinite(value) && value !== correct && value >= 0
  );
  const distractors = [];
  while (distractors.length < 3 && pool.length) {
    const index = Math.floor(rng() * pool.length);
    distractors.push(formatNumber(pool.splice(index, 1)[0]));
  }
  let filler = correct + 4;
  while (distractors.length < 3) {
    const value = formatNumber(filler);
    if (value !== String(answer) && !distractors.includes(value)) distractors.push(value);
    filler += 1;
  }
  const options = [String(answer), ...distractors];
  for (let index = options.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [options[index], options[swapIndex]] = [options[swapIndex], options[index]];
  }
  return { options, correctIndex: options.indexOf(String(answer)) };
}

function contextFor(problem, language, answer, rng) {
  if (!problem.op) return null;
  const templates = CONTEXTS[language]?.[problem.op];
  if (!Array.isArray(templates) || !templates.length) return null;
  return templates[Math.floor(rng() * templates.length)](problem.a, problem.b, answer);
}

export function generateMathQuestion(slot, spec = {}) {
  const language = PHRASES[spec.language] ? spec.language : 'English';
  const phrase = PHRASES[language];
  const rng = createRng(hashSeed(`${spec.seed ?? 'jamboo'}:${spec.mathSalt ?? 0}:${slot.category ?? ''}:${slot.slotId}`));
  const problem = createProblem(slot, rng);
  const answer = solveArithmetic(problem.expression);
  const context = contextFor(problem, language, answer, rng);
  const askedText = context ?? phrase.question(problem.expression);
  const evidence = {
    claim: `${problem.expression} = ${answer}`,
    answer,
    metric: 'arithmetic',
    route: 'math',
    source: 'JamBoo deterministic calculator',
  };

  if (slot.type === 'multiple') {
    const { options, correctIndex } = buildOptions(answer, problem, rng);
    return {
      question: { slotId: slot.slotId, q: askedText, o: options, i: correctIndex, a: String(answer) },
      evidence,
    };
  }
  if (slot.type === 'drawing') {
    const instruction = context
      ? (DRAWING_PHRASES[language] ?? DRAWING_PHRASES.English)(context)
      : phrase.drawing(problem.expression);
    return {
      question: { slotId: slot.slotId, q: instruction, a: phrase.criteria(answer), d: 1 },
      evidence,
    };
  }
  return {
    question: { slotId: slot.slotId, q: askedText, a: answer },
    evidence,
  };
}
