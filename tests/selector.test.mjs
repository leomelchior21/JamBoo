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
  const topics = repository.topics.filter(entry => !entry.isSubtopic);
  const subtopics = repository.topics.filter(entry => entry.isSubtopic);
  assert.equal(topics.length, 25, 'expected 25 seed topics');
  assert.ok(topics.every(entry => entry.questions.length >= 20), 'every seed topic has 20+ questions');
  assert.ok(subtopics.length >= 80, 'every topic exposes specific subtopic units');
  assert.ok(subtopics.every(entry => entry.questions.length >= 5), 'every subtopic has a usable pool');

  const seenIds = new Set();
  for (const entry of topics) {
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
  assert.ok(seenIds.size >= 800, 'expected a large curated repository');

  // The engine must not silently drop curated questions (e.g. operator
  // answers such as =, ==, === or !=).
  const eligible = repository.topics
    .filter(entry => !entry.isSubtopic)
    .reduce((sum, entry) => sum + entry.questions.length, 0);
  assert.equal(eligible, seenIds.size, 'every curated question must stay selectable');
});

test('operator answers survive the eligibility check', () => {
  const operatorQuestions = [
    'GEN-CODE-024', 'GEN-CODE-038', 'GEN-CODE-075', 'GEN-CODE-078', 'GEN-CODE-062', 'GEN-CODE-009',
  ];
  for (const id of operatorQuestions) {
    const question = repository.topics
      .flatMap(entry => entry.questions)
      .find(candidate => candidate.id === id);
    assert.ok(question, `${id} must stay in the repository`);
  }
  const python = repository.byId['coding-languages::python'];
  const swift = repository.byId['coding-languages::swift'];
  const csharp = repository.byId['coding-languages::csharp'];
  const javascript = repository.byId['coding-languages::javascript'];
  assert.equal(python.questions.length, 20);
  assert.equal(swift.questions.length, 20);
  assert.equal(csharp.questions.length, 20);
  assert.equal(javascript.questions.length, 20);
});

test('printing, variables and operators are selectable subtopics with 40 questions each', () => {
  const languages = ['python', 'swift', 'csharp'];
  const families = ['printing', 'variables', 'operators'];
  for (const language of languages) {
    for (const family of families) {
      const id = `coding-languages::${language}-${family}`;
      const unit = repository.byId[id];
      assert.ok(unit?.isSubtopic, `${id} must be a selectable subtopic`);
      assert.equal(unit.questions.length, 40, `${id} must keep 40 questions`);
      assert.equal(engine.maxColumnsForTopic(unit, 5), 8);
    }
  }

  assert.ok(engine.searchTopics(repository, 'python printing').some(entry => entry.id === 'coding-languages::python-printing'));
  assert.ok(engine.searchTopics(repository, 'impressao swift').some(entry => entry.id === 'coding-languages::swift-printing'));

  const session = engine.buildSession({
    repository,
    topics: [
      { topicId: 'coding-languages::python-printing', columns: 1 },
      { topicId: 'coding-languages::swift-variables', columns: 1 },
      { topicId: 'coding-languages::csharp-operators', columns: 1 },
    ],
    board: { columns: 3, rows: 5 },
    difficulty: 'mixed',
    seed: 'coding-subtopics',
  });
  assert.deepEqual(session.categories, ['Python \u00b7 Printing', 'Swift \u00b7 Variables', 'C# \u00b7 Operators']);
  assert.equal(session.questionIds.length, 15);
  assert.equal(new Set(session.questionIds).size, 15);
  session.questions.forEach((column, index) => {
    const sourceIds = new Set(repository.byId[session.columnTopics[index]].questions.map(question => question.id));
    column.forEach(question => assert.ok(sourceIds.has(question.id), `${question.id} is outside ${session.columnTopics[index]}`));
    assert.deepEqual(column.map(question => question.difficulty), [1, 1, 2, 2, 3]);
  });
});

test('search matches topic and subtopic metadata without AI', () => {
  assert.equal(engine.searchTopics(repository, 'fraction')[0].id, 'fractions');
  assert.equal(engine.searchTopics(repository, 'frações')[0].id, 'fractions');
  assert.equal(engine.searchTopics(repository, 'solar system')[0].id, 'solar-system');
  assert.equal(engine.searchTopics(repository, 'video games')[0].id, 'video-games');
  assert.ok(engine.searchTopics(repository, 'minecraft').some(entry => entry.id === 'video-games::minecraft'));
  assert.ok(engine.searchTopics(repository, 'taylor swift').some(entry => entry.id === 'celebrities::pop-stars'));
  assert.ok(engine.searchTopics(repository, 'pokemon').some(entry => entry.id === 'video-games::pokemon'));
  assert.ok(engine.searchTopics(repository, 'samba').some(entry => entry.id === 'music::brazil-world'));
  assert.deepEqual(engine.searchTopics(repository, 'zzzz'), []);
});

test('subtopics are selectable quiz units with their own pool', () => {
  const minecraft = repository.byId['video-games::minecraft'];
  assert.ok(minecraft?.isSubtopic, 'minecraft must be a selectable subtopic');
  assert.equal(minecraft.questions.length, 8);
  assert.equal(engine.maxColumnsForTopic(minecraft, 5), 1);

  const session = engine.buildSession({
    repository,
    topics: [{ topicId: 'video-games::minecraft', columns: 1 }],
    board: { columns: 1, rows: 5 },
    difficulty: 'mixed',
    seed: 'subtopic-check',
  });
  assert.deepEqual(session.categories, ['Minecraft']);
  assert.deepEqual(session.columnTopics, ['video-games::minecraft']);
  const sourceIds = new Set(minecraft.questions.map(question => question.id));
  session.questions[0].forEach(question => assert.ok(sourceIds.has(question.id), `${question.id} is not a Minecraft question`));

  const popStars = repository.byId['celebrities::pop-stars'];
  assert.ok(popStars.questions.some(question => question.question.includes('Taylor Swift')));

  const subtopicSession = engine.buildSession({
    repository,
    topics: [{ topicId: 'celebrities::pop-stars', columns: 2 }],
    board: { columns: 2, rows: 4 },
    difficulty: 'mixed',
    seed: 'subtopic-check-2',
  });
  assert.deepEqual(subtopicSession.categories, ['Taylor Swift & Pop Stars I', 'Taylor Swift & Pop Stars II']);
  assert.equal(new Set(subtopicSession.questionIds).size, 8);
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
  const narrow = topic('video-games::minecraft');
  assert.equal(narrow.questions.length, 8);
  assert.equal(engine.maxColumnsForTopic(narrow, 6), 1);

  const validation = engine.validateConfiguration({
    repository,
    topics: [{ topicId: 'video-games::minecraft', columns: 4 }],
    board: { columns: 4, rows: 6 },
  });
  assert.equal(validation.ok, false);
  const issue = validation.issues.find(candidate => candidate.type === 'insufficient');
  assert.equal(issue.available, 8);
  assert.equal(issue.required, 24);

  assert.throws(() => engine.buildSession({
    repository,
    topics: [{ topicId: 'video-games::minecraft', columns: 4 }],
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
