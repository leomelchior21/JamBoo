import assert from 'node:assert/strict';
import test from 'node:test';

import { AIBudgetError, AIProviderError, AITimeoutError, InvalidAIResponseError } from '../api/ai-errors.mjs';
import {
  AIProvider,
  DeepSeekProvider,
  FallbackProvider,
  LocalModelProvider,
  createCallBudget,
  createQuizProvider,
  spendCall,
} from '../api/ai-provider.mjs';

function deepseekResponse(content, usage = {}) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        model: 'deepseek-flash-2026',
        choices: [{ message: { content } }],
        usage: {
          prompt_tokens: 3200,
          completion_tokens: 1400,
          total_tokens: 4600,
          prompt_cache_hit_tokens: 300,
          prompt_cache_miss_tokens: 2900,
          completion_tokens_details: { reasoning_tokens: 0 },
          ...usage,
        },
      };
    },
  };
}

function ollamaResponse(content) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { model: 'qwen3.5:4b', message: { content }, prompt_eval_count: 900, eval_count: 400 };
    },
  };
}

class StubProvider extends AIProvider {
  constructor(name, { error = null, result = { content: '{"ok":true}', model: null, usage: null } } = {}) {
    super({ name, model: name });
    this.error = error;
    this.result = result;
    this.calls = 0;
  }

  get configured() {
    return true;
  }

  async generate() {
    this.calls += 1;
    if (this.error) throw this.error;
    return this.result;
  }
}

test('DeepSeek requests are OpenAI-compatible with thinking disabled', async () => {
  const provider = new DeepSeekProvider({ DEEPSEEK_API_KEY: 'test-key' });
  assert.equal(provider.configured, true);
  assert.equal(provider.name, 'deepseek');
  assert.equal(provider.model, 'deepseek-flash');

  const captured = [];
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return deepseekResponse('{"qs":[]}');
  };

  const result = await provider.chat({
    messages: [
      { role: 'system', content: 'You write quiz content as json.' },
      { role: 'user', content: 'Fill the slots.' },
    ],
    schema: { type: 'object', properties: { qs: { type: 'array' } } },
    maxTokens: 777,
    temperature: 0.8,
    stage: 'quiz-category',
    category: 'World Cup',
    retry: 1,
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(captured[0].body.model, 'deepseek-flash');
  assert.equal(captured[0].body.stream, false);
  assert.equal(captured[0].body.max_tokens, 777);
  assert.equal(captured[0].body.temperature, 0.2);
  assert.deepEqual(captured[0].body.thinking, { type: 'disabled' });
  assert.equal(captured[0].body.reasoning_effort, undefined);
  assert.deepEqual(captured[0].body.response_format, { type: 'json_object' });
  assert.match(captured[0].body.messages[0].content, /Reply with one JSON object only/);
  assert.match(captured[0].body.messages[0].content, /valid json/);
  assert.match(captured[0].body.messages[0].content, /"properties"/);
  assert.equal(result.content, '{"qs":[]}');
  assert.equal(result.model, 'deepseek-flash-2026');
  assert.deepEqual(result.usage, {
    promptTokens: 3200,
    completionTokens: 1400,
    totalTokens: 4600,
    reasoningTokens: 0,
    cacheHitTokens: 300,
    cacheMissTokens: 2900,
  });
});

test('DeepSeek stays on 4.1 Flash even when DEEPSEEK_MODEL names another model', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    let sentModel = null;
    globalThis.fetch = async (_url, init) => {
      sentModel = JSON.parse(init.body).model;
      return deepseekResponse('{"qs":[]}');
    };

    const pro = new DeepSeekProvider({ DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_MODEL: 'deepseek-v4-pro' });
    assert.equal(pro.model, 'deepseek-flash');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /deepseek-v4-pro/);
    await pro.chat({ messages: [{ role: 'user', content: 'json' }] });
    assert.equal(sentModel, 'deepseek-flash');

    const legacy = new DeepSeekProvider({ DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_MODEL: 'deepseek-v4-flash' });
    assert.equal(legacy.model, 'deepseek-flash');
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test('usage logs carry tokens, stage and retry but never the API key', async () => {
  const provider = new DeepSeekProvider({ DEEPSEEK_API_KEY: 'super-secret-key' });
  globalThis.fetch = async () => deepseekResponse('{"qs":[]}');

  const logs = [];
  const originalInfo = console.info;
  console.info = line => logs.push(String(line));
  try {
    await provider.chat({
      messages: [{ role: 'user', content: 'json please' }],
      stage: 'quiz-category',
      category: 'World Cup',
      retry: 2,
    });
  } finally {
    console.info = originalInfo;
  }

  const usageLine = logs.find(line => line.startsWith('[ai-usage] '));
  assert.ok(usageLine, 'expected an ai-usage log line');
  const entry = JSON.parse(usageLine.slice('[ai-usage] '.length));
  assert.deepEqual(entry, {
    provider: 'deepseek',
    requestedModel: 'deepseek-flash',
    stage: 'quiz-category',
    category: 'World Cup',
    retry: 2,
    returnedModel: 'deepseek-flash-2026',
    success: true,
    durationMs: entry.durationMs,
    promptTokens: 3200,
    completionTokens: 1400,
    totalTokens: 4600,
    reasoningTokens: 0,
    cacheHitTokens: 300,
    cacheMissTokens: 2900,
  });
  assert.ok(Number.isInteger(entry.durationMs));
  assert.ok(!logs.some(line => line.includes('super-secret-key')));
});

test('supports the reasoning_effort equivalent for disabling thinking', async () => {
  const provider = new DeepSeekProvider({
    DEEPSEEK_API_KEY: 'test-key',
    DEEPSEEK_DISABLE_THINKING_PARAM: 'reasoning_effort',
  });
  let body = null;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return deepseekResponse('{"qs":[]}');
  };
  await provider.chat({ messages: [{ role: 'user', content: 'json' }] });
  assert.equal(body.reasoning_effort, 'none');
  assert.equal(body.thinking, undefined);
});

