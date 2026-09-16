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

function jsonResponse(content) {
  return {
    ok: true,
    status: 200,
    async json() { return content; },
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

test('quiz plan routes categories through the knowledge router', { concurrency: false }, async () => {
  globalThis.fetch = async () => ollamaResponse({ categories: ['Multiplication', 'SpaceX missions in 2025'] });
  const res = await callApi({
    action: 'quiz-plan',
    quiz: { ...baseQuiz, columns: 2, categories: undefined },
  });
  assert.equal(res.statusCode, 200);
  const plan = JSON.parse(res.body.answer);
  assert.deepEqual(plan.routing.map(entry => entry.route), ['math', 'historical']);
  assert.equal(plan.routing[1].eventFrom, '2025-01-01');
  assert.equal(plan.routing[1].eventTo, '2025-12-31');
  assert.equal(plan.routing[0].query, null);
});

test('math slots are computed in code without calling the model', { concurrency: false }, async () => {
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
  assert.equal(batch.questions.length, 2);
  assert.deepEqual(batch.failedSlots, []);
  batch.questions.forEach(question => {
    assert.equal(question.o.length, 4);
    assert.equal(new Set(question.o).size, 4);
    assert.equal(question.o[question.i], solveArithmetic(question.q));
  });
});

test('a permanently failed slot is reported without blocking the board', { concurrency: false }, async () => {
  globalThis.fetch = async () => ollamaResponse({
    qs: [{ slotId: '0-0', q: 'Which planet is known as the Red Planet?', o: ['Mars', 'Mars', 'Earth', 'Jupiter'], i: 0 }],
  });
  const res = await callApi({
    action: 'quiz-batch',
    quiz: { ...baseQuiz, slotIds: ['0-0'], excludedQuestions: [] },
  });
  assert.equal(res.statusCode, 200);
  const batch = JSON.parse(res.body.answer);
  assert.deepEqual(batch.questions, []);
  assert.deepEqual(batch.failedSlots, ['0-0']);
});

test('historical categories generate questions from retrieved evidence', { concurrency: false }, async () => {
  const ollamaRequests = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('wikipedia.org')) {
      return jsonResponse({
        query: {
          pages: [{
            index: 1,
            title: 'Starship',
            extract: 'In 2025, SpaceX launched Starship Flight 8 from Starbase in Texas. The flight reached space and returned to a controlled splashdown.',
            fullurl: 'https://en.wikipedia.org/wiki/Starship',
          }],
        },
      });
    }
    const request = JSON.parse(init.body);
    ollamaRequests.push(request);
    return ollamaResponse({
      qs: [{ q: 'Which company launched Starship Flight 8 in 2025?', a: 'SpaceX', x: ['Blue Origin', 'NASA', 'Roscosmos'], s: 1 }],
    });
  };

  const res = await callApi({
    action: 'quiz-batch',
    quiz: {
      ...baseQuiz,
      topic: 'SpaceX',
      columns: 1,
      rows: 1,
      categories: ['SpaceX missions in 2025'],
      slotIds: ['0-0'],
      excludedQuestions: [],
    },
  });
  assert.equal(res.statusCode, 200);
  const batch = JSON.parse(res.body.answer);
  assert.equal(batch.questions.length, 1);
  assert.equal(batch.questions[0].q, 'Which company launched Starship Flight 8 in 2025?');
  assert.equal(batch.questions[0].o[batch.questions[0].i], 'SpaceX');
  assert.equal(ollamaRequests.length, 1);
  const systemPrompt = ollamaRequests[0].messages[0].content;
  assert.match(systemPrompt, /In 2025, SpaceX launched Starship Flight 8 from Starbase in Texas\./);
  assert.match(systemPrompt, /tied to the FACT's own period and metric/);
});

test('current categories without a live search provider fail safely', { concurrency: false }, async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('should not be called'); };
  const res = await callApi({
    action: 'quiz-batch',
    quiz: {
      ...baseQuiz,
      topic: 'Olympics',
      columns: 1,
      rows: 1,
      categories: ['Latest medal records'],
      slotIds: ['0-0'],
      excludedQuestions: [],
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls, 0);
  const batch = JSON.parse(res.body.answer);
  assert.deepEqual(batch.questions, []);
  assert.deepEqual(batch.failedSlots, ['0-0']);
});

test('final validation accepts missing slots for a partial board', { concurrency: false }, async () => {
  globalThis.fetch = async () => { throw new Error('should not call Ollama'); };
  const questions = [
    { slotId: '0-0', q: 'Which planet is known as the Red Planet?', o: ['Mars', 'Venus', 'Earth', 'Jupiter'], i: 0 },
  ];
  const res = await callApi({
    action: 'quiz-validate',
    quiz: { ...baseQuiz, questions, missingSlotIds: ['0-1'] },
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
    { slotId: '0-0', q: 'Which planet is known as the Red Planet?', o: ['Mars', 'Venus', 'Earth', 'Jupiter'], i: 0 },
  ];
  const res = await callApi({
    action: 'quiz-validate',
    quiz: { ...baseQuiz, questions, missingSlotIds: [] },
  });
  assert.equal(res.statusCode, 502);
});

test('evidence questions follow the planned slot type on mixed boards', { concurrency: false }, async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('wikipedia.org')) {
      return jsonResponse({
        query: {
          pages: [{
            index: 1,
            title: 'SpaceX in 2025',
            extract: 'In 2025, SpaceX launched Starship Flight 8 from Starbase in Texas. SpaceX also launched Starlink satellites during 2025.',
            fullurl: 'https://en.wikipedia.org/wiki/SpaceX',
          }],
        },
      });
    }
    const request = JSON.parse(init.body);
    const system = request.messages[0].content;
    if (system.includes('category headings')) return ollamaResponse({ categories: ['SpaceX missions in 2025'] });
    const slotFormats = request.format?.properties?.qs?.prefixItems ?? [];
    const qs = slotFormats.map((item, index) => {
      if (!item.properties?.s) throw new Error('expected the evidence format');
      const sourceId = item.properties.s.enum[index % item.properties.s.enum.length];
      if (item.properties.x) {
        return { q: `Which company ran Starship mission ${sourceId} in 2025?`, a: 'SpaceX', x: ['Blue Origin', 'NASA', 'Roscosmos'], s: sourceId };
      }
      if (item.properties.d) {
        return { q: `Draw the mission from fact ${sourceId} and label the company.`, a: 'SpaceX', s: sourceId, d: 1 };
      }
      return { q: `Which company ran Starship mission ${sourceId} in 2025?`, a: 'SpaceX', s: sourceId };
    });
    return ollamaResponse({ qs });
  };

  const spec = { ...baseQuiz, topic: 'SpaceX', questionType: 'mixed', categories: undefined };
  const planRes = await callApi({ action: 'quiz-plan', quiz: spec });
  assert.equal(planRes.statusCode, 200);
  const plan = JSON.parse(planRes.body.answer);

  const batchRes = await callApi({
    action: 'quiz-batch',
    quiz: { ...spec, categories: plan.categories, slotIds: ['0-0', '0-1'], excludedQuestions: [] },
  });
  assert.equal(batchRes.statusCode, 200);
  const batch = JSON.parse(batchRes.body.answer);
  assert.deepEqual(batch.failedSlots, []);
  plan.slots.forEach(slot => {
    const question = batch.questions.find(candidate => candidate.slotId === slot.slotId);
    assert.ok(question, `missing ${slot.slotId}`);
    if (slot.type === 'multiple') assert.ok(Array.isArray(question.o));
    if (slot.type === 'open') assert.equal(typeof question.a, 'string');
    if (slot.type === 'drawing') assert.equal(question.d, 1);
  });

  const validateRes = await callApi({
    action: 'quiz-validate',
    quiz: { ...spec, categories: plan.categories, questions: batch.questions, missingSlotIds: [] },
  });
  assert.equal(validateRes.statusCode, 200, JSON.stringify(validateRes.body));
});

