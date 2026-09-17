// Provider-neutral live web research for Travel Bot.
// Default: Tavily keyless mode (free, rate-limited, no account or secret).
// Optional: TAVILY_API_KEY raises the limit; it must remain a server-side secret.

export const SEARCH_ENDPOINT = "https://api.tavily.com/search";
export const MAX_SEARCH_RESULTS = 6;
export const SEARCH_TIMEOUT_MS = 9000;

const LIVE_PATTERNS = [
  /כשר|kosher|חב["״'׳]?ד|chabad|בורג[׳'״]? חליפה|burj khalifa|מלונ(?:ות|י|ון) (?:ליד|קרוב|בסביבת)|hotel(?:s)? (?:near|close to)/i,
  /ביקור(?:ו|וֹ)?ת|review|מתקנ|facility|מטבח|kitchen|בריכה|pool/i,
  /צ[׳']ק[ -]?אין|check[ -]?in/i,
  /דרכון|כניסה ל|ויזה|passport|entry requirement|visa|תוקף/i,
  /מחיר|זמינות|availability|price|מדיניות|policy|עדכני|כיום|עכשיו/i,
];

export function needsLiveResearch(messages) {
  const latest = [...(messages || [])].reverse().find((m) => m?.role === "user")?.content || "";
  return LIVE_PATTERNS.some((pattern) => pattern.test(latest));
}

export function latestQuestion(messages) {
  return [...(messages || [])].reverse().find((m) => m?.role === "user")?.content?.trim() || "";
}

export function buildSearchQuery(messages) {
  const question = latestQuestion(messages);
  return `${question}\nהעדף מקורות רשמיים ועדכניים; למלון: אתר המלון ומקור כשרות מוסמך; לכניסה: רשות הגירה/שגרירות; לחברת תעופה: אתר החברה.`;
}

const SOCIAL_DOMAINS = new Set(["facebook.com", "www.facebook.com", "instagram.com", "www.instagram.com", "tiktok.com", "www.tiktok.com"]);
const OTA_DOMAINS = new Set(["booking.com", "www.booking.com", "agoda.com", "www.agoda.com", "expedia.com", "www.expedia.com", "tripadvisor.com", "www.tripadvisor.com", "trivago.com", "www.trivago.com", "destinia.com", "www.destinia.com"]);
const MAP_DOMAINS = new Set(["maps.google.com", "maps.apple.com", "www.openstreetmap.org"]);
const REVIEW_DOMAINS = new Set(["tripadvisor.co.il", "www.tripadvisor.co.il", "telegraph.co.uk", "www.telegraph.co.uk"]);

export function classifySource(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (MAP_DOMAINS.has(host) || (host.endsWith(".google.com") && new URL(url).pathname.includes("/maps"))) return "maps";
  if (SOCIAL_DOMAINS.has(host)) return "social";
  if (OTA_DOMAINS.has(host)) return "ota";
  if (REVIEW_DOMAINS.has(host)) return "review";
  if (host.endsWith(".gov") || host.endsWith(".gov.il") || host.endsWith(".gov.ae") || host === "gov.il") return "government";
  if (/^(www\.)?(elal|emirates|etihad|flydubai|arkia)\./.test(host)) return "airline";
  if (host.includes("chabad")) return "community_official";
  return "other";
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

export function normalizeSources(results) {
  if (!Array.isArray(results)) return [];
  const seen = new Set();
  const sources = [];
  for (const item of results) {
    const url = safeUrl(item?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({
      title: typeof item?.title === "string" ? item.title.trim().slice(0, 240) : new URL(url).hostname,
      url,
      sourceType: classifySource(url),
      content: typeof item?.content === "string" ? item.content.trim().slice(0, 3500) : "",
    });
    if (sources.length >= MAX_SEARCH_RESULTS) break;
  }
  return sources;
}

export async function searchWeb({ query, apiKey, fetchImpl, timeoutMs = SEARCH_TIMEOUT_MS }) {
  const doFetch = fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { "content-type": "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    else headers["X-Tavily-Access-Mode"] = "keyless";
    const response = await doFetch(SEARCH_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, search_depth: "advanced", max_results: MAX_SEARCH_RESULTS, include_answer: false }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: response.status === 429 ? "search_rate_limited" : "search_upstream_error", status: response.status };
    const data = await response.json();
    const sources = normalizeSources(data?.results);
    if (!sources.length) return { ok: false, error: "search_empty" };
    return { ok: true, sources };
  } catch {
    return { ok: false, error: "search_unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export function isUnknownDatePassportQuery(messages) {
  const q = latestQuestion(messages);
  return /(?:דרכון|passport)/i.test(q) && /(?:00[\/.-]?00|000|תאריך[^\n]{0,30}00)/i.test(q);
}

export function directAuthoritativeUnknownDateSources(sources) {
  const exactRule = /(?:00[\/.-]00|00[\/.-]00[\/.-](?:0000|\d{4})|date of birth[^.\n]{0,80}(?:00|unknown)|unknown (?:day|month|date)[^.\n]{0,80}(?:passport|birth)|(?:יום|חודש)[^.\n]{0,80}(?:00|לא ידוע))/i;
  const destination = /(?:איחוד האמירויות|דובאי|UAE|United Arab Emirates|Dubai)/i;
  return sources.filter((source) => ["government", "airline"].includes(source.sourceType) && exactRule.test(source.content) && destination.test(source.content));
}
export function hasDirectAuthoritativeUnknownDateEvidence(sources) { return directAuthoritativeUnknownDateSources(sources).length > 0; }
export function isHotelProximityQuery(messages) {
  const q = latestQuestion(messages);
  return /(?:מלון|מלונות|מלוני|hotel)/i.test(q) && /(?:ליד|קרוב|בסביבת|מרחק|near|close|distance|walking|בורג[׳'״]? חליפה|burj khalifa)/i.test(q);
}
export function inferLodgingType(source) {
  const text = (source.title || "") + " " + (source.content || "");
  if (/holiday home|דירת נופש/i.test(text)) return "holiday_home";
  if (/serviced apartment|דירת שירות/i.test(text)) return "serviced_apartment";
  if (/residen(?:ce|tial)|מגורים|רזידנס/i.test(text)) return "residence";
  if (/hotel|מלון/i.test(text)) return "hotel";
  return "unspecified";
}
export function filterProximitySources(sources) {
  return sources.filter((source) => !["ota", "social", "review"].includes(source.sourceType)).map((source) => {
    const lodgingType = inferLodgingType(source);
    if (source.sourceType === "maps") return { ...source, lodgingType };
    const content = source.content.replace(/[^.\n]*(?:\d+(?:[.,]\d+)?\s*(?:m|km|meters?|metres?|yards?|מטר(?:ים)?|ק[״"]?מ)|\d+\s*(?:minutes?|דקות?)\s*(?:walk|walking|הליכה))[^.\n]*[.\n]?/gi, "").trim();
    return { ...source, content, lodgingType };
  }).filter((source) => source.content || source.sourceType === "maps");
}

export function sourceContext(sources) {
  return sources.map((s, i) => `[${i + 1}] ${s.title}\nסוג מקור: ${s.sourceType || classifySource(s.url)}${s.lodgingType ? `\nסוג לינה: ${s.lodgingType}` : ""}\nURL: ${s.url}\nקטע מקור: ${s.content || "(ללא קטע טקסט)"}`).join("\n\n");
}
