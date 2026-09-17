// Vercel serverless mirror of worker.js (Cloudflare Worker) — Travel Bot AI chat backend.
// Same contract: POST /api/chat {messages:[...]} -> {reply}. The Gemini key stays
// server-side as the GEMINI_API_KEY environment variable; it never reaches the browser.

const DEFAULT_MODEL = "gemini-3.5-flash-lite"; // free-tier model code per Google AI docs
const MAX_HISTORY = 12;      // newest turns kept; older ones dropped
const MAX_MSG_CHARS = 2000;  // per-message cap, guards quota and abuse
const MAX_OUTPUT_TOKENS = 800;

// Same Hebrew system prompt as worker.js: answer the LATEST question
// specifically; changing legal/policy facts get the general rule plus the
// official source to verify against; never invent specifics.
const SYSTEM_PROMPT = `אתה Travel Bot — עוזר ידע מקצועי בעברית לסוכני נסיעות.

כללים מחייבים:
- ענה תמיד על השאלה האחרונה של המשתמש בלבד, באופן ספציפי וישיר. היסטוריית השיחה משמשת הקשר בלבד. לעולם אל תחזור על תשובה קודמת, אל תענה על שאלה קודמת במקום על החדשה, ואל תשלח רשימה כללית כשנשאלה שאלה ספציפית.
- אם השאלה החדשה שונה מהקודמת, התשובה חייבת לגעת בנושא החדש גם אם הוא קשור לקודם.
- עובדות שמשתנות עם הזמן (חוק, אמנות, רגולציה, מדיניות ספק, מועדים, סכומי פיצוי): הצג את הכלל הכללי המקובל, ציין את המקור הרשמי שמולו מאמתים (טקסט אמנת מונטריאול, חוק שירותי תעופה (טיסות), תנאי ההובלה של חברת התעופה, משרד התחבורה/התיירות), וכתוב במפורש שיש לאמת מול המקור העדכני לפני התחייבות ללקוח. אל תמציא סכומים, אחוזים או מועדים מדויקים.
- אל תמציא עובדות. אם אינך יודע, אמור זאת במפורש.
- כתוב בעברית, תמציתי ומקצועי, עד כ-150 מילים אלא אם השאלה דורשת פירוט.`;

function normalizeMessages(input) {
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

function buildGeminiRequest(messages, model) {
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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "ai_not_configured" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "bad_json" }); }
  }
  const messages = normalizeMessages(body?.messages);
  if (!messages || messages.length === 0) return res.status(400).json({ error: "bad_messages" });

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const greq = buildGeminiRequest(messages, model);
  let upstream;
  try {
    upstream = await fetch(greq.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(greq.body),
    });
  } catch {
    return res.status(502).json({ error: "upstream_unreachable" });
  }
  if (!upstream.ok) {
    // 429 = free-tier daily quota exhausted; the client falls back to the
    // built-in knowledge base, so the chat degrades instead of breaking.
    return res.status(502).json({ error: upstream.status === 429 ? "rate_limited" : "upstream_error", status: upstream.status });
  }

  const data = await upstream.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const reply = parts
    .filter((p) => typeof p?.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
  if (!reply) return res.status(502).json({ error: "empty_upstream" });
  return res.status(200).json({ reply });
}
