const OLLAMA_MODEL = 'qwen3.5:4b';
const CHAT_TIMEOUT_MS = 140000;
const MAX_MESSAGES = 4;
const MAX_MESSAGE_LENGTH = 12000;
const MAX_TOTAL_LENGTH = 20000;
const QUIZ_LIMITS = { columns: 8, rows: 6 };
const MAX_QUIZ_ITEMS_PER_CALL = 6;
const MAX_QUIZ_SCHEMA_ATTEMPTS = 2;
const DEFAULT_NUM_PREDICT = 400;
const QUIZ_NUM_PREDICT = 650;
const SERVER_SYSTEM_PROMPT = 'Follow the conversation instructions precisely. When asked to reply with exact literal text, output only that text; literal output is formatting, not an identity claim.';

class InvalidAIResponseError extends Error {}
class OllamaResponseError extends Error {}

function getOllamaEndpoint(pathname) {
  const baseUrl = process.env.OLLAMA_URL?.trim().replace(/\/+$/, '');
  if (!baseUrl) return null;

  const endpoint = new URL(`${baseUrl}${pathname}`);
  if (endpoint.protocol !== 'https:') {
    throw new Error('OLLAMA_URL must use HTTPS');
  }
  return endpoint;
}

function parseBody(body) {
  if (typeof body !== 'string') return body || {};
  try {
    return JSON.parse(body);
  } catch (_) {
    return null;
  }
}

function validateResponseSchema(schema) {
  if (schema === undefined) return undefined;
  if (
    !schema ||
    schema.type !== 'jamboo-quiz' ||
    !Number.isInteger(schema.columns) ||
    !Number.isInteger(schema.rows) ||
    schema.columns < 1 ||
    schema.columns > QUIZ_LIMITS.columns ||
    schema.rows < 1 ||
    schema.rows > QUIZ_LIMITS.rows ||
    !['multiple', 'open', 'drawing', 'mixed'].includes(schema.questionType)
  ) {
    return null;
  }

  return {
    type: schema.type,
    columns: schema.columns,
    rows: schema.rows,
    questionType: schema.questionType,
  };
}

function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeAnswerKey(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[.,;:!?]/g, '')
    .replace(/\s+/g, ' ');
}

function isValidQuizQuestion(question, questionType) {
  if (!question || typeof question !== 'object' || Array.isArray(question)) return false;

  const prompt = question.q ?? question.question;
  const answer = question.a ?? question.answer;
  const options = question.o ?? question.options;
  const rawCorrectIndex = question.i ?? question.correctIndex;
  const correctIndex = Number.isInteger(rawCorrectIndex)
    ? rawCorrectIndex
    : Number.parseInt(rawCorrectIndex, 10);
  const isDrawing = question.d === 1 || question.d === true || question.isDrawing === true;
  const declaresMultipleChoice = options !== undefined || rawCorrectIndex !== undefined;
  const hasAnswer = isNonEmptyText(answer);
  const hasOptions = Array.isArray(options) &&
    options.length === 4 &&
    options.every(isNonEmptyText);
  const hasUniqueOptions = hasOptions &&
    new Set(options.map(normalizeAnswerKey)).size === options.length;
  const answerKey = normalizeAnswerKey(answer);
  const answerIndex = hasAnswer && hasOptions
    ? options.findIndex(option => normalizeAnswerKey(option) === answerKey)
    : -1;
  const hasCorrectIndex = Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < 4;
  const answerAndIndexAgree = !hasAnswer || !hasCorrectIndex || answerIndex === correctIndex;
  const hasMultipleChoice = hasUniqueOptions && answerAndIndexAgree &&
    (hasCorrectIndex || answerIndex >= 0);

  if (!isNonEmptyText(prompt)) return false;
  if (questionType === 'multiple') return !isDrawing && hasMultipleChoice;
  if (questionType === 'drawing') return isDrawing && !declaresMultipleChoice && hasAnswer;
  if (questionType === 'open') return !isDrawing && !declaresMultipleChoice && hasAnswer;
  if (isDrawing) return !declaresMultipleChoice && hasAnswer;
  return declaresMultipleChoice ? hasMultipleChoice : hasAnswer;
}

