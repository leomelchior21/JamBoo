const OLLAMA_MODEL = 'qwen3.5:4b';
const CHAT_TIMEOUT_MS = 120000;
const MAX_MESSAGES = 4;
const MAX_MESSAGE_LENGTH = 12000;
const MAX_TOTAL_LENGTH = 20000;
const QUIZ_LIMITS = { columns: 8, rows: 6 };
const MAX_QUIZ_ITEMS_PER_CALL = 12;
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
  const hasAnswer = isNonEmptyText(answer);
  const hasOptions = Array.isArray(options) &&
    options.length === 4 &&
    options.every(isNonEmptyText);
  const answerKey = normalizeAnswerKey(answer);
  const answerIndex = hasAnswer && hasOptions
    ? options.findIndex(option => normalizeAnswerKey(option) === answerKey)
    : -1;
  const hasCorrectIndex = Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < 4;
  const hasMultipleChoice = hasOptions && (hasCorrectIndex || answerIndex >= 0);

  if (!isNonEmptyText(prompt)) return false;
  if (questionType === 'multiple') return !isDrawing && hasMultipleChoice;
  if (questionType === 'drawing') return isDrawing && hasAnswer;
  if (questionType === 'open') return !isDrawing && !hasMultipleChoice && hasAnswer;
  return (isDrawing && hasAnswer) ||
    (!isDrawing && hasMultipleChoice) ||
    (!isDrawing && !hasMultipleChoice && hasAnswer);
}

function expandWireQuestion(question, questionType) {
  if (!Array.isArray(question)) return question;

  if (questionType === 'multiple') {
    if (question.length === 3 && Array.isArray(question[1])) {
      return { q: question[0], o: question[1], i: question[2] };
    }
    return { q: question[0], o: question.slice(1, 5), i: question[5] };
  }
  if (questionType === 'open') return { q: question[0], a: question[1] };
  if (questionType === 'drawing') return { q: question[0], a: question[1], d: 1 };

  const [rawType, prompt, ...fields] = question;
  const type = String(rawType ?? '').toLowerCase();
  if (type === 'm' || type === 'multiple') {
    if (fields.length === 2 && Array.isArray(fields[0])) {
      return { q: prompt, o: fields[0], i: fields[1] };
    }
    return { q: prompt, o: fields.slice(0, 4), i: fields[4] };
  }
  if (type === 'd' || type === 'drawing') return { q: prompt, a: fields[0], d: 1 };
  if (type === 'o' || type === 'open') return { q: prompt, a: fields[0] };
  return null;
}

