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
  assert.equal(topics.length, 36, 'expected 36 seed topics');
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
  assert.equal(minecraft.questions.length, 48);
  assert.equal(engine.maxColumnsForTopic(minecraft, 5), 9);

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

test('Sports subject exposes soccer, Formula 1 and basketball pools', () => {
  const sportsSubject = repository.categories
    .flatMap(category => category.subjects)
    .find(subject => subject.id === 'sports');
  assert.ok(sportsSubject, 'sports must be a separate subject');
  assert.deepEqual(sportsSubject.topics.map(entry => entry.id), ['soccer', 'formula-1', 'basketball', 'sailing', 'volleyball', 'swimming', 'athletics', 'martial-arts', 'golf', 'cycling', 'surf-skate']);

  const soccer = repository.byId.soccer;
  assert.equal(soccer.questions.length, 120);
  assert.deepEqual(soccer.subtopics.map(subtopic => subtopic.id), ['soccer-europe', 'soccer-brazil', 'soccer-world-cup']);
  for (const family of ['soccer-europe', 'soccer-brazil', 'soccer-world-cup']) {
    const unit = repository.byId[`soccer::${family}`];
    assert.ok(unit?.isSubtopic, `${family} must be a selectable subtopic`);
    assert.equal(unit.questions.length, 40, `${family} must keep 40 questions`);
    assert.equal(engine.maxColumnsForTopic(unit, 5), 8);
  }

  assert.equal(repository.byId['formula-1'].questions.length, 40);
  assert.equal(repository.byId['basketball'].questions.length, 40);
  assert.ok(engine.searchTopics(repository, 'copa do mundo').some(entry => entry.id === 'soccer::soccer-world-cup'));
  assert.ok(engine.searchTopics(repository, 'formula 1').some(entry => entry.id === 'formula-1'));
  assert.ok(engine.searchTopics(repository, 'nba').some(entry => entry.id === 'basketball'));

  const session = engine.buildSession({
    repository,
    topics: [
      { topicId: 'soccer::soccer-world-cup', columns: 1 },
      { topicId: 'formula-1', columns: 1 },
      { topicId: 'basketball', columns: 1 },
    ],
    board: { columns: 3, rows: 5 },
    difficulty: 'mixed',
    seed: 'sports-check',
  });
  assert.deepEqual(session.categories, ['World Cup', 'Formula 1', 'Basketball']);
  assert.equal(new Set(session.questionIds).size, 15);
  session.questions.forEach((column, index) => {
    const sourceIds = new Set(repository.byId[session.columnTopics[index]].questions.map(question => question.id));
    column.forEach(question => assert.ok(sourceIds.has(question.id), `${question.id} is outside ${session.columnTopics[index]}`));
    assert.deepEqual(column.map(question => question.difficulty), [1, 1, 2, 2, 3]);
  });
});

test('new Sports topics keep 60 questions at 20 easy, 20 medium and 20 hard', () => {
  const topics = ['sailing', 'volleyball', 'swimming', 'athletics', 'martial-arts', 'golf', 'cycling', 'surf-skate'];
  for (const topicId of topics) {
    const entry = repository.byId[topicId];
    assert.ok(entry, `${topicId} must exist in the Sports subject`);
    assert.equal(entry.questions.length, 60, `${topicId} must keep 60 questions`);
    for (const difficulty of [1, 2, 3]) {
      assert.equal(entry.questions.filter(question => question.difficulty === difficulty).length, 20, `${topicId} needs 20 difficulty-${difficulty} questions`);
    }
    assert.equal(entry.subtopics.length, 3, `${topicId} must expose three subtopics`);
    for (const subtopic of entry.subtopics) {
      const unit = repository.byId[`${topicId}::${subtopic.id}`];
      assert.ok(unit?.isSubtopic, `${topicId}::${subtopic.id} must be selectable`);
      assert.equal(unit.questions.length, 20);
      assert.equal(engine.maxColumnsForTopic(unit, 4), 5);
    }
  }

  assert.ok(engine.searchTopics(repository, 'regatta').some(entry => entry.id === 'sailing::sailing-racing'));
  assert.ok(engine.searchTopics(repository, 'muay thai').some(entry => entry.id === 'martial-arts::martial-arts-styles'));
  assert.ok(engine.searchTopics(repository, 'tour de france').some(entry => entry.id === 'cycling'));
  assert.ok(engine.searchTopics(repository, 'pipeline').some(entry => entry.id === 'surf-skate::surfing-basics'));

  const session = engine.buildSession({
    repository,
    topics: [
      { topicId: 'sailing', columns: 1 },
      { topicId: 'swimming', columns: 1 },
      { topicId: 'golf', columns: 1 },
    ],
    board: { columns: 3, rows: 5 },
    difficulty: 'mixed',
    seed: 'new-sports-check',
  });
  assert.deepEqual(session.categories, ['Sailing', 'Swimming', 'Golf']);
  assert.equal(new Set(session.questionIds).size, 15);
  session.questions.forEach((column, index) => {
    const sourceIds = new Set(repository.byId[session.columnTopics[index]].questions.map(question => question.id));
    column.forEach(question => assert.ok(sourceIds.has(question.id), `${question.id} is outside ${session.columnTopics[index]}`));
    assert.deepEqual(column.map(question => question.difficulty), [1, 1, 2, 2, 3]);
  });
});