test('optional DeepSeek parameters can be omitted as an escape hatch', async () => {
  const provider = new DeepSeekProvider({
    DEEPSEEK_API_KEY: 'test-key',
    DEEPSEEK_DISABLE_THINKING_PARAM: 'none',
    DEEPSEEK_RESPONSE_FORMAT: 'none',
  });
  let body = null;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return deepseekResponse('{"qs":[]}');
  };
  await provider.chat({ messages: [{ role: 'user', content: 'json' }] });
  assert.equal(body.thinking, undefined);
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.response_format, undefined);
});

test('upstream error details are surfaced without secrets', async () => {
  const provider = new DeepSeekProvider({ DEEPSEEK_API_KEY: 'test-key' });
  globalThis.fetch = async () => ({
    ok: false,
    status: 402,
    async json() { return { error: { message: 'Insufficient Balance' } }; },
  });
  await assert.rejects(
    () => provider.chat({ messages: [{ role: 'user', content: 'json' }] }),
    error => error instanceof AIProviderError && /HTTP 402: Insufficient Balance/.test(error.message)
  );
});

test('DeepSeek probe reports readiness and HTTP failures', async () => {
  const provider = new DeepSeekProvider({ DEEPSEEK_API_KEY: 'test-key' });
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return { ok: true, status: 200 };
  };
  assert.deepEqual(await provider.probe(), { ready: true, detail: 'ok' });
  assert.equal(urls[0], 'https://api.deepseek.com/models');

  globalThis.fetch = async () => ({ ok: false, status: 401 });
  assert.deepEqual(await provider.probe(), { ready: false, detail: 'HTTP 401' });

  const unconfigured = new DeepSeekProvider({});
  assert.equal((await unconfigured.probe()).ready, false);
});

test('DeepSeek provider classifies retryable and fatal upstream failures', async () => {
  const provider = new DeepSeekProvider({ DEEPSEEK_API_KEY: 'test-key' });
  const classify = async status => {
    globalThis.fetch = async () => ({ ok: false, status, async json() { return {}; } });
    try {
      await provider.chat({ messages: [{ role: 'user', content: 'json' }] });
      return null;
    } catch (error) {
      assert.ok(error instanceof AIProviderError, `expected AIProviderError for HTTP ${status}`);
      assert.equal(error.status, status);
      return error.retryable;
    }
  };

  assert.equal(await classify(429), true);
  assert.equal(await classify(500), true);
  assert.equal(await classify(503), true);
  assert.equal(await classify(400), false);
  assert.equal(await classify(401), false);
  assert.equal(await classify(402), false);

  globalThis.fetch = async () => { throw new Error('socket closed'); };
  await assert.rejects(
    () => provider.chat({ messages: [{ role: 'user', content: 'json' }] }),
    error => error instanceof AIProviderError && error.retryable === true
  );

  globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return { choices: [] }; } });
  await assert.rejects(() => provider.chat({ messages: [{ role: 'user', content: 'json' }] }), InvalidAIResponseError);
});

