import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
}

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find(argument => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function readIntArg(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(readArg(name, ''), 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

const HELP = `DeepSeek-only live smoke test (no local/Ollama fallback).

Usage:
  DEEPSEEK_API_KEY=... npm run test:deepseek
  npm run test:deepseek -- --topic="7th Grade Mathematics" --columns=3 --rows=3

Options:
  --topic=...       Board topic (default: Dinosaurs)
  --columns=N       1-8 categories (default: 2)
  --rows=N          1-6 rows (default: 2)
  --lang=en|pt|es   Quiz language (default: en)
  --difficulty=easy|medium|hard|mixed (default: mixed)
  --type=multiple|open|drawing|mixed (default: mixed)
  --help

Reads DEEPSEEK_API_KEY from the environment or from .env.local.
The script refuses to run with any provider other than deepseek.`;

if (process.argv.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}

loadEnvFile(resolve(process.cwd(), '.env.local'));

process.env.QUIZ_AI_PROVIDER = 'deepseek';
delete process.env.ALLOW_LOCAL_AI_FALLBACK;
delete process.env.OLLAMA_URL;

const topic = readArg('topic', 'Dinosaurs');
const columns = readIntArg('columns', 2, 1, 8);
const rows = readIntArg('rows', 2, 1, 6);
const language = { en: 'English', pt: 'Portuguese', es: 'Spanish' }[readArg('lang', 'en')] ?? 'English';
const difficulty = ['easy', 'medium', 'hard', 'mixed'].includes(readArg('difficulty', 'mixed'))
  ? readArg('difficulty', 'mixed')
  : 'mixed';
const questionType = ['multiple', 'open', 'drawing', 'mixed'].includes(readArg('type', 'mixed'))
  ? readArg('type', 'mixed')
  : 'mixed';

const { createQuizProvider } = await import('../api/_ai-provider.mjs');
const { default: handler } = await import('../api/ai.js');

function fail(message) {
  console.error(`\nDEEPSEEK SMOKE FAIL: ${message}\n`);
  process.exit(1);
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function callApi(body) {
  const res = responseRecorder();
  await handler({ method: 'POST', body }, res);
  if (res.statusCode !== 200) {
    fail(`action ${body.action} returned HTTP ${res.statusCode}: ${JSON.stringify(res.body)}`);
  }
  return JSON.parse(res.body.answer);
}

function expectedSlotIds(columnCount, rowCount) {
  const ids = [];
  for (let column = 0; column < columnCount; column += 1) {
    for (let row = 0; row < rowCount; row += 1) ids.push(`${column}-${row}`);
  }
  return ids;
}

const usageEntries = [];
const originalInfo = console.info;
console.info = (...args) => {
  const line = String(args[0] ?? '');
  if (line.startsWith('[ai-usage] ')) {
    try {
      usageEntries.push(JSON.parse(line.slice('[ai-usage] '.length)));
    } catch (_) {
      originalInfo(...args);
    }
    return;
  }
  originalInfo(...args);
};

const provider = createQuizProvider();
if (provider.name !== 'deepseek') {
  fail(`expected provider "deepseek", got "${provider.name}". Ollama fallback is intentionally disabled.`);
}
if (!provider.configured) {
  fail('DeepSeek is not configured. Set DEEPSEEK_API_KEY in the environment or in .env.local.');
}

const probe = await provider.probe();
if (!probe.ready) {
  fail(`DeepSeek probe failed (${probe.detail}). Check DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL and account balance.`);
}

console.log('DeepSeek smoke test');
console.log(`provider=${provider.name} model=${provider.model} probe=${probe.detail}`);
console.log(`topic="${topic}" board=${columns}x${rows} (${columns * rows} slots) difficulty=${difficulty} types=${questionType} language=${language}\n`);

const startedAt = Date.now();
const seed = `smoke-${Date.now().toString(36)}`;
const generationId = `smoke-${Math.random().toString(36).slice(2)}`;
const spec = { topic, language, columns, rows, difficulty, questionType, seed, generationId };

const plan = await callApi({ action: 'quiz-plan', quiz: spec });
const slotIds = expectedSlotIds(columns, rows);
if (plan.categories.length !== columns) fail(`expected ${columns} categories, got ${plan.categories.length}`);
if (plan.slots.length !== columns * rows) fail(`expected ${columns * rows} slots, got ${plan.slots.length}`);
plan.slots.forEach((slot, index) => {
  if (slot.slotId !== slotIds[index]) fail(`slot order mismatch at ${index}: expected ${slotIds[index]}, got ${slot.slotId}`);
});
console.log(`categories: ${plan.categories.map(category => JSON.stringify(category)).join(', ')}`);
console.log(`kind: ${plan.kind}\n`);

const generated = new Map();
let pending = plan.slots;
for (let round = 1; round <= 2 && pending.length; round += 1) {
  const failedIds = [];
  for (let offset = 0; offset < pending.length; offset += plan.batchSize) {
    const batchSlots = pending.slice(offset, offset + plan.batchSize);
    const batch = await callApi({
      action: 'quiz-batch',
      quiz: {
        ...spec,
        categories: plan.categories,
        kind: plan.kind,
        slotIds: batchSlots.map(slot => slot.slotId),
        excludedQuestions: [...generated.values()].map(question => question.q),
      },
    });
    batch.questions.forEach(question => generated.set(question.slotId, question));
    failedIds.push(...batch.failedSlots);
  }
  pending = plan.slots.filter(slot => !generated.has(slot.slotId));
}

const missing = plan.slots.map(slot => slot.slotId).filter(slotId => !generated.has(slotId));
if (missing.length) fail(`incomplete board, missing slots: ${missing.join(', ')} (nothing is committed)`);

const finalized = await callApi({
  action: 'quiz-validate',
  quiz: { ...spec, categories: plan.categories, questions: [...generated.values()], missingSlotIds: [] },
});
if (finalized.ready !== true || finalized.questions.length !== columns * rows) {
  fail(`final validation returned ${finalized.questions.length} questions`);
}

const slotById = new Map(plan.slots.map(slot => [slot.slotId, slot]));
const questions = finalized.questions.map(question => ({ ...question, slot: slotById.get(question.slotId) }));
for (const question of questions) {
  const { slot } = question;
  if (slot.type === 'multiple') {
    if (!Array.isArray(question.o) || question.o.length !== 4 || new Set(question.o).size !== 4) {
      fail(`invalid multiple choice options for ${slot.slotId}`);
    }
    if (question.o[question.i] !== question.a) fail(`correct index mismatch for ${slot.slotId}`);
  }
  if (slot.type === 'open' && typeof question.a !== 'string') fail(`missing open answer for ${slot.slotId}`);
  if (slot.type === 'drawing' && question.d !== 1) fail(`missing drawing marker for ${slot.slotId}`);
  console.log(`[${slot.points} pts | ${slot.difficulty} | ${slot.type}] ${question.q}`);
  console.log(`    answer: ${Array.isArray(question.o) ? question.o[question.i] : question.a}`);
}

const totals = usageEntries.reduce((sum, entry) => ({
  calls: sum.calls + 1,
  promptTokens: sum.promptTokens + (entry.promptTokens ?? 0),
  completionTokens: sum.completionTokens + (entry.completionTokens ?? 0),
  totalTokens: sum.totalTokens + (entry.totalTokens ?? 0),
  reasoningTokens: sum.reasoningTokens + (entry.reasoningTokens ?? 0),
  cacheHitTokens: sum.cacheHitTokens + (entry.cacheHitTokens ?? 0),
  cacheMissTokens: sum.cacheMissTokens + (entry.cacheMissTokens ?? 0),
}), { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, reasoningTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 });

console.info = originalInfo;
console.log('\nDeepSeek usage');
console.log(JSON.stringify({
  provider: provider.name,
  model: provider.model,
  calls: totals.calls,
  promptTokens: totals.promptTokens,
  completionTokens: totals.completionTokens,
  totalTokens: totals.totalTokens,
  reasoningTokens: totals.reasoningTokens,
  cacheHitTokens: totals.cacheHitTokens,
  cacheMissTokens: totals.cacheMissTokens,
  durationMs: Date.now() - startedAt,
}, null, 2));

if (totals.reasoningTokens > 0) fail(`reasoning tokens were billed (${totals.reasoningTokens}) although thinking is disabled`);
if (!totals.calls) fail('no provider usage was logged');

console.log('\nDEEPSEEK SMOKE PASS\n');
