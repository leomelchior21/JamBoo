import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadEngine() {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const startMarker = '/* ═══ ENGINE START ═══ */';
  const endMarker = '/* ═══ ENGINE END ═══ */';
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, 'index.html must expose the engine block');
  const code = html.slice(start + startMarker.length, end);
  return new Function(`${code}; return JamBooEngine;`)();
}

function loadRepository() {
  const source = readFileSync(path.join(root, 'data', 'questions.js'), 'utf8');
  return new Function(`${source}; return globalThis.JAMBOO_QUESTION_REPOSITORY;`)();
}

const engine = loadEngine();
const rawRepository = loadRepository();
const repository = engine.buildRepository(rawRepository, 'en');

const topic = id => repository.byId[id];
const idsOf = session => session.questionIds;
const questionsOf = session => session.questions.flat();

test('repository is valid curated content', () => {
  assert.ok(repository.topics.length >= 8, 'expected at least 8 seed topics');
  assert.ok(repository.topics.every(entry => entry.questions.length >= 20), 'every seed topic has 20+ questions');

  const seenIds = new Set();
  for (const entry of repository.topics) {
    const subtopicIds = new Set(entry.subtopics.map(subtopic => subtopic.id));
    for (const question of entry.questions) {
      assert.ok(question.id && !seenIds.has(question.id), `duplicate question id ${question.id}`);
      seenIds.add(question.id);
      assert.equal(question.choices.length, 4, `${question.id} must have 4 choices`);
      assert.equal(new Set(question.choices).size, 4, `${question.id} choices must be unique`);
      assert.ok(Number.isInteger(question.correctAnswer) && question.correctAnswer >= 0 && question.correctAnswer <= 3, `${question.id} correctAnswer`);
      assert.ok(question.difficulty >= 1 && question.difficulty <= 3, `${question.id} difficulty`);
      assert.ok(subtopicIds.has(question.subtopic), `${question.id} references an unknown subtopic`);
    }
  }
});

test('search matches topic metadata without AI', () => {
  assert.deepEqual(engine.searchTopics(repository, 'fraction').map(entry => entry.id), ['fractions']);
  assert.deepEqual(engine.searchTopics(repository, 'frações').map(entry => entry.id), ['fractions']);
  assert.deepEqual(engine.searchTopics(repository, 'solar system').map(entry => entry.id), ['solar-system']);
  assert.deepEqual(engine.searchTopics(repository, 'video games').map(entry => entry.id), ['video-games']);
  assert.deepEqual(engine.searchTopics(repository, 'zzzz'), []);
});

test('column distribution stays even and complete', () => {
  assert.deepEqual(engine.distributeColumns(2, 4), [2, 2]);
  assert.deepEqual(engine.distributeColumns(3, 4), [2, 1, 1]);
  assert.deepEqual(engine.distributeColumns(4, 4), [1, 1, 1, 1]);
  assert.equal(engine.distributeColumns(3, 5).reduce((sum, value) => sum + value, 0), 5);
});

test('mixed difficulty progresses across board rows', () => {
  assert.deepEqual(engine.difficultyTargets(5, 'mixed'), [1, 1, 2, 2, 3]);
  assert.deepEqual(engine.difficultyTargets(3, 'mixed'), [1, 2, 3]);
  assert.deepEqual(engine.difficultyTargets(4, 'hard'), [3, 3, 3, 3]);
});

test('TEST A — Fractions x2 + Solar System x2 yields 10 unique questions each', () => {
  const session = engine.buildSession({
    repository,
    topics: [{ topicId: 'fractions', columns: 2 }, { topicId: 'solar-system', columns: 2 }],
    board: { columns: 4, rows: 5 },
    difficulty: 'mixed',
    seed: 'test-a',
  });
  assert.deepEqual(session.categories, ['Fractions I', 'Fractions II', 'Solar System I', 'Solar System II']);
  assert.equal(session.questionIds.length, 20);
  assert.equal(new Set(session.questionIds).size, 20);
  const byTopic = topicId => session.questions.filter((_, index) => session.columnTopics[index] === topicId).flat();
  assert.equal(byTopic('fractions').length, 10);
  assert.equal(byTopic('solar-system').length, 10);
});

test('TEST B — Fractions x3 + Solar System x1 yields 15 + 5', () => {
  const session = engine.buildSession({
    repository,
    topics: [{ topicId: 'fractions', columns: 3 }, { topicId: 'solar-system', columns: 1 }],
    board: { columns: 4, rows: 5 },
    difficulty: 'mixed',
    seed: 'test-b',
  });
  const counts = {};
  session.columnTopics.forEach(topicId => { counts[topicId] = (counts[topicId] || 0) + 5; });
  assert.deepEqual(counts, { fractions: 15, 'solar-system': 5 });
  assert.equal(new Set(session.questionIds).size, 20);
});

test('TEST C — one column per topic pulls 5 questions from each', () => {
  const topics = ['fractions', 'area-perimeter', 'cells', 'video-games'].map(topicId => ({ topicId, columns: 1 }));
  const session = engine.buildSession({ repository, topics, board: { columns: 4, rows: 5 }, difficulty: 'mixed', seed: 'test-c' });
  assert.deepEqual(session.columnTopics, ['fractions', 'area-perimeter', 'cells', 'video-games']);
  session.questions.forEach((column, index) => {
    assert.equal(column.length, 5);
    const sourceIds = new Set(topic(session.columnTopics[index]).questions.map(question => question.id));
    column.forEach(question => assert.ok(sourceIds.has(question.id)));
  });
});

