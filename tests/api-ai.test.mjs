import assert from 'node:assert/strict';
import test from 'node:test';

process.env.OLLAMA_URL = 'https://ollama.test';
process.env.QUESTION_BATCH_SIZE = '6';
process.env.MAX_REPAIR_ATTEMPTS = '2';

const { default: handler } = await import('../api/ai.js');
const { solveArithmetic } = await import('../api/math-questions.mjs');

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

function ollamaRaw(content) {
  return {
    ok: true,
    status: 200,
    async json() { return { message: { content } }; },
  };
}

function slotIdsFromRequest(request) {
  return (request.format?.properties?.qs?.prefixItems ?? [])
    .map(item => item.properties.slotId.enum[0]);
}

function answerForRequest(request, index) {
  const slotId = slotIdsFromRequest(request)[index];
  return index === 0
    ? { slotId, q: 'Which planet is known as the Red Planet?', a: 'Mars', x: ['Venus', 'Earth', 'Mercury'] }
    : { slotId, q: 'Which planet is the largest in the Solar System?', a: 'Jupiter', x: ['Saturn', 'Neptune', 'Venus'] };
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
};

test('a comma topic list that matches the board becomes categories without a model call', { concurrency: false }, async () => {
  globalThis.fetch = async () => { throw new Error('the model must not be called'); };
  const res = await callApi({
    action: 'quiz-plan',
    quiz: { ...baseQuiz, topic: 'SpaceX, Mars', columns: 2 },
  });
  assert.equal(res.statusCode, 200);
  const plan = JSON.parse(res.body.answer);
  assert.deepEqual(plan.categories, ['SpaceX', 'Mars']);
  assert.deepEqual(plan.slots.map(slot => slot.slotId), ['0-0', '0-1', '1-0', '1-1']);
  assert.deepEqual(plan.slots.map(slot => slot.points), [100, 200, 100, 200]);
  assert.equal(plan.batchSize, 6);
  assert.equal(typeof plan.kind, 'string');
});

test('client supplied categories skip planning entirely', { concurrency: false }, async () => {
  globalThis.fetch = async () => { throw new Error('the model must not be called'); };
  const res = await callApi({
    action: 'quiz-plan',
    quiz: { ...baseQuiz, columns: 2, explicitCategories: ['Solar System', 'Deep Space'] },
  });
  assert.equal(res.statusCode, 200);
  const plan = JSON.parse(res.body.answer);
  assert.deepEqual(plan.categories, ['Solar System', 'Deep Space']);
});

test('plans headings with the model and keeps the classified kind', { concurrency: false }, async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return ollamaResponse({ kind: 'games', categories: ['Origins', 'Characters'] });
  };
  const res = await callApi({
    action: 'quiz-plan',
    quiz: { ...baseQuiz, topic: 'Minecraft', columns: 2 },
  });
  assert.equal(res.statusCode, 200);
  const plan = JSON.parse(res.body.answer);
  assert.equal(calls, 1);
  assert.deepEqual(plan.categories, ['Origins', 'Characters']);
  assert.equal(plan.kind, 'games');
});

test('repairs an unusable category plan on the second attempt', { concurrency: false }, async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? ollamaRaw('I cannot answer that.')
      : ollamaResponse({ kind: 'general', categories: ['Origins', 'Chemistry'] });
  };
  const res = await callApi({
    action: 'quiz-plan',
    quiz: { ...baseQuiz, topic: 'Minecraft', columns: 2 },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls, 2);
  assert.deepEqual(JSON.parse(res.body.answer).categories, ['Origins', 'Chemistry']);
});

test('falls back to deterministic categories when the model cannot plan', { concurrency: false }, async () => {
  globalThis.fetch = async () => ollamaResponse({ categories: ['Overview', 'Overview'] });
  const res = await callApi({
    action: 'quiz-plan',
    quiz: { ...baseQuiz, topic: 'An unusual teacher-defined topic', columns: 2 },
  });
  assert.equal(res.statusCode, 200);
  const plan = JSON.parse(res.body.answer);
  assert.equal(plan.categories.length, 2);
  assert.equal(plan.categories[0], 'An unusual teacher-defined topic');
  assert.match(plan.categories[1], /^An unusual teacher-defined topic: /);
});

