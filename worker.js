// Travel Bot — AI chat backend as a Cloudflare Worker (free tier, no card).
//
// Activation (owner steps, NOT done in this PR): create a free Cloudflare
// account, create a free Google AI Studio API key, then:
//   npx wrangler secret put GEMINI_API_KEY
//   npx wrangler deploy
// The key lives only as a Worker secret — it is never shipped to the browser.
// Static files (the HTML chat) are served by Workers Static Assets from the
// repo root; only POST /api/chat is handled by this Worker.

const DEFAULT_MODEL = "gemini-3.5-flash-lite"; // free-tier model code per Google AI docs
const MAX_HISTORY = 12;      // newest turns kept; older ones dropped
const MAX_MSG_CHARS = 2000;  // per-message cap, guards quota and abuse
const MAX_OUTPUT_TOKENS = 800;

// Hebrew system prompt. Two behaviors are load-bearing for the reported bug:
//  1. Answer the LATEST question specifically — history is context only,
//     never a template to repeat.
//  2. Changing legal/policy facts (conventions, deadlines, compensation
//     amounts) get the general rule plus the official source to verify
//     against — never invented specifics.
export const SYSTEM_PROMPT = `אתה Travel Bot — עוזר ידע מקצועי בעברית לסוכני נסיעות.

כללים מחייבים:
- ענה תמיד על השאלה האחרונה של המשתמש בלבד, באופן ספציפי וישיר. היסטוריית השיחה משמשת הקשר בלבד. לעולם אל תחזור על תשובה קודמת, אל תענה על שאלה קודמת במקום על החדשה, ואל תשלח רשימה כללית כשנשאלה שאלה ספציפית.
- אם השאלה החדשה שונה מהקודמת, התשובה חייבת לגעת בנושא החדש גם אם הוא קשור לקודם.
- עובדות שמשתנות עם הזמן (חוק, אמנות, רגולציה, מדיניות ספק, מועדים, סכומי פיצוי): הצג את הכלל הכללי המקובל, ציין את המקור הרשמי שמולו מאמתים (טקסט אמנת מונטריאול, חוק שירותי תעופה (טיסות), תנאי ההובלה של חברת התעופה, משרד התחבורה/התיירות), וכתוב במפורש שיש לאמת מול המקור העדכני לפני התחייבות ללקוח. אל תמציא סכומים, אחוזים או מועדים מדויקים.
- אל תמציא עובדות. אם אינך יודע, אמור זאת במפורש.
- כתוב בעברית, תמציתי ומקצועי, עד כ-150 מילים אלא אם השאלה דורשת פירוט.`;

// Normalize an arbitrary client-sent history into a safe shape:
// user/assistant roles only, alternating (consecutive same-role messages are
// merged), starting with a user message, capped in count and length.
export function normalizeMessages(input) {
  if (!Array.isArray(input)) return null;
  const clean = [];
  for (const m of input) {
    if (!m || typeof m.content !== "string" || !m.content.trim()) continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = m.content.trim().slice(0, MAX_MSG_CHARS);
    const last = clean[clean.length - 1];
    if (last && last.role === role) last.content += "\n" + content;
    else clean.push({ role, content });
  }
  while (clean.length && clean[0].role !== "user") clean.shift();
  return clean.slice(-MAX_HISTORY);
}

// Gemini generateContent request. Roles map user→user, assistant→model.
export function buildGeminiRequest(messages, model) {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    body: {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.3 },
    },
  };
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function handleChat(request, env) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "ai_not_configured" }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const messages = normalizeMessages(body?.messages);
  if (!messages || messages.length === 0) return json({ error: "bad_messages" }, 400);

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const req = buildGeminiRequest(messages, model);
  let upstream;
  try {
    upstream = await fetch(req.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(req.body),
    });
  } catch {
    return json({ error: "upstream_unreachable" }, 502);
  }
  if (!upstream.ok) {
    // 429 = free-tier daily quota exhausted; the client falls back to the
    // built-in knowledge base, so the chat degrades instead of breaking.
    return json({ error: upstream.status === 429 ? "rate_limited" : "upstream_error", status: upstream.status }, 502);
  }

  const data = await upstream.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const reply = parts
    .filter((p) => typeof p?.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
  if (!reply) return json({ error: "empty_upstream" }, 502);
  return json({ reply }, 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat") return handleChat(request, env);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return json({ error: "not_found" }, 404);
  },
};
