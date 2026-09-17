import { hashSeed } from './quiz-core.mjs';
import { resolveTopicVoice, voiceInstruction } from './quiz-voice.mjs';

const DIFFICULTY_SCALES = Object.freeze({
  easy: ['very easy', 'easy'],
  medium: ['easy', 'medium', 'challenging'],
  hard: ['medium', 'hard', 'very hard'],
  mixed: ['very easy', 'easy', 'medium', 'hard', 'very hard', 'expert'],
});

const VARIATION_HINTS = Object.freeze([
  'favour famous firsts and milestones',
  'favour records, numbers and comparisons',
  'favour key people and their roles',
  'favour places, origins and timelines',
  'favour definitions, meanings and how things work',
  'favour everyday examples and real-life applications',
  'favour surprising but well-documented details',
]);

export function variationHints(seed, category) {
  const start = hashSeed(`${seed}:${category}`);
  return [
    VARIATION_HINTS[start % VARIATION_HINTS.length],
    VARIATION_HINTS[(start + 3) % VARIATION_HINTS.length],
  ];
}

export function rowDifficultyLabels(difficulty, rows) {
  const scale = DIFFICULTY_SCALES[difficulty] ?? DIFFICULTY_SCALES.mixed;
  return Array.from({ length: rows }, (_, rowIndex) => {
    const scaleIndex = rows === 1
      ? Math.floor((scale.length - 1) / 2)
      : Math.round((rowIndex / (rows - 1)) * (scale.length - 1));
    return scale[scaleIndex];
  });
}

function audienceRule(preCoding) {
  return preCoding
    ? 'The players are 10-12 years old and have never programmed. Use everyday words, objects and situations only, and never mention code, syntax, tools, variables or programming vocabulary.'
    : 'The players are students around 10-15 years old. Keep everything school-friendly and easy to read aloud.';
}

export function buildQuestionMessages({
  topic,
  category,
  language,
  style,
  preCoding = false,
  difficulty = 'mixed',
  rows = 6,
  columns = 1,
  seed = '',
  slots,
  excludedQuestions = [],
  problems = [],
  round = 1,
}) {
  const voice = voiceInstruction(resolveTopicVoice(style, topic), { preCoding });
  const labels = rowDifficultyLabels(difficulty, rows);
  const hints = variationHints(`${seed}:${topic}:${round}`, category);
  const slotLines = slots
    .map((slot, index) =>
      `${index + 1}. slotId=${slot.slotId} | row ${slot.rowIndex + 1} | ${slot.points} points | ${labels[slot.rowIndex] ?? slot.difficulty} | ${slot.type} | thinking: ${slot.tierSkill ?? slot.cognitiveSkill}`
    )
    .join('\n');
  const exclusions = excludedQuestions.length
    ? `\nAlready used in this quiz. Never repeat or reword any of these:\n${excludedQuestions.slice(-24).map(question => `- ${question}`).join('\n')}`
    : '';
  const repairs = problems.length
    ? `\nThe previous attempt failed for these slots. Write brand-new questions for every slot below:\n${problems.map(problem => `- ${problem.slotId}: ${problem.reason}`).join('\n')}`
    : '';
  const system = `You are JamBoo's question writer: a quiz-show host who writes short, accurate, fun trivia for classrooms. You reply with the required JSON only.

BOARD TOPIC: ${JSON.stringify(topic)}
LOCKED CATEGORY: ${JSON.stringify(category)}
Write every question, answer and option in ${language}.

BOARD CONTRACT (fixed by the game, never change it)
- The board has exactly ${columns} categories and ${rows} rows (${columns * rows} question slots).
- This request fills exactly ${slots.length} slots of the locked category: ${slots.map(slot => slot.slotId).join(', ')}.
- Fill exactly the listed slots. Never add, remove, merge, rename, reorder or resize anything.
- Variation hint for this attempt: prefer ${hints[0]} and ${hints[1]} while staying on topic.

RULES FOR EVERY QUESTION
1. Accuracy first. Use only facts you are completely sure about. If you are not certain, pick another fact or ask what something means. Never invent names, dates, numbers, titles or events.
2. Stable facts only. Never ask about "current", "latest", "recent", rankings, prices or anything that changes over time. Prefer origins, meanings, history, people, places, rules and how things work.
3. Quiz-show energy. Vary the openings, put a concrete detail or surprising angle inside the question, and write like you are talking to players. Never start two questions the same way and never test the same fact twice.
4. One clear reading. No trick wording, no double negatives, and no "all of the above" or "none of the above" options.
5. Short and sharp. Questions stay under 180 characters. The correct answer is a short label of 1 to 6 words. Distractors are the same kind of thing and about the same length as the answer.
6. School-safe. Nothing about private lives, gossip, living-politician politics or graphic violence.
7. The category title is already on the board, so go straight to the fact. Mention the category only when it makes the question clearer.

QUESTION TYPES
- multiple: "a" is the correct answer and "x" holds exactly 3 wrong but plausible answers of the same kind. Each distractor must be clearly wrong for a real reason, never a synonym or a smaller version of "a". The server shuffles the options, so never try to hide the answer.
- open: "a" is the expected answer a player says out loud.
- drawing: ask for a simple sketch; "a" holds short judging criteria; set "d" to 1.

${voice}
${audienceRule(preCoding)}

Useful question shapes, choose what fits: who did something first, which one belongs with which, what happens if, why does something happen, where is something, how many, which came first, what does a word mean.

STYLE REFERENCE for the JSON shape (invent new content, never copy this):
{"slotId":"0-0","q":"Which ingredient makes bread rise in the oven?","a":"Yeast","x":["Flour","Butter","Salt"]}
{"slotId":"0-1","q":"Why does a balloon stick to a woollen jumper after rubbing?","a":"Static electricity"}`;

  const user = `Fill these ${slots.length} slots for the locked category now.
${slotLines}
Return only the required JSON with "qs" in this exact order, one object per slot, each carrying its own slotId.${exclusions}${repairs}${round > 1 ? '\nEvery answer must be different from the rejected attempts.' : ''}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