test('quiz plan expands fewer topics and groups more topics', { concurrency: false }, async () => {
  const systems = [];
  globalThis.fetch = async (_url, init) => {
    systems.push(JSON.parse(init.body).messages[0].content);
    return ollamaResponse({ categories: ['Songs', 'Albums', 'Career', 'Performances'] });
  };
  const expanded = await callApi({
    action: 'quiz-plan',
    quiz: { ...baseQuiz, topic: 'Olivia Rodrigo', columns: 4, rows: 2, categories: undefined },
  });
  assert.equal(expanded.statusCode, 200);
  assert.match(systems[0], /Decompose each supplied topic/);
  assert.equal(JSON.parse(expanded.body.answer).categories.length, 4);

  systems.length = 0;
  globalThis.fetch = async (_url, init) => {
    systems.push(JSON.parse(init.body).messages[0].content);
    return ollamaResponse({ categories: ['SpaceX', 'Mars'] });
  };
  const grouped = await callApi({
    action: 'quiz-plan',
    quiz: { ...baseQuiz, topic: 'SpaceX, Mars, Europa, Titan, Venus, Ceres', columns: 2, rows: 2, categories: undefined },
  });
  assert.equal(grouped.statusCode, 200);
  assert.match(systems[0], /Group closely related topics/);
  assert.equal(JSON.parse(grouped.body.answer).categories.length, 2);
});

test('locked-category math requests are computed in code', { concurrency: false }, async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('the model must not be used for math'); };
  const res = await callApi({
    action: 'quiz-category',
    quiz: {
      topic: 'Math practice',
      language: 'English',
      category: 'Multiplication',
      categoryCount: 1,
      categoryIndex: 0,
      rows: 2,
      questionType: 'open',
      difficulty: 'easy',
      allCategories: ['Multiplication'],
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls, 0);
  const quiz = JSON.parse(res.body.answer);
  assert.deepEqual(quiz.c, ['Multiplication']);
  assert.equal(quiz.qs[0].length, 2);
  quiz.qs[0].forEach(question => {
    assert.equal(typeof question.a, 'string');
    assert.equal(question.a, solveArithmetic(question.q));
  });
});
