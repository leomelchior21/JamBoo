import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlannerInstructions,
  explicitCategoriesFromTopic,
  fallbackCategories,
  isValidCategoryList,
  splitInputTopics,
  topicRelation,
} from '../api/_quiz-topics.mjs';

test('keeps a single topic as one input topic', () => {
  assert.deepEqual(splitInputTopics('Olivia Rodrigo'), ['Olivia Rodrigo']);
  assert.deepEqual(splitInputTopics('  SpaceX  '), ['SpaceX']);
  assert.deepEqual(splitInputTopics(''), []);
});

test('splits short topic lists and removes bullets, numbering, and duplicates', () => {
  assert.deepEqual(splitInputTopics('SpaceX, Mars'), ['SpaceX', 'Mars']);
  assert.deepEqual(splitInputTopics('1. SpaceX; 2. Mars\n3. Europa'), ['SpaceX', 'Mars', 'Europa']);
  assert.deepEqual(splitInputTopics('SpaceX, SpaceX, Mars'), ['SpaceX', 'Mars']);
});

test('treats long prose prompts as a single topic for the planner', () => {
  const prose = 'Arduino & Physical Computing — introductory quiz for a technology class. Cover resistors, LEDs, voltage, current, resistance, and Ohm Law (V=IR), series vs parallel circuits, analog vs digital signals, PWM pins, and Tinkercad Circuits.';
  assert.deepEqual(splitInputTopics(prose), [prose]);
  assert.deepEqual(splitInputTopics('one, two, a fragment that is definitely far too long to be treated as its own topic heading'), ['one, two, a fragment that is definitely far too long to be treated as its own topic heading']);
});

test('turns a comma list that matches the column count into columns directly', () => {
  assert.deepEqual(explicitCategoriesFromTopic('SpaceX, Mars', 2), ['SpaceX', 'Mars']);
  assert.deepEqual(
    explicitCategoriesFromTopic('Math, Science, History, Geography', 4),
    ['Math', 'Science', 'History', 'Geography']
  );
  assert.equal(explicitCategoriesFromTopic('SpaceX, Mars', 3), null);
  assert.equal(explicitCategoriesFromTopic('SpaceX, spacex', 2), null);
  assert.equal(explicitCategoriesFromTopic('A, B, C, D, E, F', 2), null);
  assert.equal(explicitCategoriesFromTopic(`${'A'.repeat(51)}, Mars`, 2), null);
});

test('builds deterministic fallback categories for every board shape', () => {
  const single = fallbackCategories(['Dinosaurs'], 4, 'English');
  assert.equal(single.length, 4);
  assert.ok(single.every(label => label.startsWith('Dinosaurs')));
  assert.equal(new Set(single).size, 4);

  const prose = 'Arduino & Physical Computing — introductory quiz for a technology class that covers resistors, LEDs, voltage and current.';
  const proseLabels = fallbackCategories([prose], 4, 'English');
  assert.equal(new Set(proseLabels).size, 4);
  assert.ok(proseLabels.every(label => label.length <= 50));
  assert.ok(proseLabels.slice(1).every(label => /: /.test(label)));

  const grouped = fallbackCategories(['SpaceX', 'Mars', 'Europa', 'Titan', 'Venus', 'Ceres'], 2, 'English');
  assert.equal(grouped.length, 2);
  assert.ok(grouped.every(label => label.includes('&')));

  assert.deepEqual(fallbackCategories(['SpaceX', 'Mars'], 2, 'English'), ['SpaceX', 'Mars']);

  const empty = fallbackCategories([], 3, 'Portuguese');
  assert.equal(empty.length, 3);
  assert.ok(empty.every(label => label.length > 0));
});

test('validates category lists for the board dimensions', () => {
  assert.equal(isValidCategoryList(['Songs', 'Albums', 'Career', 'Performances'], 4), true);
  assert.equal(isValidCategoryList(['Songs', 'Albums'], 4), false);
  assert.equal(isValidCategoryList(['Songs', 'Songs'], 2), false);
  assert.equal(isValidCategoryList(['Songs', ''], 2), false);
  assert.equal(isValidCategoryList(['A'.repeat(51), 'Albums'], 2), false);
  assert.equal(isValidCategoryList(['Overview', 'Albums'], 2), false);
});

test('planner instructions expand fewer topics and group more topics', () => {
  const expand = buildPlannerInstructions({ columns: 4, language: 'English', topicCount: 1 });
  assert.match(expand, /Split each supplied topic/);
  assert.match(expand, /exactly 4 category titles/);
  assert.match(expand, /Never use filler titles/);

  const group = buildPlannerInstructions({ columns: 4, language: 'Portuguese', topicCount: 6 });
  assert.match(group, /Group closely related topics/);
  assert.match(group, /Portuguese/);

  const direct = buildPlannerInstructions({ columns: 2, language: 'Spanish', topicCount: 2 });
  assert.match(direct, /Use them as the 2 columns/);

  assert.equal(topicRelation(1, 4), 'expand');
  assert.equal(topicRelation(6, 4), 'group');
  assert.equal(topicRelation(4, 4), 'direct');
});

test('planner instructions carry the topic voice angles', () => {
  const games = buildPlannerInstructions({ columns: 4, language: 'English', topicCount: 1, style: 'games' });
  assert.match(games, /Content flavour: this board is games content/);
  assert.match(games, /game history/);

  const general = buildPlannerInstructions({ columns: 4, language: 'English', topicCount: 1, style: 'general' });
  assert.doesNotMatch(general, /Content flavour/);
});
