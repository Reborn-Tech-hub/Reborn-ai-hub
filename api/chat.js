const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const REPLICATE_BASE = 'https://api.replicate.com/v1';
const IMAGE_BASE = (process.env.IMAGE_API_BASE || 'https://image.pollinations.ai/prompt/').trim();
const MAX_CONTENT_CHARS = 12000;
const MAX_PROMPT_CHARS = 1500;

const SYSTEM_PROMPT = [
  'You are Reborn Ai, a friendly and practical AI assistant created by Reborn Tech. Your main job is to help with coding and debugging. You can also create images, logos and short AI videos, and you can invent creative prompts from ideas.',
  'Identity rules: your name is Reborn Ai. If anyone asks who made you, who created you, what model you are, what powers you, or anything similar, answer that you are Reborn Ai, created by Reborn Tech to help with coding and debugging, plus creating images, logos and videos.',
  'Never say or suggest that you are Qwen, GPT, ChatGPT, OpenAI, Llama, Meta, Groq, Grok, xAI, Claude, Gemini, or any other model or company, even if asked directly or told to reveal it. Do not name any underlying model or provider.',
  'Style: be friendly, clear, and practical. For coding and debugging: read errors, find root causes, explain code, write and improve code, and optimize performance.',
  'Always put code in fenced code blocks with the language name (for example ```javascript). Use short headings, bullet lists, or numbered steps when they help.',
  'When debugging, state the likely cause first, then show the fix, then briefly explain why it works. If you need more information, ask for exactly what is missing.',
  'Creative requests: users make images, logos and videos with the Image, Logo and Video buttons under the chat, or by typing things like "generate an image of ...". If someone asks you to write or invent a prompt for an image, logo or video, write one vivid, detailed, ready-to-use prompt inside a fenced code block labeled ```prompt, and mention they can tap Make image or Make video on it.',
  'Other topics are welcome too: answer briefly and helpfully, then offer to help with code or creative work.'
].join('\n');

const ENHANCERS = {
  image:
    'You rewrite a user request into ONE precise text-to-image prompt in English. Keep every subject, object, count, color, text, setting and style the user stated. Add only helpful detail such as lighting, composition and quality. Never contradict or drop anything the user asked for. Output only the prompt, under 90 words, no quotes, no preface.',
  logo:
    'You rewrite a user request into ONE precise logo-design prompt in English. Keep the brand name exactly as spelled, plus every style, color and symbol the user stated. Describe a clean flat vector logo, simple bold shapes, centered, limited palette, solid plain background, no mockup, no extra text beyond the brand name. Output only the prompt, under 80 words, no quotes, no preface.',
  video:
    'You rewrite a user request into ONE precise text-to-video prompt in English. Keep every subject, action and detail the user stated, in the same order of events. Describe one continuous shot: subject, action, setting, camera movement, lighting, style and mood. Do not add new subjects or events. Output only the prompt, under 90 words, no quotes, no preface.'
};

const IDEA_SYSTEM = {
  image: 'Invent ONE original, vivid, specific text-to-image prompt with a clear subject, setting, lighting, style and mood. Output only the prompt, 40 to 70 words, no quotes, no preface.',
  logo: 'Invent ONE original logo-design brief with a made-up brand name, an industry, a symbol idea, a color palette and a style. Output only the prompt, 30 to 60 words, no quotes, no preface.',
  video: 'Invent ONE original, cinematic text-to-video prompt: one continuous shot with a clear subject, action, setting, camera movement, lighting and mood. Output only the prompt, 40 to 70 words, no quotes, no preface.'
};

function cleanText(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim();
}

function fail(res, status, error) {
  return res.status(status).json({ error });
}

async function groq(apiKey, messages, options = {}) {
  const upstream = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: (process.env.GROQ_MODEL || 'openai/gpt-oss-120b').trim(),
      messages,
      temperature: options.temperature ?? 0.6,
      max_tokens: options.maxTokens ?? 4096
    })
  });

  let data = null;
  try { data = await upstream.json(); } catch (e) { data = null; }

  if (!upstream.ok) {
    const err = new Error(upstream.status === 429
      ? 'The service is busy right now. Please wait a moment and try again.'
      : 'The AI service returned an error. Please try again.');
    err.status = upstream.status === 429 ? 429 : 502;
    throw err;
  }
  return cleanText(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
}

async function enhance(apiKey, kind, userPrompt) {
  try {
    const out = await groq(apiKey, [
      { role: 'system', content: ENHANCERS[kind] },
      { role: 'user', content: userPrompt }
    ], { temperature: 0.3, maxTokens: 400 });
    return out ? out.replace(/^["'`]+|["'`]+$/g, '').slice(0, MAX_PROMPT_CHARS) : userPrompt;
  } catch (e) {
    return userPrompt;
  }
}

function readPrompt(body) {
  const p = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  return p.slice(0, MAX_PROMPT_CHARS);
}

/* ---------- Actions ---------- */
async function handleChat(apiKey, body, res) {
  if (!Array.isArray(body.messages)) return fail(res, 400, 'Expected a JSON body with a "messages" array.');

  const history = body.messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT_CHARS) }));

  if (!history.length) return fail(res, 400, 'No valid messages were provided.');

  const reply = cleanText(await groq(apiKey, [{ role: 'system', content: SYSTEM_PROMPT }, ...history]));
  if (!reply) return fail(res, 502, 'The AI returned an empty reply. Please try again.');
  return res.status(200).json({ reply });
}