test('TEST D/E — validation blocks unassigned and over-assigned boards', () => {
  const unassigned = engine.validateConfiguration({
    repository,
    topics: [{ topicId: 'fractions', columns: 2 }, { topicId: 'solar-system', columns: 1 }],
    board: { columns: 4, rows: 5 },
  });
  assert.equal(unassigned.ok, false);
  assert.ok(unassigned.issues.some(issue => issue.type === 'unassigned'));

  const overAssigned = engine.validateConfiguration({
    repository,
    topics: [{ topicId: 'fractions', columns: 3 }, { topicId: 'solar-system', columns: 2 }],
    board: { columns: 4, rows: 5 },
  });
  assert.equal(overAssigned.ok, false);
  assert.ok(overAssigned.issues.some(issue => issue.type === 'overassigned'));

  const valid = engine.validateConfiguration({
    repository,
    topics: [{ topicId: 'fractions', columns: 2 }, { topicId: 'solar-system', columns: 2 }],
    board: { columns: 4, rows: 5 },
  });
  assert.equal(valid.ok, true);
});

test('TEST F — a narrow topic reports its real limit and never duplicates', () => {
  const narrow = topic('area-perimeter');
  assert.equal(narrow.questions.length, 20);
  assert.equal(engine.maxColumnsForTopic(narrow, 6), 3);

  const validation = engine.validateConfiguration({
    repository,
    topics: [{ topicId: 'area-perimeter', columns: 4 }],
    board: { columns: 4, rows: 6 },
  });
  assert.equal(validation.ok, false);
  const issue = validation.issues.find(candidate => candidate.type === 'insufficient');
  assert.equal(issue.available, 20);
  assert.equal(issue.required, 24);

  assert.throws(() => engine.buildSession({
    repository,
    topics: [{ topicId: 'area-perimeter', columns: 4 }],
    board: { columns: 4, rows: 6 },
    seed: 'test-f',
  }));
});

test('TEST G/H — repeated games vary and repeated columns never overlap', () => {
  const config = {
    repository,
    topics: [{ topicId: 'fractions', columns: 2 }, { topicId: 'solar-system', columns: 2 }],
    board: { columns: 4, rows: 5 },
    difficulty: 'mixed',
  };
  const first = engine.buildSession({ ...config, seed: 'game-one' });
  const second = engine.buildSession({ ...config, seed: 'game-two' });
  assert.notDeepEqual(idsOf(first).sort(), idsOf(second).sort());

  const avoided = engine.buildSession({ ...config, seed: 'game-three', recentIds: idsOf(first) });
  const overlap = idsOf(avoided).filter(id => idsOf(first).includes(id));
  assert.ok(overlap.length <= 4, `expected mostly fresh questions, got ${overlap.length} repeats`);
});

test('session questions keep one correct answer and shuffle positions', () => {
  const session = engine.buildSession({
    repository,
    topics: [{ topicId: 'fractions', columns: 2 }, { topicId: 'solar-system', columns: 2 }],
    board: { columns: 4, rows: 5 },
    difficulty: 'mixed',
    seed: 'shuffle-check',
  });
  const positions = new Set();
  questionsOf(session).forEach(question => {
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options).size, 4);
    assert.equal(question.answer, question.options[question.correctIndex]);
    assert.equal(question.type, 'multiple');
    positions.add(question.correctIndex);
  });
  assert.ok(positions.size >= 3, 'correct answers must not sit in one fixed position');
});

test('session building never mutates the stored repository records', () => {
  const before = topic('fractions').questions.map(question => question.choices.join('|'));
  engine.buildSession({
    repository,
    topics: [{ topicId: 'fractions', columns: 1 }],
    board: { columns: 1, rows: 5 },
    difficulty: 'mixed',
    seed: 'immutable-check',
  });
  const after = topic('fractions').questions.map(question => question.choices.join('|'));
  assert.deepEqual(after, before);
});

test('difficulty balancing prefers the target level per row', () => {
  const session = engine.buildSession({
    repository,
    topics: [{ topicId: 'fractions', columns: 1 }],
    board: { columns: 1, rows: 5 },
    difficulty: 'mixed',
    seed: 'difficulty-check',
  });
  const difficulties = session.questions[0].map(question => question.difficulty);
  assert.deepEqual(difficulties, [1, 1, 2, 2, 3]);
});

test('inactive or unapproved questions are excluded from selection', () => {
  const filtered = engine.buildRepository({
    defaultLanguage: 'en',
    categories: [{
      id: 'test',
      name: { en: 'Test' },
      subjects: [{
        id: 'subject',
        name: { en: 'Subject' },
        topics: [{
          id: 'topic',
          name: { en: 'Topic' },
          subtopics: [],
          questions: [
            { id: 'ok-1', question: 'Valid question?', choices: ['a', 'b', 'c', 'd'], correctAnswer: 0, difficulty: 1, subtopic: '' },
            { id: 'bad-1', question: 'Inactive?', choices: ['a', 'b', 'c', 'd'], correctAnswer: 0, difficulty: 1, active: false },
            { id: 'bad-2', question: 'Unreviewed?', choices: ['a', 'b', 'c', 'd'], correctAnswer: 0, difficulty: 1, reviewStatus: 'pending' },
            { id: 'bad-3', question: 'Three choices?', choices: ['a', 'b', 'c'], correctAnswer: 0, difficulty: 1 },
          ],
        }],
      }],
    }],
  }, 'en');
  assert.equal(filtered.topics[0].questions.length, 1);
  assert.equal(filtered.topics[0].questions[0].id, 'ok-1');
});