test('Video Games subtopics expose 48-question banks with medium and hard additions', () => {
  const subtopics = ['minecraft', 'nintendo', 'pokemon', 'retro-consoles', 'esports'];
  for (const subtopic of subtopics) {
    const unit = repository.byId[`video-games::${subtopic}`];
    assert.ok(unit?.isSubtopic, `${subtopic} must be a selectable subtopic`);
    assert.equal(unit.questions.length, 48, `${subtopic} must keep 48 questions`);
    assert.equal(engine.maxColumnsForTopic(unit, 5), 9);

    const added = unit.questions.filter(question => Number(question.id.slice(-3)) >= 41);
    assert.equal(added.length, 40, `${subtopic} must keep the 40 added questions`);
    assert.ok(added.every(question => question.difficulty === 2 || question.difficulty === 3), `${subtopic} additions must be medium or hard`);
  }

  const roblox = repository.byId['video-games::roblox'];
  assert.ok(roblox?.isSubtopic, 'roblox must be a selectable subtopic');
  assert.equal(roblox.questions.length, 60, 'roblox must keep 60 questions');
  assert.equal(engine.maxColumnsForTopic(roblox, 5), 12);
  for (const difficulty of [1, 2, 3]) {
    assert.equal(roblox.questions.filter(question => question.difficulty === difficulty).length, 20, `roblox needs 20 difficulty-${difficulty} questions`);
  }
  assert.ok(engine.searchTopics(repository, 'robux').some(entry => entry.id === 'video-games::roblox'));

  const session = engine.buildSession({
    repository,
    topics: [
      { topicId: 'video-games::minecraft', columns: 1 },
      { topicId: 'video-games::pokemon', columns: 1 },
      { topicId: 'video-games::esports', columns: 1 },
    ],
    board: { columns: 3, rows: 5 },
    difficulty: 'medium',
    seed: 'video-games-banks',
  });
  assert.deepEqual(session.categories, ['Minecraft', 'Pokémon', 'Esports & Gaming Culture']);
  assert.equal(session.questionIds.length, 15);
  assert.equal(new Set(session.questionIds).size, 15);
  session.questions.forEach((column, index) => {
    const sourceIds = new Set(repository.byId[session.columnTopics[index]].questions.map(question => question.id));
    column.forEach(question => {
      assert.ok(sourceIds.has(question.id), `${question.id} is outside ${session.columnTopics[index]}`);
      assert.equal(question.difficulty, 2);
    });
  });
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
  assert.equal(narrow.questions.length, 48);
  assert.equal(engine.maxColumnsForTopic(narrow, 6), 8);

  const validation = engine.validateConfiguration({
    repository,
    topics: [{ topicId: 'video-games::minecraft', columns: 9 }],
    board: { columns: 9, rows: 6 },
  });
  assert.equal(validation.ok, false);
  const issue = validation.issues.find(candidate => candidate.type === 'insufficient');
  assert.equal(issue.available, 48);
  assert.equal(issue.required, 54);

  assert.throws(() => engine.buildSession({
    repository,
    topics: [{ topicId: 'video-games::minecraft', columns: 9 }],
    board: { columns: 9, rows: 6 },
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
