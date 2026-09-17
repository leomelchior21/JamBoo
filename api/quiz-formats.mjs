import { TOPIC_VOICES } from './quiz-voice.mjs';

const QUESTION_TEXT = { type: 'string', minLength: 8, maxLength: 180 };
const ANSWER_TEXT = { type: 'string', minLength: 1, maxLength: 60 };

function exactArray(length, items) {
  return {
    type: 'array',
    items,
    minItems: length,
    maxItems: length,
  };
}

export function plannerFormat(columns) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: {
        type: 'string',
        enum: [...TOPIC_VOICES],
        description: 'The overall content flavour of the board topic.',
      },
      categories: exactArray(columns, {
        type: 'string',
        minLength: 1,
        maxLength: 50,
      }),
    },
    required: ['kind', 'categories'],
  };
}

function slotQuestionFormat(slot) {
  const slotId = { type: 'string', enum: [slot.slotId] };
  if (slot.type === 'multiple') {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        slotId,
        q: QUESTION_TEXT,
        a: ANSWER_TEXT,
        x: exactArray(3, ANSWER_TEXT),
      },
      required: ['slotId', 'q', 'a', 'x'],
    };
  }
  if (slot.type === 'drawing') {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        slotId,
        q: QUESTION_TEXT,
        a: ANSWER_TEXT,
        d: { type: 'integer', enum: [1] },
      },
      required: ['slotId', 'q', 'a', 'd'],
    };
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      slotId,
      q: QUESTION_TEXT,
      a: ANSWER_TEXT,
    },
    required: ['slotId', 'q', 'a'],
  };
}

export function batchFormat(slots) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      qs: {
        type: 'array',
        prefixItems: slots.map(slotQuestionFormat),
        minItems: slots.length,
        maxItems: slots.length,
      },
    },
    required: ['qs'],
  };
}

export function parseJsonObject(answer) {
  try {
    const value = JSON.parse(answer);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

export function parseQuestionList(answer) {
  const value = parseJsonObject(answer);
  return Array.isArray(value?.qs) ? value.qs : [];
}
