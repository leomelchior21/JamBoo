import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TOPIC_STYLES,
  classifyTopicStyle,
  normalizeTopicStyle,
  resolveTopicStyle,
  styleAngles,
  styleInstruction,
} from '../api/topic-style.mjs';

test('classifies celebrity, games, sports, code, and math topics', () => {
  assert.equal(classifyTopicStyle('Roblox'), 'games');
  assert.equal(classifyTopicStyle('Minecraft, Fortnite'), 'games');
  assert.equal(classifyTopicStyle('World Cup history'), 'sports');
  assert.equal(classifyTopicStyle('Michael Jordan, basketball'), 'sports');
  assert.equal(classifyTopicStyle('Python programming'), 'code');
  assert.equal(classifyTopicStyle('Scratch coding for kids'), 'code');
  assert.equal(classifyTopicStyle('Fractions and decimals'), 'math');
  assert.equal(classifyTopicStyle('Olivia Rodrigo'), 'general');
  assert.equal(classifyTopicStyle('The French Revolution'), 'general');
});

test('normalizes only known style names', () => {
  assert.equal(normalizeTopicStyle(' Games '), 'games');
  assert.equal(normalizeTopicStyle('CELEBRITY'), 'celebrity');
  assert.equal(normalizeTopicStyle('unknown'), null);
  assert.equal(resolveTopicStyle('sports', 'Roblox'), 'sports');
  assert.equal(resolveTopicStyle(undefined, 'Roblox'), 'games');
  assert.equal(resolveTopicStyle(undefined, 'A person'), 'general');
  assert.deepEqual([...TOPIC_STYLES], ['celebrity', 'games', 'sports', 'code', 'math', 'general']);
});

test('style instructions describe the requested question flavour', () => {
  assert.match(styleInstruction('celebrity'), /fun fact or trivia about this celebrity's career/);
  assert.match(styleInstruction('games'), /game trivia/);
  assert.match(styleInstruction('games'), /characters/);
  assert.match(styleInstruction('sports'), /sports fun facts/);
  assert.match(styleInstruction('code'), /coding trivia/);
  assert.match(styleInstruction('code', { preCoding: true }), /Never require code, syntax, or tool names/);
  assert.match(styleInstruction('math'), /computed by the server/);
  assert.equal(styleInstruction('general'), '');
});

test('style angles stay available for planner headings', () => {
  assert.match(styleAngles('celebrity'), /career milestones/);
  assert.match(styleAngles('games'), /game history/);
  assert.match(styleAngles('sports'), /records/);
  assert.match(styleAngles('unknown'), /foundations/);
});
