const OLLAMA_MODEL = process.env.OLLAMA_MODEL?.trim() || 'qwen3.5:4b';

export class InvalidAIResponseError extends Error {}
export class OllamaResponseError extends Error {}

export function readBoundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function getOllamaEndpoint(pathname) {
  const baseUrl = process.env.OLLAMA_URL?.trim().replace(/\/+$/, '');
  if (!baseUrl) return null;

  const endpoint = new URL(`${baseUrl}${pathname}`);
  if (endpoint.protocol !== 'https:') {
    throw new Error('OLLAMA_URL must use HTTPS');
  }
  return endpoint;
}

export async function requestOllama(chatUrl, messages, {
  format,
  signal,
  numPredict = 500,
  temperature = 0.6,
  topP = 0.92,
  seed,
} = {}) {
  const request = {
    model: OLLAMA_MODEL,
    messages,
    stream: false,
    think: false,
    keep_alive: '30m',
    options: {
      num_ctx: 4096,
      num_predict: numPredict,
      temperature,
      top_p: topP,
      repeat_penalty: 1.08,
    },
  };
  if (Number.isInteger(seed)) request.options.seed = seed;
  if (format) request.format = format;

  const upstream = await fetch(chatUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(request),
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
