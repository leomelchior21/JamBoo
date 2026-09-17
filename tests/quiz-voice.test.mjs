import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TOPIC_VOICES,
  classifyTopicVoice,
  normalizeTopicVoice,
  resolveTopicVoice,
  voiceAngles,
  voiceInstruction,
} from '../api/_quiz-voice.mjs';

test('classifies game, sport, code, math, music, movie, history, science and geography topics', () => {
  assert.equal(classifyTopicVoice('Roblox'), 'games');
  assert.equal(classifyTopicVoice('Minecraft, Fortnite'), 'games');
  assert.equal(classifyTopicVoice('World Cup history'), 'sports');
  assert.equal(classifyTopicVoice('Michael Jordan, basketball'), 'sports');
  assert.equal(classifyTopicVoice('Python programming'), 'code');
  assert.equal(classifyTopicVoice('Scratch coding for kids'), 'code');
  assert.equal(classifyTopicVoice('Fractions and decimals'), 'math');
  assert.equal(classifyTopicVoice('The Beatles'), 'music');
  assert.equal(classifyTopicVoice('Harry Potter movies'), 'movies');
  assert.equal(classifyTopicVoice('The French Revolution'), 'history');
  assert.equal(classifyTopicVoice('Volcanoes and earthquakes'), 'geography');
  assert.equal(classifyTopicVoice('The solar system'), 'science');
  assert.equal(classifyTopicVoice('Olivia Rodrigo'), 'general');
});

test('normalizes only known voice names', () => {
  assert.equal(normalizeTopicVoice(' Games '), 'games');
  assert.equal(normalizeTopicVoice('CELEBRITY'), 'celebrity');
  assert.equal(normalizeTopicVoice('unknown'), null);
  assert.equal(resolveTopicVoice('sports', 'Roblox'), 'sports');
  assert.equal(resolveTopicVoice(undefined, 'Roblox'), 'games');
  assert.equal(resolveTopicVoice(undefined, 'A person'), 'general');
  assert.deepEqual([...TOPIC_VOICES], [
    'celebrity', 'games', 'sports', 'music', 'movies', 'history', 'science', 'geography', 'code', 'math', 'general',
  ]);
});

test('every voice has personality guidance', () => {
  TOPIC_VOICES.forEach(voice => {
    assert.ok(voiceInstruction(voice).length > 30, voice);
  });
  assert.match(voiceInstruction('games'), /gamer trivia-night energy/);
  assert.match(voiceInstruction('celebrity'), /pop-culture energy/);
  assert.match(voiceInstruction('science'), /curious-scientist energy/);
  assert.match(voiceInstruction('code'), /hacker-lab energy/);
  assert.match(voiceInstruction('code', { preCoding: true }), /Never use code, syntax, tool names/);
  assert.match(voiceInstruction(undefined, { preCoding: true }), /pre-coding learners/);
});

test('voice angles stay available for planner headings', () => {
  assert.match(voiceAngles('celebrity'), /career milestones/);
  assert.match(voiceAngles('games'), /game history/);
  assert.match(voiceAngles('sports'), /legendary moments/);
  assert.match(voiceAngles('unknown'), /origins/);
});
