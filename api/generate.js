export default async function handler(req, res) {
  // CORS headers (needed if you ever call from a different origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured in environment variables.' });
  }

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body: messages array required.' });
  }

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0.7,
        messages,
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      const message =
        data?.error?.message ||
        data?.message ||
        (typeof data?.error === 'string' ? data.error : 'Groq API error');

      return res.status(upstream.status).json({
        error: message,
        status: upstream.status,
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('generate.js error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