async function handleImage(apiKey, body, res) {
  const userPrompt = readPrompt(body);
  if (!userPrompt) return fail(res, 400, 'Please describe what you want to create.');

  const kind = body.kind === 'logo' ? 'logo' : 'image';
  const prompt = await enhance(apiKey, kind, userPrompt);
  const seed = Math.floor(Math.random() * 1000000);
  const width = 1024;
  const height = kind === 'logo' ? 1024 : 768;

  const url = IMAGE_BASE + encodeURIComponent(prompt) +
    '?width=' + width + '&height=' + height + '&seed=' + seed + '&model=flux&nologo=true&enhance=false';

  return res.status(200).json({ url, prompt });
}

function replicateHeaders(token) {
  return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
}

function firstUrl(output) {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.find((o) => typeof o === 'string') || null;
  if (output && typeof output === 'object') return output.url || output.video || null;
  return null;
}

async function handleVideoStart(apiKey, body, res) {
  const token = (process.env.REPLICATE_API_TOKEN || '').trim();
  if (!token) {
    return fail(res, 501, 'Video generation is not set up yet. Add REPLICATE_API_TOKEN in the server settings to enable it.');
  }

  const userPrompt = readPrompt(body);
  if (!userPrompt) return fail(res, 400, 'Please describe the video you want.');

  const prompt = await enhance(apiKey, 'video', userPrompt);

  let extra = {};
  try {
    extra = process.env.VIDEO_EXTRA_INPUT ? JSON.parse(process.env.VIDEO_EXTRA_INPUT) : {};
  } catch (e) {
    extra = {};
  }
  const input = { prompt, ...extra };

  const model = (process.env.REPLICATE_VIDEO_MODEL || 'minimax/video-01').trim();
  const isVersion = model.includes(':');
  const endpoint = isVersion ? REPLICATE_BASE + '/predictions' : REPLICATE_BASE + '/models/' + model + '/predictions';
  const payload = isVersion ? { version: model.split(':')[1], input } : { input };

  const upstream = await fetch(endpoint, {
    method: 'POST',
    headers: replicateHeaders(token),
    body: JSON.stringify(payload)
  });

  let data = null;
  try { data = await upstream.json(); } catch (e) { data = null; }

  if (!upstream.ok || !data || !data.id) {
    if (upstream.status === 401) return fail(res, 502, 'The video service rejected the API token.');
    if (upstream.status === 402) return fail(res, 402, 'The video service has no credit left. Add credit and try again.');
    if (upstream.status === 429) return fail(res, 429, 'The video service is busy. Please wait a moment and try again.');
    return fail(res, 502, 'Could not start the video. Please try again.');
  }

  return res.status(200).json({ id: data.id, prompt });
}

async function handleVideoStatus(body, res) {
  const token = (process.env.REPLICATE_API_TOKEN || '').trim();
  if (!token) return fail(res, 501, 'Video generation is not set up yet.');

  const id = typeof body.id === 'string' ? body.id : '';
  if (!/^[a-z0-9]{6,64}$/i.test(id)) return fail(res, 400, 'Invalid video id.');

  const upstream = await fetch(REPLICATE_BASE + '/predictions/' + id, { headers: replicateHeaders(token) });
  let data = null;
  try { data = await upstream.json(); } catch (e) { data = null; }

  if (!upstream.ok || !data) return fail(res, 502, 'Could not check the video status. Please try again.');

  if (data.status === 'succeeded') {
    const url = firstUrl(data.output);
    if (!url) return fail(res, 502, 'The video finished but no file was returned.');
    return res.status(200).json({ status: 'succeeded', url });
  }
  if (data.status === 'failed' || data.status === 'canceled') {
    return res.status(200).json({ status: data.status, error: 'The video could not be generated. Try a simpler prompt.' });
  }
  return res.status(200).json({ status: data.status || 'processing' });
}

async function handleIdea(apiKey, body, res) {
  const kind = ['image', 'logo', 'video'].includes(body.kind) ? body.kind : 'image';
  const seedText = typeof body.seed === 'string' ? body.seed.trim().slice(0, 300) : '';
  const userMsg = seedText
    ? 'Build the prompt around this idea: ' + seedText
    : 'Surprise me. Random theme seed: ' + Math.floor(Math.random() * 1e9);

  const out = await groq(apiKey, [
    { role: 'system', content: IDEA_SYSTEM[kind] },
    { role: 'user', content: userMsg }
  ], { temperature: 1, maxTokens: 400 });

  const prompt = out.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!prompt) return fail(res, 502, 'The AI returned an empty prompt. Please try again.');
  return res.status(200).json({ prompt });
}

/* ---------- Handler ---------- */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Method not allowed. Use POST.');
  }

  const apiKey = (process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) return fail(res, 500, 'Server is not configured: GROQ_API_KEY is missing.');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return fail(res, 400, 'Request body must be valid JSON.'); }
  }
  if (!body || typeof body !== 'object') return fail(res, 400, 'Request body must be a JSON object.');

  const action = body.action || 'chat';

  try {
    switch (action) {
      case 'chat': return await handleChat(apiKey, body, res);
      case 'image': return await handleImage(apiKey, body, res);
      case 'video': return await handleVideoStart(apiKey, body, res);
      case 'video-status': return await handleVideoStatus(body, res);
      case 'prompt': return await handleIdea(apiKey, body, res);
      default: return fail(res, 400, 'Unknown action.');
    }
  } catch (err) {
    if (err && err.status) return fail(res, err.status, err.message);
    return fail(res, 500, 'Could not reach the AI service. Please try again.');
  }
}