function getQuizAnswer(question) {
  const options = question.o ?? question.options;
  const rawCorrectIndex = question.i ?? question.correctIndex;
  const correctIndex = Number.isInteger(rawCorrectIndex)
    ? rawCorrectIndex
    : Number.parseInt(rawCorrectIndex, 10);
  return Array.isArray(options) && Number.isInteger(correctIndex)
    ? options[correctIndex]
    : question.a ?? question.answer;
}

function normalizeQuestionColumns(questions, columns, rows) {
  const isQuestionValue = question =>
    question && typeof question === 'object';
  const columnShape = questions.length >= columns &&
    questions.slice(0, columns).every(column =>
      Array.isArray(column) &&
      column.length >= rows &&
      column.slice(0, rows).every(isQuestionValue)
    );
  if (columnShape) {
    return questions.slice(0, columns).map(column => column.slice(0, rows));
  }

  const rowShape = questions.length >= rows &&
    questions.slice(0, rows).every(row =>
      Array.isArray(row) &&
      row.length >= columns &&
      row.slice(0, columns).every(isQuestionValue)
    );
  if (rowShape) {
    const trimmedRows = questions.slice(0, rows).map(row => row.slice(0, columns));
    return Array.from({ length: columns }, (_, columnIndex) =>
      trimmedRows.map(row => row[columnIndex])
    );
  }

  const flatShape = questions.length >= columns * rows &&
    questions.slice(0, columns * rows).every(isQuestionValue);
  if (flatShape) {
    return Array.from({ length: columns }, (_, columnIndex) => {
      const start = columnIndex * rows;
      return questions.slice(start, start + rows);
    });
  }

  return null;
}

function normalizeQuiz(value, schema) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const rawCategories = value.c ?? value.categories;
  const questions = value.qs ?? value.questions;
  if (
    !Array.isArray(rawCategories) ||
    rawCategories.length < schema.columns ||
    !rawCategories.every(isNonEmptyText) ||
    !Array.isArray(questions)
  ) {
    return null;
  }

  const normalizedQuestions = normalizeQuestionColumns(
    questions,
    schema.columns,
    schema.rows
  );
  if (!normalizedQuestions || !normalizedQuestions.every(column =>
    column.every(question => isValidQuizQuestion(question, schema.questionType))
  )) {
    return null;
  }

  const categories = rawCategories.slice(0, schema.columns).map(category => category.trim());
  if (new Set(categories.map(normalizeAnswerKey)).size !== categories.length) return null;
  const prompts = normalizedQuestions.flat().map(question =>
    normalizeAnswerKey(question.q ?? question.question)
  );
  if (new Set(prompts).size !== prompts.length) return null;
  return { c: categories, qs: normalizedQuestions };
}

function validateStructuredAnswer(answer, responseSchema) {
  let value;
  try {
    value = JSON.parse(answer);
  } catch (_) {
    return null;
  }

  if (!responseSchema) return JSON.stringify(value);
  const quiz = normalizeQuiz(value, responseSchema);
  return quiz ? JSON.stringify(quiz) : null;
}

function validateMessages(body) {
  const source = typeof body?.message === 'string'
    ? [{ role: 'user', content: body.message }]
    : body?.messages;

  if (!Array.isArray(source) || source.length < 1 || source.length > MAX_MESSAGES) {
    return null;
  }

  const messages = source.map(message => ({
    role: message?.role,
    content: typeof message?.content === 'string' ? message.content.trim() : '',
  }));
  const valid = messages.every(message =>
    ['system', 'user', 'assistant'].includes(message.role) &&
    message.content.length > 0 &&
    message.content.length <= MAX_MESSAGE_LENGTH
  );
  const totalLength = messages.reduce((total, message) => total + message.content.length, 0);

  if (!valid || totalLength > MAX_TOTAL_LENGTH || !messages.some(message => message.role === 'user')) {
    return null;
  }
  return messages;
}

