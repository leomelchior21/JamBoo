import assert from 'node:assert/strict';
import test from 'node:test';

process.env.OLLAMA_URL = 'https://ollama.test';
process.env.QUESTION_BATCH_SIZE = '6';
process.env.MAX_REPAIR_ATTEMPTS = '2';

const { default: handler } = await import('../api/ai.js');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function callApi(body) {
  const res = responseRecorder();
  await handler({ method: 'POST', body }, res);
  return res;
}

function ollamaResponse(content) {
  return {
    ok: true,
    status: 200,
    async json() { return { message: { content: JSON.stringify(content) } }; },
  };
}

const baseQuiz = {
  topic: 'Planets',
  language: 'English',
  columns: 1,
  rows: 2,
  difficulty: 'easy',
  questionType: 'multiple',
  seed: 'test-seed',
  generationId: 'test-generation',
  categories: ['Solar System'],
};

test('quiz plan returns code-created slots and configured batch size', { concurrency: false }, async () => {
  globalThis.fetch = async () => ollamaResponse({ categories: ['Solar System'] });
  const res = await callApi({ action: 'quiz-plan', quiz: { ...baseQuiz, categories: undefined } });
  assert.equal(res.statusCode, 200);
  const plan = JSON.parse(res.body.answer);
  assert.deepEqual(plan.slots.map(slot => slot.slotId), ['0-0', '0-1']);
  assert.deepEqual(plan.slots.map(slot => slot.points), [100, 200]);
  assert.equal(plan.batchSize, 6);
});

test('uses safe generic categories when category JSON cannot be generated', { concurrency: false }, async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return ollamaResponse({ categories: ['Repeated', 'Repeated'] });
  };
  const res = await callApi({
    action: 'quiz-plan',
    quiz: { ...baseQuiz, topic: 'An unusual teacher-defined topic', columns: 2, categories: undefined },
  });
  assert.equal(res.statusCode, 200);
  const plan = JSON.parse(res.body.answer);
  assert.equal(calls, 2);
  assert.deepEqual(plan.categories, ['Overview', 'Key Elements']);
  assert.equal(plan.slots.length, 4);
});

test('repairs only a malformed slot and preserves the valid result', { concurrency: false }, async () => {
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    if (calls.length === 1) {
      return ollamaResponse({ qs: [
        { slotId: '0-0', q: 'Which planet is known as the Red Planet?', o: ['Mars', 'Venus', 'Earth', 'Jupiter'], i: 0 },
        { slotId: '0-1', q: 'Which planet has visible rings?', o: ['Saturn', 'Saturn', 'Mars', 'Earth'], i: 0 },
      ] });
    }
    return ollamaResponse({ qs: [
      { slotId: '0-1', q: 'Which planet is famous for its broad ring system?', o: ['Earth', 'Mars', 'Saturn', 'Venus'], i: 2 },
    ] });
  };

  const res = await callApi({
    action: 'quiz-batch',
    quiz: { ...baseQuiz, slotIds: ['0-0', '0-1'], excludedQuestions: [] },
  });
  assert.equal(res.statusCode, 200);
  const batch = JSON.parse(res.body.answer);
  assert.equal(calls.length, 2);
  assert.equal(batch.repaired, 1);
  assert.equal(batch.questions[0].q, 'Which planet is known as the Red Planet?');
  assert.equal(batch.questions[1].slotId, '0-1');
});

test('detects a missing model result and generates only that slot', { concurrency: false }, async () => {
  const requestedSchemas = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    requestedSchemas.push(request.format.properties.qs);
    if (requestedSchemas.length === 1) {
      return ollamaResponse({ qs: [
        { slotId: '0-0', q: 'Which planet is closest to the Sun?', o: ['Mercury', 'Mars', 'Earth', 'Neptune'], i: 0 },
      ] });
    }
    return ollamaResponse({ qs: [
      { slotId: '0-1', q: 'Which planet is the largest in the Solar System?', o: ['Mars', 'Jupiter', 'Earth', 'Venus'], i: 1 },
    ] });
  };

  const res = await callApi({
    action: 'quiz-batch',
    quiz: { ...baseQuiz, slotIds: ['0-0', '0-1'], excludedQuestions: [] },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(requestedSchemas.length, 2);
  assert.equal(requestedSchemas[1].minItems, 1);
  assert.equal(JSON.parse(res.body.answer).questions.length, 2);
});

test('final validation refuses an incomplete draft', { concurrency: false }, async () => {
  globalThis.fetch = async () => { throw new Error('should not call Ollama'); };
  const res = await callApi({
    action: 'quiz-validate',
    quiz: {
      ...baseQuiz,
      questions: [
        { slotId: '0-0', q: 'Which planet is known as the Red Planet?', o: ['Mars', 'Venus', 'Earth', 'Jupiter'], i: 0 },
      ],
    },
  });
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'INVALID_AI_RESPONSE');
});

test('final validation marks only a complete draft ready', { concurrency: false }, async () => {
  globalThis.fetch = async () => { throw new Error('should not call Ollama'); };
  const questions = [
    { slotId: '0-0', q: 'Which planet is known as the Red Planet?', o: ['Mars', 'Venus', 'Earth', 'Jupiter'], i: 0 },
    { slotId: '0-1', q: 'Which planet is famous for a broad ring system?', o: ['Earth', 'Mars', 'Saturn', 'Venus'], i: 2 },
  ];
  const res = await callApi({ action: 'quiz-validate', quiz: { ...baseQuiz, questions } });
  assert.equal(res.statusCode, 200);
  const finalized = JSON.parse(res.body.answer);
  assert.equal(finalized.ready, true);
  assert.equal(finalized.questions.length, 2);
});

test('returns a useful fast failure when Ollama is unavailable', { concurrency: false }, async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  const res = await callApi({
    action: 'quiz-plan',
    quiz: { ...baseQuiz, categories: undefined },
  });
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'AI server unavailable');
});
