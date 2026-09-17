import { AIProviderError, AITimeoutError, InvalidAIResponseError } from './ai-errors.mjs';
import { createCallBudget, spendCall } from './ai-provider.mjs';
import { readBoundedInteger } from './config.mjs';
import { verifyPythonOutput } from './code-checks.mjs';
import {
  createSlotPlan,
  hashSeed,
  isDuplicateQuestion,
  normalizeText,
  validateCompleteQuiz,
  validateQuestionForSlot,
} from './quiz-core.mjs';
import { batchFormat, parseQuestionList, plannerFormat } from './quiz-formats.mjs';
import { generateMathQuestion, isMathCategory, verifyArithmeticAnswer } from './math-questions.mjs';
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
const MAX_REPAIR_ATTEMPTS = readBoundedInteger(process.env.MAX_REPAIR_ATTEMPTS, 1, 1, 3);
const MAX_PLAN_ATTEMPTS = 2;
const MAX_CATEGORY_ROUNDS = MAX_REPAIR_ATTEMPTS + 1;
const PLAN_MAX_TOKENS = 300;
const QUESTION_MAX_TOKENS_BASE = 240;
const QUESTION_MAX_TOKENS_PER_SLOT = 170;
const MIN_PROVIDER_CALL_MS = 35000;
const OUT_OF_TIME_REASON = 'AI server ran out of time';

function hasCallBudget(deadlineAt) {
  return !deadlineAt || deadlineAt - Date.now() >= MIN_PROVIDER_CALL_MS;
}