test('builds complete multiple-choice questions from answers and distractors', { concurrency: false }, async () => {
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    return ollamaResponse({ qs: [answerForRequest(request, 0), answerForRequest(request, 1)] });
  };
  const res = await callApi({
    action: 'quiz-batch',
    quiz: { ...baseQuiz, categories: ['Solar System'], slotIds: ['0-0', '0-1'], excludedQuestions: [] },
  });
  assert.equal(res.statusCode, 200);
  const batch = JSON.parse(res.body.answer);
  assert.deepEqual(batch.failedSlots, []);
  assert.equal(batch.questions.length, 2);
  batch.questions.forEach(question => {
    assert.equal(question.o.length, 4);
    assert.equal(new Set(question.o).size, 4);
    assert.equal(question.o[question.i], question.a);
  });
  assert.equal(batch.questions[0].a, 'Mars');
});

test('repairs only the rejected slot and keeps the valid one', { concurrency: false }, async () => {
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const request = JSON.parse(init.body);
    const slotIds = slotIdsFromRequest(request);
    if (calls === 1) {
      return ollamaResponse({ qs: [
        { slotId: slotIds[0], q: 'Which planet is known as the Red Planet?', a: 'Mars', x: ['Venus', 'Earth', 'Mercury'] },
        { slotId: slotIds[1], q: 'Which planet is known for its rings?', a: 'Saturn', x: ['Saturn', 'Mars', 'Earth'] },
      ] });
    }
    return ollamaResponse({ qs: [
      { slotId: slotIds[0], q: 'Which planet is famous for its broad ring system?', a: 'Saturn', x: ['Earth', 'Mars', 'Venus'] },
    ] });
  };
  const res = await callApi({
    action: 'quiz-batch',
    quiz: { ...baseQuiz, categories: ['Solar System'], slotIds: ['0-0', '0-1'], excludedQuestions: [] },
  });
  assert.equal(res.statusCode, 200);
  const batch = JSON.parse(res.body.answer);
  assert.equal(calls, 2);
  assert.equal(batch.repaired, 1);
  assert.deepEqual(batch.failedSlots, []);
  assert.equal(batch.questions[0].a, 'Mars');
  assert.equal(batch.questions[1].a, 'Saturn');
});

test('a permanently failed slot is reported without blocking the board', { concurrency: false }, async () => {
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const request = JSON.parse(init.body);
    const slotId = slotIdsFromRequest(request)[0];
    return ollamaResponse({ qs: [
      { slotId, q: 'Which planet is known as the Red Planet?', a: 'Mars', x: ['Mars', 'Mars', 'Earth'] },
    ] });
  };
  const res = await callApi({
    action: 'quiz-batch',
    quiz: { ...baseQuiz, columns: 1, rows: 1, categories: ['Solar System'], slotIds: ['0-0'], excludedQuestions: [] },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls, 3);
  const batch = JSON.parse(res.body.answer);
  assert.deepEqual(batch.questions, []);
  assert.deepEqual(batch.failedSlots, ['0-0']);
});