function addServerInstructions(messages, extraInstructions = '') {
  if (messages[0]?.role === 'system') {
    return [
      {
        ...messages[0],
        content: `${SERVER_SYSTEM_PROMPT}\n\n${messages[0].content}${extraInstructions ? `\n\n${extraInstructions}` : ''}`,
      },
      ...messages.slice(1),
    ];
  }
  return [{
    role: 'system',
    content: extraInstructions
      ? `${SERVER_SYSTEM_PROMPT}\n\n${extraInstructions}`
      : SERVER_SYSTEM_PROMPT,
  }, ...messages];
}

function createOllamaRequest(messages, format) {
  const request = {
    model: OLLAMA_MODEL,
    messages,
    stream: false,
    think: false,
    options: {
      num_ctx: 4096,
      num_predict: typeof format === 'object' ? QUIZ_NUM_PREDICT : DEFAULT_NUM_PREDICT,
    },
    keep_alive: '30m',
  };
  if (format) request.format = format;
  return request;
}

async function requestOllama(chatUrl, messages, format, signal) {
  const upstream = await fetch(chatUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(createOllamaRequest(messages, format)),
    signal,
  });

  if (!upstream.ok) {
    console.error(`Ollama returned HTTP ${upstream.status}`);
    throw new OllamaResponseError();
  }

  let data;
  try {
    data = await upstream.json();
  } catch (_) {
    throw new InvalidAIResponseError('AI server returned invalid JSON');
  }

  const answer = data?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) {
    throw new InvalidAIResponseError('AI returned an empty response');
  }
  return answer.trim();
}

function createBatchInstructions(schema, columns, usedCategories, usedAnswers) {
  const categoryExclusions = usedCategories.length
    ? ` Do not reuse these categories: ${JSON.stringify(usedCategories)}.`
    : ' Make the category names distinct.';
  const answerExclusions = usedAnswers.length
    ? ` Do not reuse these answers: ${JSON.stringify(usedAnswers)}.`
    : '';
  return `BATCH OUTPUT OVERRIDE: This overrides only any earlier total-category count. Keep the original topic, language, difficulty, and item rules, but for this response generate exactly ${columns} new category arrays with exactly ${schema.rows} questions per array. The top-level "c" and "qs" arrays must each contain exactly ${columns} entries.${categoryExclusions}${answerExclusions}`;
}

function exactArray(length, items) {
  return {
    type: 'array',
    items,
    minItems: length,
    maxItems: length,
  };
}

function quizQuestionFormat(questionType) {
  const question = { type: 'string', minLength: 4, maxLength: 180 };
  const answer = { type: 'string', minLength: 1, maxLength: 80 };
  const multiple = {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: question,
      o: exactArray(4, answer),
      i: { type: 'integer', minimum: 0, maximum: 3 },
    },
    required: ['q', 'o', 'i'],
  };
  const open = {
    type: 'object',
    additionalProperties: false,
    properties: { q: question, a: answer },
    required: ['q', 'a'],
  };
  const drawing = {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: question,
      a: answer,
      d: { type: 'integer', enum: [1] },
    },
    required: ['q', 'a', 'd'],
  };

  if (questionType === 'multiple') return multiple;
  if (questionType === 'drawing') return drawing;
  if (questionType === 'open') return open;
  return { oneOf: [multiple, open, drawing] };
}

function createQuizFormat(schema) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      c: exactArray(schema.columns, {
        type: 'string',
        minLength: 1,
        maxLength: 50,
      }),
      qs: exactArray(
        schema.columns,
        exactArray(schema.rows, quizQuestionFormat(schema.questionType))
      ),
    },
    required: ['c', 'qs'],
  };
}

