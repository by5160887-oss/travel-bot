import { needsLiveResearch, buildSearchQuery, searchWeb } from "../research.js";
// Vercel serverless mirror of worker.js (Cloudflare Worker) — Travel Bot AI chat backend.
// Same contract: POST /api/chat {messages:[...]} -> {reply} (plus truncated:true
// when the model hit its output cap). The Gemini key stays server-side as the
// GEMINI_API_KEY environment variable; it never reaches the browser.
//
// All chat logic lives in ../chat-core.js, shared verbatim with the Cloudflare
// Worker so the two backends cannot drift apart.

import { DEFAULT_MODEL, prepareChat, callGemini } from "../chat-core.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "ai_not_configured" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "bad_json" }); }
  }
  const prepared = prepareChat(body);
  if (prepared.error) return res.status(prepared.status).json({ error: prepared.error });

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  let sources = [];
  let researchStatus = "not_needed";
  if (needsLiveResearch(prepared.messages)) {
    const search = await searchWeb({ query: buildSearchQuery(prepared.messages), apiKey: process.env.TAVILY_API_KEY });
    if (search.ok) { sources = search.sources; researchStatus = "live"; }
    else researchStatus = search.error;
  }
  const result = await callGemini({ apiKey, model, messages: prepared.messages, sources });
  if (!result.ok) {
    const payload = { error: result.error };
    if (result.upstreamStatus) payload.status = result.upstreamStatus;
    return res.status(result.status).json(payload);
  }
  return res.status(200).json({ reply: result.reply, ...(result.truncated ? { truncated: true } : {}), researchStatus, sources: sources.map(({ title, url }) => ({ title, url })) });
}
