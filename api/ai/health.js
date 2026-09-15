const OLLAMA_MODEL = 'qwen3.5:4b';
const HEALTH_TIMEOUT_MS = 5000;

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

  let tagsUrl;
  try {
    tagsUrl = getTagsEndpoint();
  } catch (_) {
    console.error('Invalid OLLAMA_URL configuration');
    return res.status(200).json({ online: false });
  }
  if (!tagsUrl) {
    console.error('OLLAMA_URL is not configured');
    return res.status(200).json({ online: false });
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
    if (!upstream.ok) return res.status(200).json({ online: false });

    const data = await upstream.json();
    const hasModel = Array.isArray(data?.models) && data.models.some(model =>
      model?.name === OLLAMA_MODEL || model?.model === OLLAMA_MODEL
    );

    return hasModel
      ? res.status(200).json({ online: true, model: OLLAMA_MODEL })
      : res.status(200).json({ online: false });
  } catch (_) {
    console.error('Ollama health check failed');
    return res.status(200).json({ online: false });
  } finally {
    clearTimeout(timeout);
  }
}