async function generateCategoryPlan(provider, spec, topics, signal, budget, deadlineAt) {
  const messages = [
    {
      role: 'system',
      content: buildPlannerInstructions({
        columns: spec.columns,
        rows: spec.rows,
        totalSlots: spec.columns * spec.rows,
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
    if (!hasCallBudget(deadlineAt)) break;
    spendCall(budget);
    const result = await provider.chat({
      messages,
      schema: plannerFormat(spec.columns),
      maxTokens: PLAN_MAX_TOKENS,
      temperature: attempt === 1 ? 0.25 : 0.5,
      seed: hashSeed(`${spec.seed}:plan:${attempt}`),
      signal,
      stage: 'quiz-plan',
      retry: attempt - 1,
    });
    let value = null;
    try {
      value = JSON.parse(result.content);
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

export async function createQuizPlan(provider, spec, signal, deadlineAt) {
  const startedAt = Date.now();
  const explicit = Array.isArray(spec.explicitCategories) && spec.explicitCategories.length
    ? spec.explicitCategories
    : explicitCategoriesFromTopic(spec.topic, spec.columns);
  const topics = splitInputTopics(spec.topic);
  const budget = createCallBudget(MAX_PLAN_ATTEMPTS);
  let categories = explicit;
  let kind = normalizeTopicVoice(spec.kind) ?? classifyTopicVoice(spec.topic);

  if (!categories) {
    try {
      const planned = await generateCategoryPlan(provider, spec, topics, signal, budget, deadlineAt);
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

function deterministicProblem(question) {
  if (question.d === 1) return null;
  const answer = question.a ?? '';
  const arithmetic = verifyArithmeticAnswer(question.q, answer);
  if (arithmetic.checked && !arithmetic.valid) {
    return `arithmetic answer should be ${arithmetic.computed}`;
  }
  const code = verifyPythonOutput(question.q, answer);
  if (code.checked && !code.valid) {
    return `code output should be ${code.output}`;
  }
  return null;
}

async function generateCategoryQuestions(provider, spec, category, slots, excludedQuestions, signal, budget, deadlineAt) {
  const promptHistory = [...excludedQuestions];
  const accepted = [];
  const rejected = new Map();
  let pending = slots;
  let repaired = 0;

  for (let round = 1; round <= MAX_CATEGORY_ROUNDS && pending.length; round += 1) {
    if (!hasCallBudget(deadlineAt)) {
      pending.forEach(slot => rejected.set(slot.slotId, OUT_OF_TIME_REASON));
      break;
    }
    const problems = pending
      .filter(slot => rejected.has(slot.slotId))
      .map(slot => ({ slotId: slot.slotId, reason: rejected.get(slot.slotId) }));
    let result;
    try {
      spendCall(budget);
      result = await provider.chat({
        messages: buildQuestionMessages({
          topic: spec.topic,
          category,
          language: spec.language,
          style: spec.kind,
          preCoding: spec.preCoding,
          difficulty: spec.difficulty,
          rows: spec.rows,
          columns: spec.columns,
          seed: spec.seed,
          slots: pending,
          excludedQuestions: promptHistory,
          problems,
          round,
        }),
        schema: batchFormat(pending),
        maxTokens: QUESTION_MAX_TOKENS_BASE + pending.length * QUESTION_MAX_TOKENS_PER_SLOT,
        temperature: round === 1 ? 0.55 : 0.8,
        seed: hashSeed(`${spec.seed}:${category}:${round}`),
        signal,
        stage: 'quiz-category',
        category,
        retry: round - 1,
      });
    } catch (error) {
      const retryable = error instanceof InvalidAIResponseError ||
        error instanceof AITimeoutError ||
        (error instanceof AIProviderError && error.retryable);
      if (!retryable) throw error;
      if (error instanceof AIProviderError) {
        console.warn(`[quiz] transient provider failure id=${spec.generationId} category=${JSON.stringify(category)} reason=${JSON.stringify(error.message)}`);
      }
      const reason = error instanceof AITimeoutError ? 'AI request timed out' : error.message;
      pending.forEach(slot => rejected.set(slot.slotId, reason));
      continue;
    }

    const candidates = parseQuestionList(result.content);
    const matched = new Set();
    for (const slot of pending) {
      const matches = candidates.filter(candidate => candidate?.slotId === slot.slotId);
      if (matches.length !== 1) {
        rejected.set(slot.slotId, matches.length ? 'duplicate slotId' : 'missing slotId');
        continue;
      }
      const validation = validateQuestionForSlot(matches[0], slot);
      if (!validation.valid) {
        rejected.set(slot.slotId, validation.reason);
        continue;
      }
      if (isDuplicateQuestion(validation.question.q, promptHistory)) {
        rejected.set(slot.slotId, 'duplicate question');
        continue;
      }
      const deterministic = deterministicProblem(validation.question);
      if (deterministic) {
        rejected.set(slot.slotId, deterministic);
        continue;
      }
      accepted.push(validation.question);
      promptHistory.push(validation.question.q);
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

export async function generateQuestionBatch(provider, spec, signal, deadlineAt) {
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

  const budget = createCallBudget(tasks.length * MAX_CATEGORY_ROUNDS);
  const settled = await Promise.allSettled(tasks.map(task =>
    generateCategoryQuestions(provider, spec, task.category, task.slots, knownPrompts, signal, budget, deadlineAt)
  ));

  let repairCount = 0;
  let providerError = null;
  settled.forEach((outcome, index) => {
    const task = tasks[index];
    if (outcome.status === 'fulfilled') {
      accepted.push(...outcome.value.accepted);
      failures.push(...outcome.value.failures);
      repairCount += outcome.value.repairCount;
      return;
    }
    const error = outcome.reason;
    if (error instanceof InvalidAIResponseError) {
      console.warn(`[quiz] category failed id=${spec.generationId} category=${JSON.stringify(task.category)} reason=${JSON.stringify(error.message)}`);
      failures.push(...task.slots.map(slot => ({ slot, reason: error.message })));
      return;
    }
    providerError = providerError ?? error;
  });
  if (providerError) throw providerError;

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
  if (missingSlotIds.length) {
    throw new InvalidAIResponseError(`Quiz is incomplete: ${missingSlotIds.length} slot(s) missing`);
  }
  const expectedSlots = spec.columns * spec.rows;
  if (spec.categories.length !== spec.columns || spec.slots.length !== expectedSlots || spec.questions.length !== expectedSlots) {
    throw new InvalidAIResponseError('Quiz does not match the configured board dimensions');
  }
  const result = validateCompleteQuiz(spec.slots, spec.questions);
  if (!result.valid) throw new InvalidAIResponseError(`Quiz is incomplete: ${result.reason}`);
  console.info(`[quiz] ready id=${spec.generationId} ${result.questions.length}/${expectedSlots} slots`);
  return {
    ready: true,
    categories: spec.categories,
    questions: result.questions,
    missingSlotIds: [],
  };
}