test('DeepSeek provider aborts on its request timeout', async () => {
  const provider = new DeepSeekProvider({ DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_TIMEOUT_MS: '500' });
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
  await assert.rejects(() => provider.chat({ messages: [{ role: 'user', content: 'json' }] }), AITimeoutError);
});

test('DeepSeek timeout covers reading the response body, not just the headers', async () => {
  const provider = new DeepSeekProvider({ DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_TIMEOUT_MS: '500' });
  globalThis.fetch = (_url, init) => Promise.resolve({
    ok: true,
    status: 200,
    json: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });
  await assert.rejects(() => provider.chat({ messages: [{ role: 'user', content: 'json' }] }), AITimeoutError);
});

test('local provider keeps Ollama structured output and usage', async () => {
  const provider = new LocalModelProvider({ OLLAMA_URL: 'https://ollama.test' });
  assert.equal(provider.configured, true);
  let body = null;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return ollamaResponse('{"qs":[]}');
  };
  const result = await provider.chat({
    messages: [{ role: 'user', content: 'json' }],
    schema: { type: 'object' },
    maxTokens: 650,
    seed: 42,
    stage: 'quiz-plan',
  });
  assert.deepEqual(body.format, { type: 'object' });
  assert.equal(body.options.num_predict, 650);
  assert.equal(body.options.seed, 42);
  assert.equal(body.think, false);
  assert.deepEqual(result.usage, {
    promptTokens: 900,
    completionTokens: 400,
    totalTokens: 1300,
    reasoningTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
  });
});

test('a misconfigured local provider stays unavailable instead of throwing', () => {
  const provider = new LocalModelProvider({});
  assert.equal(provider.configured, false);
  const notHttps = new LocalModelProvider({ OLLAMA_URL: 'http://ollama.test' });
  assert.equal(notHttps.configured, false);
});

test('fallback provider only falls back for provider-level failures', async () => {
  const local = new StubProvider('local', { result: { content: '{"local":true}', model: 'local', usage: null } });

  const providerFailure = new StubProvider('deepseek', { error: new AIProviderError('HTTP 500') });
  const fallback = new FallbackProvider(providerFailure, local);
  assert.equal((await fallback.chat({})).content, '{"local":true}');
  assert.equal(providerFailure.calls, 1);
  assert.equal(local.calls, 1);

  const invalidResponse = new StubProvider('deepseek', { error: new InvalidAIResponseError('garbage') });
  const invalidFallback = new FallbackProvider(invalidResponse, local);
  assert.equal((await invalidFallback.chat({})).content, '{"local":true}');

  const timedOut = new StubProvider('deepseek', { error: new AITimeoutError('timed out') });
  const strictFallback = new FallbackProvider(timedOut, local);
  await assert.rejects(() => strictFallback.chat({}), AITimeoutError);
});

test('createQuizProvider defaults to DeepSeek and honors explicit flags', () => {
  assert.equal(createQuizProvider({}).name, 'deepseek');
  assert.equal(createQuizProvider({ QUIZ_AI_PROVIDER: 'local' }).name, 'local');
  assert.equal(createQuizProvider({ DEEPSEEK_API_KEY: 'k' }).configured, true);
  assert.equal(createQuizProvider({}).configured, false);
  const fallback = createQuizProvider({
    DEEPSEEK_API_KEY: 'k',
    OLLAMA_URL: 'https://ollama.test',
    ALLOW_LOCAL_AI_FALLBACK: 'true',
  });
  assert.equal(fallback.name, 'deepseek+local');
});

test('call budgets stop runaway provider calls', () => {
  const budget = createCallBudget(2);
  spendCall(budget);
  spendCall(budget);
  assert.throws(() => spendCall(budget), AIBudgetError);
});
