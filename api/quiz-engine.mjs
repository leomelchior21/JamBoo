import {
  createSlotPlan,
  hashSeed,
  isDuplicateQuestion,
  normalizeText,
  validateCompleteQuiz,
  validateQuestionForSlot,
} from './quiz-core.mjs';
import { batchFormat, parseQuestionList, plannerFormat } from './quiz-formats.mjs';
import { generateMathQuestion, isMathCategory } from './math-questions.mjs';
import { InvalidAIResponseError, readBoundedInteger, requestOllama } from './ollama.mjs';
import { buildQuestionMessages } from './quiz-prompts.mjs';
import {
  buildPlannerInstructions,
  explicitCategoriesFromTopic,
  fallbackCategories,
  isValidCategoryList,
  splitInputTopics,
} from './quiz-topics.mjs';
import { classifyTopicVoice, normalizeTopicVoice } from './quiz-voice.mjs';

export const QUESTION_BATCH_SIZE = readBoundedInteger(process.env.QUESTION_BATCH_SIZE, 6, 1, 8);
const MAX_REPAIR_ATTEMPTS = readBoundedInteger(process.env.MAX_REPAIR_ATTEMPTS, 2, 1, 3);
const MAX_PLAN_ATTEMPTS = 2;
const MAX_CATEGORY_ROUNDS = MAX_REPAIR_ATTEMPTS + 1;

async function generateCategoryPlan(chatUrl, spec, topics, signal) {
  const messages = [
    {
      role: 'system',
      content: buildPlannerInstructions({
        columns: spec.columns,
        language: spec.language,
        topicCount: topics.length,
        style: normalizeTopicVoice(spec.kind) ?? classifyTopicVoice(spec.topic),
      }),
    },
    {
      role: 'user',
      content: `TOPIC INPUT: ${JSON.stringify(spec.topic)}\nSEPARATE TOPICS DETECTED (${topics.length}): ${JSON.stringify(topics)}\nReturn exactly ${spec.columns} category titles and the content flavour now.`,
    },
  ];

  for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt += 1) {
    const answer = await requestOllama(chatUrl, messages, {
      format: plannerFormat(spec.columns),
      signal,
      numPredict: 260,
      temperature: attempt === 1 ? 0.25 : 0.5,
      seed: hashSeed(`${spec.seed}:plan:${attempt}`),
    });
    let value = null;
    try {
      value = JSON.parse(answer);
    } catch (_) {
      value = null;
    }
    if (isValidCategoryList(value?.categories, spec.columns)) {
      return {
        categories: value.categories.map(category => category.trim()),
        kind: normalizeTopicVoice(value?.kind),
      };
    }
    messages.push({
      role: 'user',
      content: `That reply was not usable. Return exactly ${spec.columns} distinct category titles in ${spec.language}, plus a valid "kind".`,
    });
  }

  throw new InvalidAIResponseError('AI returned an invalid category plan');
}

export async function createQuizPlan(chatUrl, spec, signal) {
  const startedAt = Date.now();
  const explicit = Array.isArray(spec.explicitCategories) && spec.explicitCategories.length
    ? spec.explicitCategories
    : explicitCategoriesFromTopic(spec.topic, spec.columns);
  const topics = splitInputTopics(spec.topic);
  let categories = explicit;
  let kind = normalizeTopicVoice(spec.kind) ?? classifyTopicVoice(spec.topic);

  if (!categories) {
    try {
      const planned = await generateCategoryPlan(chatUrl, spec, topics, signal);
      categories = planned.categories;
      kind = planned.kind ?? kind;
    } catch (error) {
      if (!(error instanceof InvalidAIResponseError)) throw error;
      categories = fallbackCategories(topics.length ? topics : [spec.topic], spec.columns, spec.language);
      console.warn(`[quiz] plan fallback id=${spec.generationId} reason=${JSON.stringify(error.message)}`);
    }
  }

  const slots = createSlotPlan(spec, categories);
  console.info(`[quiz] plan id=${spec.generationId} categories=${JSON.stringify(categories)} kind=${kind} slots=${slots.length} duration=${Date.now() - startedAt}ms`);
  return { categories, slots, batchSize: QUESTION_BATCH_SIZE, kind };
}

function validationCandidates(candidates, slot) {
  return candidates.filter(candidate => candidate?.slotId === slot.slotId);
}