test('rejects questions already used in another batch', { concurrency: false }, async () => {
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const request = JSON.parse(init.body);
    const slotId = slotIdsFromRequest(request)[0];
    return ollamaResponse({ qs: [
      { slotId, q: 'Which planet is known as the Red Planet?', a: 'Mars', x: ['Venus', 'Earth', 'Mercury'] },
    ] });
  };
  const res = await callApi({
    action: 'quiz-batch',
    quiz: {
      ...baseQuiz,
      columns: 1,
      rows: 1,
      categories: ['Solar System'],
      slotIds: ['0-0'],
      excludedQuestions: ['Which planet is known as the Red Planet?'],
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls, 3);
  assert.deepEqual(JSON.parse(res.body.answer).failedSlots, ['0-0']);
});

test('rejects changing-fact questions in code', { concurrency: false }, async () => {
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    const slotId = slotIdsFromRequest(request)[0];
    return ollamaResponse({ qs: [
      { slotId, q: 'Who is the latest champion of this tournament?', a: 'Nova', x: ['Orion', 'Vega', 'Lyra'] },
    ] });
  };
  const res = await callApi({
    action: 'quiz-batch',
    quiz: { ...baseQuiz, columns: 1, rows: 1, categories: ['Champions'], slotIds: ['0-0'], excludedQuestions: [] },
  });
  assert.equal(res.statusCode, 200);
  const batch = JSON.parse(res.body.answer);
  assert.deepEqual(batch.questions, []);
  assert.deepEqual(batch.failedSlots, ['0-0']);
});

test('rejects answers that do not match the requested slot type', { concurrency: false }, async () => {
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    const slotId = slotIdsFromRequest(request)[0];
    return ollamaResponse({ qs: [
      { slotId, q: 'Name the largest planet in the Solar System.', a: 'Jupiter' },
    ] });
  };
  const res = await callApi({
    action: 'quiz-batch',
    quiz: { ...baseQuiz, columns: 1, rows: 1, questionType: 'multiple', categories: ['Planets'], slotIds: ['0-0'], excludedQuestions: [] },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body.answer).failedSlots, ['0-0']);
});

test('generates one model call per category in a mixed batch', { concurrency: false }, async () => {
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const request = JSON.parse(init.body);
    const slotId = slotIdsFromRequest(request)[0];
    const question = request.messages[0].content.includes('LOCKED CATEGORY: "Planets"')
      ? { slotId, q: 'Which planet is known as the Red Planet?', a: 'Mars', x: ['Venus', 'Earth', 'Mercury'] }
      : { slotId, q: 'What is the closest star to Earth?', a: 'The Sun', x: ['Sirius', 'Polaris', 'Vega'] };
    return ollamaResponse({ qs: [question] });
  };
  const res = await callApi({
    action: 'quiz-batch',
    quiz: {
      ...baseQuiz,
      columns: 2,
      rows: 1,
      categories: ['Planets', 'Stars'],
      slotIds: ['0-0', '1-0'],
      excludedQuestions: [],
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls, 2);
  const batch = JSON.parse(res.body.answer);
  assert.deepEqual(batch.failedSlots, []);
  assert.equal(batch.questions.length, 2);
});

test('math categories are computed in code without calling the model', { concurrency: false }, async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('the model must not be used for math'); };
  const res = await callApi({
    action: 'quiz-batch',
    quiz: {
      ...baseQuiz,
      topic: 'Multiplication tables',
      columns: 1,
      rows: 2,
      categories: ['Multiplication'],
      slotIds: ['0-0', '0-1'],
      excludedQuestions: [],
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls, 0);
  const batch = JSON.parse(res.body.answer);
  assert.deepEqual(batch.failedSlots, []);
  assert.equal(batch.questions.length, 2);
  batch.questions.forEach(question => {
    assert.equal(question.o.length, 4);
    assert.equal(new Set(question.o).size, 4);
    assert.equal(question.o[question.i], question.a);
    assert.ok(Number.isFinite(Number(question.a)));
  });
});

test('question prompts carry the classified voice', { concurrency: false }, async () => {
  const systems = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    systems.push(request.messages[0].content);
    const slotId = slotIdsFromRequest(request)[0];
    return ollamaResponse({ qs: [
      { slotId, q: 'Which block explodes when a player gets too close?', a: 'Creeper', x: ['Zombie', 'Skeleton', 'Slime'] },
    ] });
  };
  const res = await callApi({
    action: 'quiz-batch',
    quiz: {
      ...baseQuiz,
      columns: 1,
      rows: 1,
      topic: 'Roblox',
      kind: 'games',
      categories: ['Game history'],
      slotIds: ['0-0'],
      excludedQuestions: [],
    },
  });
  assert.equal(res.statusCode, 200);
  assert.match(systems[0], /gamer trivia-night energy/);
  assert.match(systems[0], /Stable facts only/);
});

