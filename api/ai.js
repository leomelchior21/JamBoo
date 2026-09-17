import { AIConfigError, AIProviderError, AITimeoutError, AIBudgetError, InvalidAIResponseError } from './_ai-errors.mjs';
import { createQuizProvider } from './_ai-provider.mjs';
import { readBoundedInteger } from './_config.mjs';
import { MAX_CATEGORY_LENGTH } from './_quiz-topics.mjs';
import { DIFFICULTIES, QUESTION_TYPES, QUIZ_LIMITS, createSlotPlan, normalizeText } from './_quiz-core.mjs';
import {
  QUESTION_BATCH_SIZE,
  createQuizPlan,
  finalizeQuiz,
  generateQuestionBatch,
} from './_quiz-engine.mjs';
import { normalizeTopicVoice } from './_quiz-voice.mjs';

const CHAT_TIMEOUT_MS = readBoundedInteger(
  process.env.QUIZ_AI_TIMEOUT_MS ?? process.env.OLLAMA_TIMEOUT_MS,
  140000,
  5000,
  145000
);
const RESPONSE_MARGIN_MS = 5000;
const MAX_TOPIC_LENGTH = 4000;
const MAX_EXCLUDED_LENGTH = 180;
const QUIZ_ACTIONS = ['quiz-plan', 'quiz-batch', 'quiz-validate'];
const QUIZ_LANGUAGES = ['English', 'Portuguese', 'Spanish'];

const inFlightGenerations = new Map();

function generationKey(quizRequest) {
  const slotIds = Array.isArray(quizRequest.slots)
    ? quizRequest.slots.map(slot => slot.slotId).join(',')
    : '';
  return `${quizRequest.generationId}|${quizRequest.action}|${slotIds}`;
}

function singleFlight(key, run) {
  const existing = inFlightGenerations.get(key);
  if (existing) return existing;
  const promise = run().finally(() => {
    inFlightGenerations.delete(key);
  });
  inFlightGenerations.set(key, promise);
  return promise;
}

function parseBody(body) {
  if (typeof body !== 'string') return body || {};
  try {
    return JSON.parse(body);
  } catch (_) {
    return null;
  }
}

function boundedText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

function validCategoryList(categories, columns) {
  return Array.isArray(categories) &&
    categories.length === columns &&
    categories.every(category =>
      boundedText(category, MAX_CATEGORY_LENGTH) !== null
    ) &&
    new Set(categories.map(category => normalizeText(category))).size === categories.length;
}

function validateQuizRequest(body) {
  if (!body || !QUIZ_ACTIONS.includes(body.action)) return null;

  const quiz = body.quiz;
  const topic = boundedText(quiz?.topic, MAX_TOPIC_LENGTH);
  const language = QUIZ_LANGUAGES.includes(quiz?.language) ? quiz.language : null;
  if (!topic || !language) return null;

  const { columns, rows, difficulty, questionType } = quiz;
  if (!Number.isInteger(columns) || columns < 1 || columns > QUIZ_LIMITS.columns) return null;
  if (!Number.isInteger(rows) || rows < 1 || rows > QUIZ_LIMITS.rows) return null;
  if (!DIFFICULTIES.includes(difficulty) || !QUESTION_TYPES.includes(questionType)) return null;

  const seed = boundedText(quiz.seed, 100);
  const generationId = boundedText(quiz.generationId, 120);
  if (!seed || !generationId) return null;

  const base = {
    action: body.action,
    topic,
    language,
    columns,
    rows,
    difficulty,
    questionType,
    seed,
    generationId,
    kind: normalizeTopicVoice(quiz.kind),
    preCoding: quiz.audience === 'year6-pre-coding',
  };

  if (body.action === 'quiz-plan') {
    const explicitCategories = quiz.explicitCategories;
    if (explicitCategories !== undefined && !validCategoryList(explicitCategories, columns)) return null;
    return {
      ...base,
      explicitCategories: explicitCategories?.map(category => category.trim()),
    };
  }

  const categories = quiz.categories;
  if (!validCategoryList(categories, columns)) return null;
  const spec = { ...base, categories: categories.map(category => category.trim()) };
  const plannedSlots = createSlotPlan(spec, spec.categories);
  const plannedIds = new Set(plannedSlots.map(slot => slot.slotId));

  if (body.action === 'quiz-batch') {
    const slotIds = quiz.slotIds;
    const excludedQuestions = Array.isArray(quiz.excludedQuestions)
      ? quiz.excludedQuestions.map(value => boundedText(value, MAX_EXCLUDED_LENGTH)).filter(Boolean)
      : [];
    if (!Array.isArray(slotIds) || slotIds.length < 1 || slotIds.length > QUESTION_BATCH_SIZE) return null;
    if (new Set(slotIds).size !== slotIds.length) return null;
    if (slotIds.some(slotId => !plannedIds.has(slotId))) return null;
    if (excludedQuestions.length > QUIZ_LIMITS.columns * QUIZ_LIMITS.rows) return null;
    return {
      ...spec,
      slots: slotIds.map(slotId => plannedSlots.find(slot => slot.slotId === slotId)),
      excludedQuestions,
    };
  }

  const questions = quiz.questions;
  if (!Array.isArray(questions) || questions.length > plannedSlots.length) return null;
  const missingSlotIds = quiz.missingSlotIds;
  if (missingSlotIds !== undefined) {
    if (!Array.isArray(missingSlotIds) || missingSlotIds.length > columns * rows) return null;
    if (new Set(missingSlotIds).size !== missingSlotIds.length) return null;
    if (missingSlotIds.some(slotId => !boundedText(slotId, 20) || !plannedIds.has(slotId))) return null;
    if (missingSlotIds.length > 0 && questions.length + missingSlotIds.length !== plannedSlots.length) return null;
  }
  return { ...spec, slots: plannedSlots, questions, missingSlotIds: missingSlotIds ?? [] };
}

