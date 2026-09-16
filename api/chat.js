// Travel Bot — AI chat endpoint (serverless function, e.g. Vercel Node runtime).
//
// This file is NEW in this branch and is NOT reachable from the live GitHub
// Pages site (Pages is static-only). It becomes active only if the owner
// deploys it to a host that runs serverless functions AND sets
// ANTHROPIC_API_KEY. Both choices (hosting + paid provider credential) are
// pending owner approval — see the PR body.

const DEFAULT_MODEL = "claude-sonnet-4-5";
const MAX_HISTORY = 12;      // newest turns kept; older ones dropped
const MAX_MSG_CHARS = 2000;  // per-message cap, guards cost and abuse
const MAX_TOKENS = 800;

// Hebrew system prompt. Two behaviors are load-bearing for the reported bug:
//  1. The model must answer the LATEST question specifically — history is
//     context only, never a template to repeat.
//  2. Changing legal/policy facts (conventions, deadlines, compensation
//     amounts) are answered with the general rule plus the official source
//     to verify against — never invented specifics.
export const SYSTEM_PROMPT = `אתה Travel Bot — עוזר ידע מקצועי בעברית לסוכני נסיעות.

כללים מחייבים:
- ענה תמיד על השאלה האחרונה של המשתמש בלבד, באופן ספציפי וישיר. היסטוריית השיחה משמשת הקשר בלבד. לעולם אל תחזור על תשובה קודמת, אל תענה על שאלה קודמת במקום על החדשה, ואל תשלח רשימה כללית כשנשאלה שאלה ספציפית.
- אם השאלה החדשה שונה מהקודמת, התשובה חייבת לגעת בנושא החדש גם אם הוא קשור לקודם.
- עובדות שמשתנות עם הזמן (חוק, אמנות, רגולציה, מדיניות ספק, מועדים, סכומי פיצוי): הצג את הכלל הכללי המקובל, ציין את המקור הרשמי שמולו מאמתים (טקסט אמנת מונטריאול, חוק שירותי תעופה (טיסות), תנאי ההובלה של חברת התעופה, משרד התחבורה/התיירות), וכתוב במפורש שיש לאמת מול המקור העדכני לפני התחייבות ללקוח. אל תמציא סכומים, אחוזים או מועדים מדויקים.
- אל תמציא עובדות. אם אינך יודע, אמור זאת במפורש.
- כתוב בעברית, תמציתי ומקצועי, עד כ-150 מילים אלא אם השאלה דורשת פירוט.`;

// Normalize an arbitrary client-sent history into a shape the API accepts:
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

export function buildRequest(messages, model) {
  return { model, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, messages };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "ai_not_configured" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "bad_json" }); }
  }
  const messages = normalizeMessages(body?.messages);
  if (!messages || messages.length === 0) return res.status(400).json({ error: "bad_messages" });

  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(buildRequest(messages, model)),
    });
  } catch {
    return res.status(502).json({ error: "upstream_unreachable" });
  }
  if (!upstream.ok) return res.status(502).json({ error: "upstream_error", status: upstream.status });

  const data = await upstream.json();
  const reply = (data?.content || [])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!reply) return res.status(502).json({ error: "empty_upstream" });
  return res.status(200).json({ reply });
}
