import { needsLiveResearch, buildSearchQuery, searchWeb, isUnknownDatePassportQuery, directAuthoritativeUnknownDateSources, isHotelProximityQuery, filterProximitySources, isHotelRecommendationQuery, filterHotelRecommendationSources } from "../research.js";

function answerBasis(researchStatus, sources = []) {
  if (sources.some((source) => ["owner_travelor", "travelor"].includes(source.sourceType))) return "travelor";
  if (sources.length) return "internet";
  if (researchStatus === "not_needed") return "knowledge";
  return "safety";
}
// Vercel serverless mirror of worker.js (Cloudflare Worker) — Travel Bot AI chat backend.
// Same contract: POST /api/chat {messages:[...]} -> {reply} (plus truncated:true
// when the model hit its output cap). The Gemini key stays server-side as the
// GEMINI_API_KEY environment variable; it never reaches the browser.
//
// All chat logic lives in ../chat-core.js, shared verbatim with the Cloudflare
// Worker so the two backends cannot drift apart.

import { DEFAULT_MODEL, prepareChat, callGemini, ensureSalesLayer, isPromptInjectionAttempt, PROMPT_INJECTION_REPLY } from "../chat-core.js";

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

  if (isPromptInjectionAttempt(prepared.messages)) {
    const reply = ensureSalesLayer(PROMPT_INJECTION_REPLY);
    return res.status(200).json({ reply, researchStatus: "blocked_prompt_injection", basis: "safety", sources: [] });
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  let sources = [];
  let researchStatus = "not_needed";
  if (needsLiveResearch(prepared.messages)) {
    const search = await searchWeb({ query: buildSearchQuery(prepared.messages), apiKey: process.env.TAVILY_API_KEY });
    if (search.ok) {
      sources = search.sources;
      if (isUnknownDatePassportQuery(prepared.messages)) {
        sources = directAuthoritativeUnknownDateSources(sources);
        if (!sources.length) { return res.status(200).json({ reply: ensureSalesLayer("אין בידי מקור ממשלתי או חברת תעופה שתומך ישירות בכלל 00/00 עבור המקרה הזה. לכן איני יכול לקבוע אם הנוסע יורשה להיכנס. יש לאמת מול רשות האוכלוסין, נציגות איחוד האמירויות וחברת התעופה."), researchStatus: "insufficient_authoritative_evidence", basis: "safety", sources: [] }); }
      }
      if (isHotelRecommendationQuery(prepared.messages)) sources = filterHotelRecommendationSources(sources, prepared.messages);
      if (isHotelProximityQuery(prepared.messages)) {
        sources = filterProximitySources(sources);
        researchStatus = sources.length ? "live_proximity_without_unverified_distance" : "insufficient_location_evidence";
      } else researchStatus = "live";
    } else researchStatus = search.error;
  }
  const result = await callGemini({ apiKey, model, messages: prepared.messages, sources });
  if (!result.ok) {
    const payload = { error: result.error };
    if (result.upstreamStatus) payload.status = result.upstreamStatus;
    return res.status(result.status).json(payload);
  }
  return res.status(200).json({ reply: result.reply, ...(result.truncated ? { truncated: true } : {}), researchStatus, basis: answerBasis(researchStatus, sources), sources: sources.map(({ title, url, sourceType, sourceLabel }) => ({ title, url, sourceType, ...(sourceLabel ? { sourceLabel } : {}) })) });
}