function uniqueTexts(values) {
  const seen = new Set();
  return values.filter(value => {
    if (!isNonEmptyText(value)) return false;
    const key = normalizeAnswerKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildMultipleChoiceQuestion(prompt, answer, categoryPool, columnIndex, rowIndex) {
  if (!isNonEmptyText(prompt) || !isNonEmptyText(answer)) return null;

  const answerKey = normalizeAnswerKey(answer);
  const distractors = categoryPool.filter(option => normalizeAnswerKey(option) !== answerKey);
  if (distractors.length < 3) return null;

  const start = rowIndex % distractors.length;
  const choices = Array.from(
    { length: 3 },
    (_, index) => distractors[(start + index) % distractors.length]
  );
  const correctIndex = (columnIndex + rowIndex) % 4;
  choices.splice(correctIndex, 0, answer);
  return { q: prompt, o: choices, i: correctIndex };
}

function expandPooledMultipleChoice(questionColumns, extraColumns) {
  const allAnswers = uniqueTexts([
    ...questionColumns.flatMap(column => column.map(question => question[1])),
    ...(Array.isArray(extraColumns) ? extraColumns.flat() : []),
  ]);

  const expanded = questionColumns.map((column, columnIndex) => {
    const categoryExtras = Array.isArray(extraColumns?.[columnIndex])
      ? extraColumns[columnIndex]
      : [];
    const categoryPool = uniqueTexts([
      ...column.map(question => question[1]),
      ...categoryExtras,
      ...allAnswers,
    ]);
    if (categoryPool.length < 4) return null;

    return column.map((question, rowIndex) =>
      buildMultipleChoiceQuestion(
        question[0],
        question[1],
        categoryPool,
        columnIndex,
        rowIndex
      )
    );
  });

  if (expanded.some(column => !column || column.some(question => !question))) return null;
  return expanded;
}

function expandPooledMixed(questionColumns, extraColumns) {
  const allAnswers = uniqueTexts([
    ...questionColumns.flatMap(column => column.map(question => question[2])),
    ...(Array.isArray(extraColumns) ? extraColumns.flat() : []),
  ]);

  const expanded = questionColumns.map((column, columnIndex) => {
    const categoryExtras = Array.isArray(extraColumns?.[columnIndex])
      ? extraColumns[columnIndex]
      : [];
    const categoryPool = uniqueTexts([
      ...column.map(question => question[2]),
      ...categoryExtras,
      ...allAnswers,
    ]);
    if (categoryPool.length < 4) return null;

    return column.map((question, rowIndex) => {
      const [rawType, prompt, answer] = question;
      const type = String(rawType ?? '').toLowerCase();
      if (type === 'm') {
        return buildMultipleChoiceQuestion(
          prompt,
          answer,
          categoryPool,
          columnIndex,
          rowIndex
        );
      }
      if (type === 'd' && isNonEmptyText(prompt) && isNonEmptyText(answer)) {
        return { q: prompt, a: answer, d: 1 };
      }
      if (type === 'o' && isNonEmptyText(prompt) && isNonEmptyText(answer)) {
        return { q: prompt, a: answer };
      }
      return null;
    });
  });

  if (expanded.some(column => !column || column.some(question => !question))) return null;
  return expanded;
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
  const questions = value.qs ?? value.questions ?? value.q;
  if (
    !Array.isArray(rawCategories) ||
    rawCategories.length < 1 ||
    !rawCategories.every(isNonEmptyText) ||
    !Array.isArray(questions)
  ) {
    return null;
  }

  const questionColumns = normalizeQuestionColumns(
    questions,
    schema.columns,
    schema.rows
  );
  if (!questionColumns) return null;

  const usesPooledMultipleChoice = schema.questionType === 'multiple' &&
    questionColumns.every(column => column.every(question =>
      Array.isArray(question) &&
      question.length === 2 &&
      isNonEmptyText(question[0]) &&
      isNonEmptyText(question[1])
    ));
  const usesPooledMixed = schema.questionType === 'mixed' &&
    questionColumns.every(column => column.every(question =>
      Array.isArray(question) &&
      question.length === 3 &&
      ['m', 'o', 'd'].includes(String(question[0] ?? '').toLowerCase()) &&
      isNonEmptyText(question[1]) &&
      isNonEmptyText(question[2])
    ));
  let normalizedQuestions;
  if (usesPooledMultipleChoice) {
    normalizedQuestions = expandPooledMultipleChoice(
      questionColumns,
      value.d ?? value.distractors
    );
  } else if (usesPooledMixed) {
    normalizedQuestions = expandPooledMixed(
      questionColumns,
      value.d ?? value.distractors
    );
  } else {
    normalizedQuestions = questionColumns.map(column =>
      column.map(question => expandWireQuestion(question, schema.questionType))
    );
  }
  if (!normalizedQuestions) return null;
  if (!normalizedQuestions.every(column =>
    column.every(question => isValidQuizQuestion(question, schema.questionType))
  )) {
    return null;
  }

  const categories = rawCategories.slice(0, schema.columns).map(category => category.trim());
  while (categories.length < schema.columns) {
    categories.push(`Category ${categories.length + 1}`);
  }
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
      num_predict: 400,
      temperature: 0,
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

function createBatchInstructions(schema, columns, usedCategories) {
  const exclusions = usedCategories.length
    ? ` Do not reuse these categories: ${JSON.stringify(usedCategories)}.`
    : ' Make the category names distinct.';
  const usesChoicePool = schema.questionType === 'multiple' || schema.questionType === 'mixed';
  const extraAnswerCount = usesChoicePool ? Math.max(0, 4 - schema.rows) : 0;
  const itemShape = {
    multiple: `Each "q" item is ["real question","correct answer"]. The server creates choices from the correct answers in that category${extraAnswerCount ? ` plus exactly ${extraAnswerCount} extra wrong answer${extraAnswerCount === 1 ? '' : 's'} per category in "d"` : ''}.`,
    open: 'Each item is ["question","short answer"].',
    drawing: 'Each item is ["drawing prompt","expected answer"].',
    mixed: `Each item is ["m","real question","correct answer"], ["o","question","short answer"], or ["d","drawing prompt","expected answer"]. Use a varied mix. The server creates choices for "m" from answers in that category${extraAnswerCount ? ' plus the extra answers in "d"' : ''}.`,
  }[schema.questionType];
  const itemExample = {
    multiple: '["question","correct answer"]',
    open: '["question","short answer"]',
    drawing: '["drawing prompt","expected answer"]',
    mixed: '["type","question","answer"]',
  }[schema.questionType];
  const extraExample = usesChoicePool && extraAnswerCount
    ? `,"d":[[${Array.from({ length: extraAnswerCount }, () => '"extra answer"').join(',')}]]`
    : '';
  return `FAST QUIZ OUTPUT OVERRIDE: Create the quiz from the user's topic. Keep the requested content language, difficulty progression, and question type, but ignore all earlier JSON examples. Return only {"c":["category"]${extraExample},"q":[[${itemExample}]]}. "c" and column-major "q" must each have exactly ${columns} entries; each "q" column must have exactly ${schema.rows} items. ${itemShape} Correct answers within a category must differ. Use no question objects, blanks, underscores, or answer-only prompts. Keep questions at most 9 words, answers at most 3 words, and category names at most 3 words.${exclusions}`;
}

function exactArray(length, items) {
  return { type: 'array', items, minItems: length, maxItems: length };
}

function createQuizFormat(schema) {
  const shortText = { type: 'string', minLength: 1, maxLength: 24 };
  const questionText = { type: 'string', minLength: 1, maxLength: 72 };
  const columns = schema.columns;
  const rows = schema.rows;
  const properties = {
    c: exactArray(columns, shortText),
  };
  const required = ['c'];

  if (schema.questionType === 'multiple' || schema.questionType === 'mixed') {
    const prefixItems = schema.questionType === 'multiple'
      ? [questionText, shortText]
      : [{ type: 'string', enum: ['m', 'o', 'd'] }, questionText, shortText];
    const pair = {
      type: 'array',
      prefixItems,
      minItems: prefixItems.length,
      maxItems: prefixItems.length,
    };
    const extraAnswerCount = Math.max(0, 4 - rows);
    if (extraAnswerCount) {
      properties.d = exactArray(columns, exactArray(extraAnswerCount, shortText));
      required.push('d');
    }
    properties.q = exactArray(columns, exactArray(rows, pair));
  } else {
    const pair = {
      type: 'array',
      prefixItems: [questionText, shortText],
      minItems: 2,
      maxItems: 2,
    };
    properties.q = exactArray(columns, exactArray(rows, pair));
  }
  required.push('q');

  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
}

async function requestValidQuizBatch(chatUrl, messages, schema, instructions, signal) {
  const answer = await requestOllama(
    chatUrl,
    addServerInstructions(messages, instructions),
    createQuizFormat(schema),
    signal
  );
  const validated = validateStructuredAnswer(answer, schema);
  if (validated) return validated;

  throw new InvalidAIResponseError('AI returned quiz data in an unexpected format');
}

async function generateQuizAnswer(chatUrl, messages, schema, signal) {
  const columnsPerBatch = Math.max(1, Math.floor(MAX_QUIZ_ITEMS_PER_CALL / schema.rows));
  const quiz = { c: [], qs: [] };

  for (let offset = 0; offset < schema.columns; offset += columnsPerBatch) {
    const batchColumns = Math.min(columnsPerBatch, schema.columns - offset);
    const batchSchema = { ...schema, columns: batchColumns };
    const batchInstructions = createBatchInstructions(schema, batchColumns, quiz.c);
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

  return JSON.stringify(quiz);
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