async function generateCategoryQuestions(chatUrl, spec, category, slots, excludedQuestions, signal) {
  const promptHistory = [...excludedQuestions];
  const accepted = [];
  const rejected = new Map();
  let pending = slots;
  let repaired = 0;

  for (let round = 1; round <= MAX_CATEGORY_ROUNDS && pending.length; round += 1) {
    const problems = pending
      .filter(slot => rejected.has(slot.slotId))
      .map(slot => ({ slotId: slot.slotId, reason: rejected.get(slot.slotId) }));
    let answer;
    try {
      answer = await requestOllama(
        chatUrl,
        buildQuestionMessages({
          topic: spec.topic,
          category,
          language: spec.language,
          style: spec.kind,
          preCoding: spec.preCoding,
          difficulty: spec.difficulty,
          rows: spec.rows,
          slots: pending,
          excludedQuestions: promptHistory,
          problems,
          round,
        }),
        {
          format: batchFormat(pending),
          signal,
          numPredict: Math.min(1400, 260 + pending.length * 150),
          temperature: round === 1 ? 0.55 : 0.8,
          seed: hashSeed(`${spec.seed}:${category}:${round}`),
        }
      );
    } catch (error) {
      if (!(error instanceof InvalidAIResponseError)) throw error;
      pending.forEach(slot => rejected.set(slot.slotId, error.message));
      continue;
    }

    const candidates = parseQuestionList(answer);
    const matched = new Set();
    for (const slot of pending) {
      const matches = validationCandidates(candidates, slot);
      if (matches.length !== 1) {
        rejected.set(slot.slotId, matches.length ? 'duplicate slotId' : 'missing slotId');
        continue;
      }
      const result = validateQuestionForSlot(matches[0], slot);
      if (!result.valid) {
        rejected.set(slot.slotId, result.reason);
        continue;
      }
      if (isDuplicateQuestion(result.question.q, promptHistory)) {
        rejected.set(slot.slotId, 'duplicate question');
        continue;
      }
      accepted.push(result.question);
      promptHistory.push(result.question.q);
      matched.add(slot.slotId);
      if (round > 1) repaired += 1;
    }
    pending = pending.filter(slot => !matched.has(slot.slotId));
  }

  return {
    accepted,
    failures: pending.map(slot => ({ slot, reason: rejected.get(slot.slotId) ?? 'no valid question after retries' })),
    repairCount: repaired,
  };
}

function generateMathQuestions(spec, slots, knownPrompts) {
  const accepted = [];
  const failures = [];
  for (const slot of slots) {
    let question = generateMathQuestion(slot, spec).question;
    for (let salt = 1; salt <= 4 && isDuplicateQuestion(question.q, knownPrompts); salt += 1) {
      question = generateMathQuestion(slot, { ...spec, mathSalt: salt }).question;
    }
    if (isDuplicateQuestion(question.q, knownPrompts)) {
      failures.push({ slot, reason: 'duplicate question' });
      continue;
    }
    accepted.push(question);
    knownPrompts.push(question.q);
  }
  return { accepted, failures, repairCount: 0 };
}

export async function generateQuestionBatch(chatUrl, spec, signal) {
  const startedAt = Date.now();
  const groups = new Map();
  for (const slot of spec.slots) {
    const list = groups.get(slot.category) ?? [];
    list.push(slot);
    groups.set(slot.category, list);
  }

  const accepted = [];
  const failures = [];
  const knownPrompts = [...spec.excludedQuestions];
  const tasks = [];

  for (const [category, slots] of groups) {
    if (isMathCategory(category)) {
      const result = generateMathQuestions(spec, slots, knownPrompts);
      accepted.push(...result.accepted);
      failures.push(...result.failures);
      continue;
    }
    tasks.push({ category, slots });
  }

  const settled = await Promise.all(tasks.map(async task => {
    try {
      return await generateCategoryQuestions(chatUrl, spec, task.category, task.slots, knownPrompts, signal);
    } catch (error) {
      if (error instanceof InvalidAIResponseError) {
        console.warn(`[quiz] category failed id=${spec.generationId} category=${JSON.stringify(task.category)} reason=${JSON.stringify(error.message)}`);
        return {
          accepted: [],
          failures: task.slots.map(slot => ({ slot, reason: error.message })),
          repairCount: 0,
        };
      }
      throw error;
    }
  }));

  let repairCount = 0;
  for (const result of settled) {
    accepted.push(...result.accepted);
    failures.push(...result.failures);
    repairCount += result.repairCount;
  }

  const bySlot = new Map();
  const seenPrompts = new Set();
  for (const question of accepted) {
    const promptKey = normalizeText(question.q);
    if (seenPrompts.has(promptKey) || bySlot.has(question.slotId)) continue;
    seenPrompts.add(promptKey);
    bySlot.set(question.slotId, question);
  }

  const questions = spec.slots.map(slot => bySlot.get(slot.slotId)).filter(Boolean);
  const failedSlots = spec.slots.filter(slot => !bySlot.has(slot.slotId)).map(slot => slot.slotId);
  console.info(`[quiz] batch id=${spec.generationId} requested=${spec.slots.length} valid=${questions.length} failed=${failedSlots.length} repaired=${repairCount} duration=${Date.now() - startedAt}ms`);
  return { questions, repaired: repairCount, failedSlots };
}

export function finalizeQuiz(spec) {
  const missingSlotIds = Array.isArray(spec.missingSlotIds) ? spec.missingSlotIds : [];
  const missing = new Set(missingSlotIds);
  const slots = missing.size
    ? spec.slots.filter(slot => !missing.has(slot.slotId))
    : spec.slots;
  const result = validateCompleteQuiz(slots, spec.questions);
  if (!result.valid) throw new InvalidAIResponseError(`Quiz is incomplete: ${result.reason}`);
  console.info(`[quiz] ready id=${spec.generationId} ${result.questions.length}/${spec.slots.length} missing=${missingSlotIds.length}`);
  return {
    ready: true,
    categories: spec.categories,
    questions: result.questions,
    missingSlotIds,
  };
}
