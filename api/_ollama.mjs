import { AIConfigError, AIProviderError, InvalidAIResponseError, providerHttpError } from './_ai-errors.mjs';

const DEFAULT_NUM_CTX = 4096;

export function getOllamaEndpoint(pathname, env = process.env) {
  const baseUrl = env.OLLAMA_URL?.trim().replace(/\/+$/, '');
  if (!baseUrl) return null;

  const endpoint = new URL(`${baseUrl}${pathname}`);
  if (endpoint.protocol !== 'https:') {
    throw new AIConfigError('OLLAMA_URL must use HTTPS');
  }
  return endpoint;
}

export function extractOllamaUsage(data) {
  const promptTokens = Number.isFinite(data?.prompt_eval_count) ? data.prompt_eval_count : 0;
  const completionTokens = Number.isFinite(data?.eval_count) ? data.eval_count : 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    reasoningTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
  };
}

export async function callOllama({
  chatUrl,
  model,
  messages,
  format,
  temperature = 0.6,
  maxTokens = 500,
  seed,
  signal,
}) {
  const request = {
    model,
    messages,
    stream: false,
    think: false,
    keep_alive: '30m',
    options: {
      num_ctx: DEFAULT_NUM_CTX,
      num_predict: maxTokens,
      temperature,
      top_p: 0.92,
      repeat_penalty: 1.08,
    },
  };
  if (Number.isInteger(seed)) request.options.seed = seed;
  if (format) request.format = format;

  let upstream;
  try {
    upstream = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AIProviderError('Ollama request failed', { retryable: true });
  }

  if (!upstream.ok) {
    console.error(`Ollama returned HTTP ${upstream.status}`);
    throw providerHttpError('Ollama', upstream.status);
  }

  let data;
  try {
    data = await upstream.json();
  } catch (_) {
    throw new InvalidAIResponseError('Ollama returned invalid JSON');
  }

  const content = data?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new InvalidAIResponseError('AI returned an empty response');
  }

  return {
    content: content.trim(),
    model: typeof data?.model === 'string' ? data.model : null,
    usage: extractOllamaUsage(data),
  };
}
