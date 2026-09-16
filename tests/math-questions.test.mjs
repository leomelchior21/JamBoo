import assert from 'node:assert/strict';
import test from 'node:test';

import { generateMathQuestion, solveArithmetic, verifyArithmeticAnswer } from '../api/math-questions.mjs';

test('solves pure arithmetic deterministically', () => {
  assert.equal(solveArithmetic('6 × 7'), '42');
  assert.equal(solveArithmetic('What is 12 × 7?'), '84');
  assert.equal(solveArithmetic('Quanto é 42 ÷ 6?'), '7');
  assert.equal(solveArithmetic('¿Cuánto es 8 + 9?'), '17');
  assert.equal(solveArithmetic('6 × 7 + 5'), '47');
  assert.equal(solveArithmetic('100 - 45'), '55');
  assert.equal(solveArithmetic('18 ÷ 4'), '4.5');
});

test('refuses to solve word problems and non arithmetic text', () => {
  assert.equal(solveArithmetic('How many moons does Mars have?'), null);
  assert.equal(solveArithmetic('How many minutes are in 3 × 4 hours?'), null);
  assert.equal(solveArithmetic('Which planet is 3rd from the Sun?'), null);
  assert.equal(solveArithmetic(''), null);
});

test('verifies model answers against computed arithmetic', () => {
  assert.deepEqual(verifyArithmeticAnswer('What is 12 × 7?', '84'), { checked: true, valid: true, computed: '84' });
  assert.deepEqual(verifyArithmeticAnswer('What is 12 × 7?', '96'), { checked: true, valid: false, computed: '84' });
  assert.deepEqual(verifyArithmeticAnswer('What color is the sky?', 'blue'), { checked: false, valid: true, computed: null });
});

test('generates deterministic multiple-choice questions with computed answers', () => {
  const slot = {
    slotId: '0-0',
    category: 'Multiplication',
    categoryIndex: 0,
    rowIndex: 0,
    type: 'multiple',
    difficulty: 'easy',
    tier: 'foundation',
    points: 100,
  };
  const spec = { language: 'English', seed: 'seed-a' };
  const first = generateMathQuestion(slot, spec);
  const second = generateMathQuestion(slot, spec);
  assert.deepEqual(first.question, second.question);

  const question = first.question;
  assert.equal(question.slotId, '0-0');
  assert.equal(question.o.length, 4);
  assert.equal(new Set(question.o).size, 4);
  assert.equal(question.o[question.i], solveArithmetic(question.q));
  assert.match(first.evidence.claim, /=/);
  assert.equal(first.evidence.answer, solveArithmetic(question.q));
  assert.equal(first.evidence.route, 'math');
});

test('generates open and drawing math questions with code-checked answers', () => {
  const baseSlot = {
    category: 'Fractions',
    categoryIndex: 1,
    rowIndex: 1,
    difficulty: 'medium',
    points: 200,
  };
  const open = generateMathQuestion({ ...baseSlot, slotId: '1-1', type: 'open', tier: 'application' }, { language: 'Portuguese', seed: 'seed-b' });
  assert.equal(open.question.slotId, '1-1');
  assert.ok(open.question.q.length > 0);
  assert.equal(open.evidence.answer, solveArithmetic(open.question.q));

  const drawing = generateMathQuestion({ ...baseSlot, slotId: '1-2', type: 'drawing', tier: 'application' }, { language: 'Spanish', seed: 'seed-b' });
  assert.equal(drawing.question.d, 1);
  assert.ok(drawing.question.a.length > 0);
});
