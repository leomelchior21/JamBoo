import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSlotPlan,
  isDuplicateQuestion,
  validateCompleteQuiz,
  validateQuestionForSlot,
} from '../api/quiz-core.mjs';

const categories = count => Array.from({ length: count }, (_, index) => `Category ${index + 1}`);
const spec = overrides => ({
  columns: 4,
  rows: 4,
  difficulty: 'easy',
  questionType: 'multiple',
  seed: 'seed-a',
  ...overrides,
});

function validQuestion(slot) {
  if (slot.type === 'multiple') {
    return {
      slotId: slot.slotId,
      q: `Which answer belongs to ${slot.category} at ${slot.points} points?`,
      o: [`Answer ${slot.slotId}`, 'Wrong B', 'Wrong C', 'Wrong D'],
      i: 0,
    };
  }
  if (slot.type === 'drawing') {
    return {
      slotId: slot.slotId,
      q: `Draw the key idea for ${slot.category} at ${slot.points} points.`,
      a: `Includes the key feature for ${slot.slotId}`,
      d: 1,
    };
  }
  return {
    slotId: slot.slotId,
    q: `Explain the key idea for ${slot.category} at ${slot.points} points.`,
    a: `Expected answer ${slot.slotId}`,
  };
}

test('creates every easy multiple-choice slot for a small board', () => {
  const plan = createSlotPlan(spec({ columns: 3, rows: 2 }), categories(3));
  assert.equal(plan.length, 6);
  assert.deepEqual(plan.map(slot => slot.slotId), ['0-0', '0-1', '1-0', '1-1', '2-0', '2-1']);
  assert.ok(plan.every(slot => slot.difficulty === 'easy' && slot.type === 'multiple'));
});

test('players are not part of generated content planning', () => {
  const onePlayer = createSlotPlan(spec({ players: 1 }), categories(4));
  const eightPlayers = createSlotPlan(spec({ players: 8 }), categories(4));
  assert.deepEqual(onePlayer, eightPlayers);
});

test('large mixed boards have intentional difficulty and type distributions', () => {
  const plan = createSlotPlan(spec({ columns: 8, rows: 6, difficulty: 'mixed', questionType: 'mixed' }), categories(8));
  assert.equal(plan.length, 48);
  assert.deepEqual(new Set(plan.map(slot => slot.difficulty)), new Set(['easy', 'medium', 'hard']));
  assert.deepEqual(new Set(plan.map(slot => slot.type)), new Set(['multiple', 'open', 'drawing']));
  assert.ok(plan.every(slot => slot.points === (slot.rowIndex + 1) * 100));
});

test('hard mode uses reasoning-oriented recipes in every row', () => {
  const plan = createSlotPlan(spec({ rows: 6, difficulty: 'hard' }), categories(4));
  assert.ok(plan.every(slot => slot.difficulty === 'hard'));
  assert.ok(plan.every(slot => /infer|analy|apply|reason|evaluate/.test(slot.cognitiveSkill)));
});

test('different seeds vary code-controlled mixed recipes', () => {
  const first = createSlotPlan(spec({ questionType: 'mixed', difficulty: 'mixed', seed: 'seed-a' }), categories(4));
  const second = createSlotPlan(spec({ questionType: 'mixed', difficulty: 'mixed', seed: 'seed-b' }), categories(4));
  assert.notDeepEqual(
    first.map(slot => [slot.type, slot.cognitiveSkill]),
    second.map(slot => [slot.type, slot.cognitiveSkill])
  );
});

test('rejects one malformed multiple-choice slot without invalidating valid slot data', () => {
  const plan = createSlotPlan(spec({ columns: 1, rows: 2 }), categories(1));
  const valid = validateQuestionForSlot(validQuestion(plan[0]), plan[0]);
  const malformed = { ...validQuestion(plan[1]), o: ['Same', 'Same', 'C', 'D'] };
  const invalid = validateQuestionForSlot(malformed, plan[1]);
  assert.equal(valid.valid, true);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reason, 'duplicate answer option');
});

test('rejects answer choices that are too long for the game card', () => {
  const [slot] = createSlotPlan(spec({ columns: 1, rows: 1 }), categories(1));
  const question = validQuestion(slot);
  question.o[1] = 'This answer choice contains far too many words for one compact game card';
  const result = validateQuestionForSlot(question, slot);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'answer option too long');
});

test('does not accept a quiz with a missing slot', () => {
  const plan = createSlotPlan(spec({ columns: 2, rows: 2 }), categories(2));
  const result = validateCompleteQuiz(plan, plan.slice(0, -1).map(validQuestion));
  assert.equal(result.valid, false);
  assert.match(result.reason, /count/);
});

test('rejects exact and obvious semantic duplicates', () => {
  assert.equal(isDuplicateQuestion('Why does Earth orbit the Sun?', ['Why does Earth orbit the Sun!']), true);
  assert.equal(
    isDuplicateQuestion('Explain why planet Earth travels around the Sun', ['Why does planet Earth travel around the Sun?']),
    true
  );
});

test('cognitive difficulty ladder adapts to board rows', () => {
  const mixed = createSlotPlan(spec({ columns: 1, rows: 6, difficulty: 'mixed' }), categories(1));
  assert.deepEqual(mixed.map(slot => slot.tier), [
    'foundation', 'connection', 'application', 'reasoning', 'challenge', 'expert',
  ]);
  assert.deepEqual(mixed.map(slot => slot.points), [100, 200, 300, 400, 500, 600]);

  const easy = createSlotPlan(spec({ columns: 1, rows: 3, difficulty: 'easy' }), categories(1));
  assert.deepEqual(easy.map(slot => slot.tier), ['foundation', 'foundation', 'connection']);

  const hard = createSlotPlan(spec({ columns: 1, rows: 3, difficulty: 'hard' }), categories(1));
  assert.deepEqual(hard.map(slot => slot.tier), ['reasoning', 'challenge', 'expert']);
  assert.ok(mixed.every(slot => typeof slot.tierSkill === 'string' && slot.tierSkill.length > 0));
});

test('all supported board dimensions produce exactly one question per slot', () => {
  for (let columns = 1; columns <= 8; columns += 1) {
    for (let rows = 1; rows <= 6; rows += 1) {
      const plan = createSlotPlan(spec({ columns, rows, questionType: 'mixed', difficulty: 'mixed' }), categories(columns));
      const result = validateCompleteQuiz(plan, plan.map(validQuestion));
      assert.equal(plan.length, columns * rows);
      assert.equal(result.valid, true, `${columns}x${rows}: ${result.reason}`);
    }
  }
});
