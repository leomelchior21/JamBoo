import { AIBudgetError, AIConfigError, AIProviderError, InvalidAIResponseError } from './_ai-errors.mjs';
import { readBoundedInteger, readBoundedNumber, readFlag } from './_config.mjs';
import {
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
  MAX_DEEPSEEK_OUTPUT_TOKENS,
  callDeepSeek,
  deepseekEndpoint,
  isDeepSeekFlashModel,
  resolveDeepSeekModel,
} from './_deepseek.mjs';
import { callOllama, getOllamaEndpoint } from './_ollama.mjs';

const EMPTY_USAGE = Object.freeze({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
});

export function normalizeUsage(usage) {
  return { ...EMPTY_USAGE, ...(usage ?? {}) };
}

export function logAIUsage(entry) {
  console.info(`[ai-usage] ${JSON.stringify(entry)}`);
  if ((entry.reasoningTokens ?? 0) > 0) {
    console.warn(`[ai-usage] unexpected reasoning tokens provider=${entry.provider} stage=${entry.stage ?? 'unknown'} reasoningTokens=${entry.reasoningTokens}`);
  }
}

export class AIProvider {
  constructor({ name, model }) {
    this.name = name;
    this.model = model;
  }

  get configured() {
    return false;
  }

  async chat(options = {}) {
    const startedAt = Date.now();
    const base = {
      provider: this.name,
      requestedModel: this.model ?? null,
      stage: options.stage ?? null,
      category: options.category ?? null,
      retry: Number.isInteger(options.retry) ? options.retry : 0,
    };
    try {
      const result = await this.generate(options);
      logAIUsage({
        ...base,
        returnedModel: result.model ?? null,
        success: true,
        durationMs: Date.now() - startedAt,
        ...normalizeUsage(result.usage),
      });
      return result;
    } catch (error) {
      logAIUsage({
        ...base,
        returnedModel: null,
        success: false,
        error: error?.name ?? 'Error',
        durationMs: Date.now() - startedAt,
        ...EMPTY_USAGE,
      });
      throw error;
    }
  }

  async generate() {
    throw new AIConfigError('AI provider is not implemented');
  }

  async probe() {
    return { ready: this.configured, detail: this.configured ? 'configured' : 'not-configured' };
  }
}

export class LocalModelProvider extends AIProvider {
  constructor(env = process.env) {
    super({ name: 'local', model: env.OLLAMA_MODEL?.trim() || 'qwen3.5:4b' });
    this.configError = null;
    try {
      this.chatUrl = getOllamaEndpoint('/api/chat', env);
    } catch (error) {
      this.chatUrl = null;
      this.configError = error;
    }
    if (!this.chatUrl) {
      this.configError = this.configError ?? new AIConfigError('OLLAMA_URL is not configured');
    }
  }

  get configured() {
    return Boolean(this.chatUrl);
  }

  async probe() {
    if (!this.chatUrl) return { ready: false, detail: this.configError?.message ?? 'not-configured' };
    return { ready: true, detail: 'configured' };
  }

  async generate({ messages, schema, maxTokens, temperature, seed, signal }) {
    if (!this.chatUrl) throw this.configError;
    return callOllama({
      chatUrl: this.chatUrl,
      model: this.model,
      messages,
      format: schema,
      maxTokens,
      temperature,
      seed,
      signal,
    });
  }
}

function withSchemaInstruction(messages, schema) {
  if (!schema) return messages;
  const instruction = `Reply with one JSON object only (valid json, no markdown, no prose, no extra fields) matching this schema exactly:\n${JSON.stringify(schema)}`;
  const [first, ...rest] = messages;
  if (first?.role === 'system') {
    return [{ ...first, content: `${first.content}\n\n${instruction}` }, ...rest];
  }
  return [{ role: 'system', content: instruction }, ...messages];
}

