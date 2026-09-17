import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlannerInstructions,
  isValidCategoryList,
  splitInputTopics,
  topicRelation,
} from '../api/quiz-planner.mjs';

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

test('validates category lists for the board dimensions', () => {
  assert.equal(isValidCategoryList(['Songs', 'Albums', 'Career', 'Performances'], 4), true);
  assert.equal(isValidCategoryList(['Songs', 'Albums'], 4), false);
  assert.equal(isValidCategoryList(['Songs', 'Songs'], 2), false);
  assert.equal(isValidCategoryList(['Songs', ''], 2), false);
  assert.equal(isValidCategoryList(['A'.repeat(51), 'Albums'], 2), false);
});

test('planner instructions expand fewer topics and group more topics', () => {
  const expand = buildPlannerInstructions({ columns: 4, language: 'English', topicCount: 1 });
  assert.match(expand, /Decompose each supplied topic/);
  assert.match(expand, /exactly 4 short, distinct category headings/);
  assert.match(expand, /live search is unavailable/);

  const group = buildPlannerInstructions({ columns: 4, language: 'Portuguese', topicCount: 6, liveDataAvailable: true });
  assert.match(group, /Group closely related topics/);
  assert.match(group, /Portuguese/);
  assert.match(group, /Current-events angles are allowed/);

  const direct = buildPlannerInstructions({ columns: 2, language: 'Spanish', topicCount: 2 });
  assert.match(direct, /Use them as the 2 columns/);

  assert.equal(topicRelation(1, 4), 'expand');
  assert.equal(topicRelation(6, 4), 'group');
  assert.equal(topicRelation(4, 4), 'direct');
});

test('planner instructions carry the topic style angles', () => {
  const celebrity = buildPlannerInstructions({ columns: 4, language: 'English', topicCount: 1, style: 'celebrity' });
  assert.match(celebrity, /Style rule: this board is celebrity content/);
  assert.match(celebrity, /career milestones/);

  const games = buildPlannerInstructions({ columns: 4, language: 'English', topicCount: 1, style: 'games' });
  assert.match(games, /game history/);

  const general = buildPlannerInstructions({ columns: 4, language: 'English', topicCount: 1, style: 'general' });
  assert.doesNotMatch(general, /Style rule/);
});
