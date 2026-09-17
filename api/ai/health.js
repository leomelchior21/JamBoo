import { createQuizProvider } from '../ai-provider.mjs';

const OLLAMA_MODEL = process.env.OLLAMA_MODEL?.trim() || 'qwen3.5:4b';
const configuredTimeout = Number.parseInt(process.env.OLLAMA_HEALTH_TIMEOUT_MS, 10);
const HEALTH_TIMEOUT_MS = Number.isInteger(configuredTimeout) && configuredTimeout >= 1000 && configuredTimeout <= 10000
  ? configuredTimeout
  : 5000;

function providerStatus() {
  try {
    const provider = createQuizProvider();
    return { provider: provider.name, aiReady: provider.configured };
  } catch (_) {
    return { provider: null, aiReady: false };
  }
}

function getTagsEndpoint() {
  const baseUrl = process.env.OLLAMA_URL?.trim().replace(/\/+$/, '');
  if (!baseUrl) return null;

  const endpoint = new URL(`${baseUrl}/api/tags`);
  if (endpoint.protocol !== 'https:') {
    throw new Error('OLLAMA_URL must use HTTPS');
  }
  return endpoint;
}

export default async function handler(req, res) {
  res.setHeader('Allow', 'GET');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const status = providerStatus();

  let tagsUrl;
  try {
    tagsUrl = getTagsEndpoint();
  } catch (_) {
    console.error('Invalid OLLAMA_URL configuration');
    return res.status(200).json({ online: false, ollama: false, model: OLLAMA_MODEL, ready: false, ...status });
  }
  if (!tagsUrl) {
    console.error('OLLAMA_URL is not configured');
    return res.status(200).json({ online: false, ollama: false, model: OLLAMA_MODEL, ready: false, ...status });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const upstream = await fetch(tagsUrl, {
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!upstream.ok) {
      return res.status(200).json({ online: false, ollama: false, model: OLLAMA_MODEL, ready: false, ...status });
    }

    const data = await upstream.json();
    const hasModel = Array.isArray(data?.models) && data.models.some(model =>
      model?.name === OLLAMA_MODEL || model?.model === OLLAMA_MODEL
    );

    return res.status(200).json({
      online: true,
      ollama: true,
      model: OLLAMA_MODEL,
      ready: hasModel,
      ...status,
    });
  } catch (_) {
    console.error('Ollama health check failed');
    return res.status(200).json({ online: false, ollama: false, model: OLLAMA_MODEL, ready: false, ...status });
  } finally {
    clearTimeout(timeout);
  }
}