async function requestValidQuizBatch(chatUrl, messages, schema, instructions, signal) {
  for (let attempt = 1; attempt <= MAX_QUIZ_SCHEMA_ATTEMPTS; attempt += 1) {
    const repairInstruction = attempt === 1
      ? instructions
      : `${instructions}\nQUALITY REPAIR: The previous response failed validation. Make every category and question unique, use four distinct options for each multiple-choice question, and ensure each correct index points to the only correct option.`;
    const answer = await requestOllama(
      chatUrl,
      addServerInstructions(messages, repairInstruction),
      createQuizFormat(schema),
      signal
    );
    const validated = validateStructuredAnswer(answer, schema);
    if (validated) return validated;
  }

  throw new InvalidAIResponseError('AI returned quiz data in an unexpected format');
}

async function generateQuizAnswer(chatUrl, messages, schema, signal) {
  const totalItems = schema.columns * schema.rows;
  if (totalItems <= MAX_QUIZ_ITEMS_PER_CALL) {
    return requestValidQuizBatch(chatUrl, messages, schema, '', signal);
  }

  const columnsPerBatch = Math.max(1, Math.floor(MAX_QUIZ_ITEMS_PER_CALL / schema.rows));
  const quiz = { c: [], qs: [] };

  for (let offset = 0; offset < schema.columns; offset += columnsPerBatch) {
    const batchColumns = Math.min(columnsPerBatch, schema.columns - offset);
    const batchSchema = { ...schema, columns: batchColumns };
    const usedAnswers = quiz.qs.flat().map(getQuizAnswer);
    const batchInstructions = createBatchInstructions(schema, batchColumns, quiz.c, usedAnswers);
    const validated = await requestValidQuizBatch(
      chatUrl,
      messages,
      batchSchema,
      batchInstructions,
      signal
    );

    const batch = JSON.parse(validated);
    quiz.c.push(...(batch.c ?? batch.categories));
    quiz.qs.push(...(batch.qs ?? batch.questions));
  }

  const validatedQuiz = validateStructuredAnswer(JSON.stringify(quiz), schema);
  if (!validatedQuiz) {
    throw new InvalidAIResponseError('AI returned repeated or invalid quiz data');
  }
  return validatedQuiz;
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

  const messages = validateMessages(body);
  if (!messages) {
    return res.status(400).json({ error: 'A valid message or messages array is required' });
  }
  if (body.format !== undefined && body.format !== 'json') {
    return res.status(400).json({ error: 'Unsupported response format' });
  }
  const responseSchema = validateResponseSchema(body.responseSchema);
  if (responseSchema === null || (responseSchema && body.format !== 'json')) {
    return res.status(400).json({ error: 'Invalid response schema' });
  }

  let chatUrl;
  try {
    chatUrl = getOllamaEndpoint('/api/chat');
  } catch (_) {
    console.error('Invalid OLLAMA_URL configuration');
    return res.status(503).json({ error: 'AI server unavailable' });
  }
  if (!chatUrl) {
    console.error('OLLAMA_URL is not configured');
    return res.status(503).json({ error: 'AI server unavailable' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

  try {
    let answer;
    if (responseSchema) {
      answer = await generateQuizAnswer(chatUrl, messages, responseSchema, controller.signal);
    } else {
      answer = await requestOllama(
        chatUrl,
        addServerInstructions(messages),
        body.format,
        controller.signal
      );
      if (body.format === 'json') {
        answer = validateStructuredAnswer(answer);
        if (!answer) throw new InvalidAIResponseError('AI returned invalid JSON');
      }
    }

    return res.status(200).json({ answer });
  } catch (error) {
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      console.error('Ollama request timed out');
      return res.status(504).json({ error: 'AI server unavailable' });
    }
    if (error instanceof InvalidAIResponseError) {
      return res.status(502).json({
        error: error.message,
        code: 'INVALID_AI_RESPONSE',
      });
    }
    if (error instanceof OllamaResponseError) {
      return res.status(502).json({ error: 'AI server unavailable' });
    }

    console.error('Unable to reach Ollama');
    return res.status(502).json({ error: 'AI server unavailable' });
  } finally {
    clearTimeout(timeout);
  }
}