export default async function handler(req, res) {
  res.setHeader('Allow', 'POST');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = parseBody(req.body);
  if (!body) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const quizRequest = validateQuizRequest(body);
  if (!quizRequest) {
    return res.status(400).json({ error: 'Invalid quiz request' });
  }

  let provider;
  try {
    provider = createQuizProvider();
  } catch (error) {
    console.error('Invalid quiz AI provider configuration');
    return res.status(503).json({ error: 'AI server unavailable' });
  }
  if (!provider.configured) {
    console.error(`Quiz AI provider is not configured (${provider.name})`);
    return res.status(503).json({ error: 'AI server unavailable' });
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  const deadlineAt = startedAt + Math.max(5000, CHAT_TIMEOUT_MS - RESPONSE_MARGIN_MS);

  try {
    const answer = await singleFlight(generationKey(quizRequest), async () => {
      if (quizRequest.action === 'quiz-plan') {
        return createQuizPlan(provider, quizRequest, controller.signal, deadlineAt);
      }
      if (quizRequest.action === 'quiz-batch') {
        return generateQuestionBatch(provider, quizRequest, controller.signal, deadlineAt);
      }
      return finalizeQuiz(quizRequest);
    });

    return res.status(200).json({ answer: JSON.stringify(answer) });
  } catch (error) {
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      console.error(`Quiz generation request timed out after ${Date.now() - startedAt}ms`);
      return res.status(504).json({ error: 'AI server unavailable' });
    }
    if (error instanceof AITimeoutError) {
      console.error(`AI provider timed out after ${Date.now() - startedAt}ms: ${error.message}`);
      return res.status(504).json({ error: 'AI server unavailable' });
    }
    if (error instanceof InvalidAIResponseError) {
      return res.status(502).json({
        error: error.message,
        code: 'INVALID_AI_RESPONSE',
      });
    }
    if (error instanceof AIBudgetError) {
      console.error(error.message);
      return res.status(502).json({
        error: 'AI generation budget exceeded',
        code: 'AI_BUDGET_EXCEEDED',
      });
    }
    if (error instanceof AIConfigError) {
      console.error('Invalid quiz AI provider configuration');
      return res.status(503).json({ error: 'AI server unavailable' });
    }
    if (error instanceof AIProviderError) {
      console.error(`AI provider error: ${error.message}`);
      return res.status(502).json({ error: 'AI server unavailable' });
    }

    console.error('Quiz generation failed', error);
    return res.status(502).json({ error: 'AI server unavailable' });
  } finally {
    clearTimeout(timeout);
  }
}
