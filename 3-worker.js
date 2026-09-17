import { needsLiveResearch, buildSearchQuery, searchWeb, isUnknownDatePassportQuery, directAuthoritativeUnknownDateSources, isHotelProximityQuery, filterProximitySources, isHotelRecommendationQuery, filterHotelRecommendationSources } from "./research.js";
// Travel Bot — AI chat backend as a Cloudflare Worker (free tier, no card).
//
// Activation (owner steps, NOT done in this PR): create a free Cloudflare
// account, create a free Google AI Studio API key, then:
//   npx wrangler secret put GEMINI_API_KEY
//   npx wrangler deploy
// The key lives only as a Worker secret — it is never shipped to the browser.
// Static files (the HTML chat) are served by Workers Static Assets from the
// repo root; only POST /api/chat is handled by this Worker.
//
// All chat logic lives in ./chat-core.js, shared verbatim with the Vercel
// mirror (api/chat.js) so the two backends cannot drift apart.

import {
  DEFAULT_MODEL,
  SYSTEM_PROMPT,
  normalizeMessages,
  buildGeminiRequest,
  prepareChat,
  callGemini,
  ensureSalesLayer,
  isPromptInjectionAttempt,
  PROMPT_INJECTION_REPLY,
} from "./chat-core.js";

// Re-exported for the regression tests (tests/chat.test.mjs imports these
// from worker.js — keep this line intact).
export { DEFAULT_MODEL, SYSTEM_PROMPT, normalizeMessages, buildGeminiRequest };

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
  const prepared = prepareChat(body);
  if (prepared.error) return json({ error: prepared.error }, prepared.status);

  if (isPromptInjectionAttempt(prepared.messages)) {
    const reply = ensureSalesLayer(PROMPT_INJECTION_REPLY);
    return json({ reply, researchStatus: "blocked_prompt_injection", sources: [] }, 200);
  }

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  let sources = [];
  let researchStatus = "not_needed";
  if (needsLiveResearch(prepared.messages)) {
    const search = await searchWeb({ query: buildSearchQuery(prepared.messages), apiKey: env.TAVILY_API_KEY });
    if (search.ok) {
      sources = search.sources;
      if (isUnknownDatePassportQuery(prepared.messages)) {
        sources = directAuthoritativeUnknownDateSources(sources);
        if (!sources.length) { return json({ reply: ensureSalesLayer("אין בידי מקור ממשלתי או חברת תעופה שתומך ישירות בכלל 00/00 עבור המקרה הזה. לכן איני יכול לקבוע אם הנוסע יורשה להיכנס. יש לאמת מול רשות האוכלוסין, נציגות איחוד האמירויות וחברת התעופה."), researchStatus: "insufficient_authoritative_evidence", sources: [] }, 200); }
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
    return json(payload, result.status);
  }
  return json({ reply: result.reply, ...(result.truncated ? { truncated: true } : {}), researchStatus, sources: sources.map(({ title, url, sourceType, sourceLabel }) => ({ title, url, sourceType, ...(sourceLabel ? { sourceLabel } : {}) })) }, 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat") return handleChat(request, env);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return json({ error: "not_found" }, 404);
  },
};