test('final validation refuses an incomplete draft', { concurrency: false }, async () => {
  globalThis.fetch = async () => { throw new Error('should not call Ollama'); };
  const res = await callApi({
    action: 'quiz-validate',
    quiz: {
      ...baseQuiz,
      categories: ['Solar System'],
      questions: [
        { slotId: '0-0', q: 'Which planet is known as the Red Planet?', a: 'Mars', o: ['Mars', 'Venus', 'Earth', 'Jupiter'], i: 0 },
      ],
    },
  });
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'INVALID_AI_RESPONSE');
});

test('final validation marks only a complete draft ready', { concurrency: false }, async () => {
  globalThis.fetch = async () => { throw new Error('should not call Ollama'); };
  const questions = [
    { slotId: '0-0', q: 'Which planet is known as the Red Planet?', a: 'Mars', o: ['Mars', 'Venus', 'Earth', 'Jupiter'], i: 0 },
    { slotId: '0-1', q: 'Which planet is famous for a broad ring system?', a: 'Saturn', o: ['Earth', 'Mars', 'Saturn', 'Venus'], i: 2 },
  ];
  const res = await callApi({ action: 'quiz-validate', quiz: { ...baseQuiz, categories: ['Solar System'], questions } });
  assert.equal(res.statusCode, 200);
  const finalized = JSON.parse(res.body.answer);
  assert.equal(finalized.ready, true);
  assert.equal(finalized.questions.length, 2);
});

test('final validation accepts missing slots for a partial board', { concurrency: false }, async () => {
  globalThis.fetch = async () => { throw new Error('should not call Ollama'); };
  const questions = [
    { slotId: '0-0', q: 'Which planet is known as the Red Planet?', a: 'Mars', o: ['Mars', 'Venus', 'Earth', 'Jupiter'], i: 0 },
  ];
  const res = await callApi({
    action: 'quiz-validate',
    quiz: { ...baseQuiz, categories: ['Solar System'], questions, missingSlotIds: ['0-1'] },
  });
  assert.equal(res.statusCode, 200);
  const finalized = JSON.parse(res.body.answer);
  assert.equal(finalized.ready, true);
  assert.deepEqual(finalized.missingSlotIds, ['0-1']);
  assert.equal(finalized.questions.length, 1);
});

test('final validation rejects an undocumented missing slot', { concurrency: false }, async () => {
  globalThis.fetch = async () => { throw new Error('should not call Ollama'); };
  const questions = [
    { slotId: '0-0', q: 'Which planet is known as the Red Planet?', a: 'Mars', o: ['Mars', 'Venus', 'Earth', 'Jupiter'], i: 0 },
  ];
  const res = await callApi({
    action: 'quiz-validate',
    quiz: { ...baseQuiz, categories: ['Solar System'], questions, missingSlotIds: [] },
  });
  assert.equal(res.statusCode, 502);
});

test('returns a useful fast failure when Ollama is unavailable', { concurrency: false }, async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  const res = await callApi({
    action: 'quiz-plan',
    quiz: { ...baseQuiz, topic: 'Minecraft', columns: 2 },
  });
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'AI server unavailable');
});

test('rejects malformed quiz requests', { concurrency: false }, async () => {
  const res = await callApi({ action: 'quiz-plan', quiz: { ...baseQuiz, language: 'Klingon' } });
  assert.equal(res.statusCode, 400);
  const unknown = await callApi({ action: 'quiz-magic', quiz: baseQuiz });
  assert.equal(unknown.statusCode, 400);
});
