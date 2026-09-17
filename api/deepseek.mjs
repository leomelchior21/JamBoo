import { AIConfigError, AIProviderError, AITimeoutError, InvalidAIResponseError, providerHttpError } from './ai-errors.mjs';

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
export const DEFAULT_DEEPSEEK_TIMEOUT_MS = 30000;
export const MAX_DEEPSEEK_OUTPUT_TOKENS = 8000;

export function deepseekEndpoint(baseUrl) {
  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '') || DEFAULT_DEEPSEEK_BASE_URL;
  const endpoint = new URL(`${base}/chat/completions`);
  if (endpoint.protocol !== 'https:') {
    throw new AIConfigError('DEEPSEEK_BASE_URL must use HTTPS');
  }
  return endpoint;
}

function readMessageContent(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

export function extractDeepSeekUsage(usage) {
  return {
    promptTokens: Number.isFinite(usage?.prompt_tokens) ? usage.prompt_tokens : 0,
    completionTokens: Number.isFinite(usage?.completion_tokens) ? usage.completion_tokens : 0,
    totalTokens: Number.isFinite(usage?.total_tokens) ? usage.total_tokens : 0,
    reasoningTokens: Number.isFinite(usage?.completion_tokens_details?.reasoning_tokens)
      ? usage.completion_tokens_details.reasoning_tokens
      : (Number.isFinite(usage?.reasoning_tokens) ? usage.reasoning_tokens : 0),
    cacheHitTokens: Number.isFinite(usage?.prompt_cache_hit_tokens) ? usage.prompt_cache_hit_tokens : 0,
    cacheMissTokens: Number.isFinite(usage?.prompt_cache_miss_tokens) ? usage.prompt_cache_miss_tokens : 0,
  };
}

function createRequestBody({ model, messages, temperature, maxTokens, thinkingParam, responseFormat }) {
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
  if (responseFormat !== 'none') {
    body.response_format = { type: 'json_object' };
  }
  if (thinkingParam === 'reasoning_effort') {
    body.reasoning_effort = 'none';
  } else if (thinkingParam !== 'none') {
    body.thinking = { type: 'disabled' };
  }
  return body;
}

async function readUpstreamError(upstream) {
  try {
    const body = await upstream.json();
    const message = body?.error?.message ?? body?.message ?? '';
    return typeof message === 'string'
      ? message.replace(/\s+/g, ' ').trim().slice(0, 200)
      : '';
  } catch (_) {
    return '';
  }
}

export async function callDeepSeek({
  endpoint,
  apiKey,
  model,
  messages,
  temperature,
  maxTokens,
  timeoutMs = DEFAULT_DEEPSEEK_TIMEOUT_MS,
  thinkingParam = 'thinking',
  responseFormat = 'json_object',
  signal,
}) {
  const controller = new AbortController();
  const relay = () => controller.abort();
  signal?.addEventListener('abort', relay, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(createRequestBody({ model, messages, temperature, maxTokens, thinkingParam, responseFormat })),
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) throw new AITimeoutError(`DeepSeek timed out after ${timeoutMs}ms`);
    if (signal?.aborted) throw error;
    throw new AIProviderError('DeepSeek request failed', { retryable: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }

  if (!upstream.ok) {
    const detail = await readUpstreamError(upstream);
    throw providerHttpError('DeepSeek', upstream.status, detail);
  }

  let data;
  try {
    data = await upstream.json();
  } catch (_) {
    throw new InvalidAIResponseError('DeepSeek returned invalid JSON');
  }

  const content = readMessageContent(data?.choices?.[0]?.message);
  if (!content.trim()) {
    throw new InvalidAIResponseError('DeepSeek returned an empty response');
  }

  return {
    content: content.trim(),
    model: typeof data?.model === 'string' ? data.model : null,
    usage: extractDeepSeekUsage(data?.usage),
  };
}