export class DeepSeekProvider extends AIProvider {
  constructor(env = process.env) {
    const requestedModel = env.DEEPSEEK_MODEL?.trim() || '';
    super({ name: 'deepseek', model: resolveDeepSeekModel() });
    if (requestedModel && !isDeepSeekFlashModel(requestedModel)) {
      console.warn(`[ai] DEEPSEEK_MODEL=${requestedModel} is not a DeepSeek 4.1 Flash name; using ${this.model}`);
    }
    this.apiKey = env.DEEPSEEK_API_KEY?.trim() || '';
    this.timeoutMs = readBoundedInteger(env.DEEPSEEK_TIMEOUT_MS, DEFAULT_DEEPSEEK_TIMEOUT_MS, 500, 120000);
    this.temperature = readBoundedNumber(env.DEEPSEEK_TEMPERATURE, 0.2, 0, 1);
    this.maxTokens = readBoundedInteger(env.DEEPSEEK_MAX_TOKENS, 4000, 256, MAX_DEEPSEEK_OUTPUT_TOKENS);
    const thinkingParam = String(env.DEEPSEEK_DISABLE_THINKING_PARAM ?? '').trim().toLowerCase();
    this.thinkingParam = thinkingParam === 'reasoning_effort' || thinkingParam === 'none' ? thinkingParam : 'thinking';
    this.responseFormat = String(env.DEEPSEEK_RESPONSE_FORMAT ?? '').trim().toLowerCase() === 'none' ? 'none' : 'json_object';
    this.configError = null;
    try {
      this.endpoint = deepseekEndpoint(env.DEEPSEEK_BASE_URL);
    } catch (error) {
      this.endpoint = null;
      this.configError = error;
    }
    if (!this.apiKey) {
      this.configError = this.configError ?? new AIConfigError('DEEPSEEK_API_KEY is not configured');
    }
  }

  get configured() {
    return Boolean(this.apiKey && this.endpoint);
  }

  async generate({ messages, schema, maxTokens, signal }) {
    if (!this.configured) throw this.configError ?? new AIConfigError('DeepSeek is not configured');
    return callDeepSeek({
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      model: this.model,
      messages: withSchemaInstruction(messages, schema),
      temperature: this.temperature,
      maxTokens: Math.min(maxTokens ?? this.maxTokens, this.maxTokens),
      timeoutMs: this.timeoutMs,
      thinkingParam: this.thinkingParam,
      responseFormat: this.responseFormat,
      signal,
    });
  }

  async probe() {
    if (!this.configured) return { ready: false, detail: this.configError?.message ?? 'not-configured' };
    const url = new URL(this.endpoint.href);
    url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, '/models');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      return { ready: response.ok, detail: response.ok ? 'ok' : `HTTP ${response.status}` };
    } catch (error) {
      // Surface the network failure code (ENOTFOUND, ECONNREFUSED, timeouts) so a
      // broken DEEPSEEK_BASE_URL is visible from /api/ai/health without logs.
      const code = error?.cause?.code ?? error?.code ?? error?.name ?? 'error';
      return { ready: false, detail: `unreachable (${code})` };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class FallbackProvider extends AIProvider {
  constructor(primary, fallback) {
    super({ name: `${primary.name}+${fallback.name}`, model: primary.model });
    this.primary = primary;
    this.fallback = fallback;
  }

  get configured() {
    return this.primary.configured || this.fallback.configured;
  }

  chat(options) {
    return this.generate(options);
  }

  async probe() {
    const primary = await this.primary.probe();
    if (primary.ready) return primary;
    const fallback = await this.fallback.probe();
    return fallback.ready
      ? { ready: true, detail: `${this.primary.name}:${primary.detail}; ${this.fallback.name}:ok` }
      : { ready: false, detail: `${this.primary.name}:${primary.detail}; ${this.fallback.name}:${fallback.detail}` };
  }

  async generate(options) {
    if (!this.primary.configured) return this.fallback.chat(options);
    try {
      return await this.primary.chat(options);
    } catch (error) {
      if (!(error instanceof AIProviderError) && !(error instanceof InvalidAIResponseError)) throw error;
      console.warn(`[ai] primary provider failed; using local fallback (ALLOW_LOCAL_AI_FALLBACK=true) reason=${error.name}`);
      return this.fallback.chat(options);
    }
  }
}

export function createQuizProvider(env = process.env) {
  const requested = String(env.QUIZ_AI_PROVIDER ?? '').trim().toLowerCase();
  if (requested === 'local') return new LocalModelProvider(env);
  if (requested && requested !== 'deepseek') {
    console.warn(`[ai] unknown QUIZ_AI_PROVIDER=${requested}; using deepseek`);
  }
  const primary = new DeepSeekProvider(env);
  if (readFlag(env.ALLOW_LOCAL_AI_FALLBACK)) {
    return new FallbackProvider(primary, new LocalModelProvider(env));
  }
  return primary;
}

export function createCallBudget(limit) {
  return { limit: Math.max(1, Number(limit) || 1), spent: 0 };
}

export function spendCall(budget) {
  if (!budget) return;
  budget.spent += 1;
  if (budget.spent > budget.limit) {
    throw new AIBudgetError(`AI call budget exceeded (${budget.limit} per generation request)`);
  }
}
