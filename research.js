// Provider-neutral live web research for Travel Bot.
// Default: Tavily keyless mode (free, rate-limited, no account or secret).
// Optional: TAVILY_API_KEY raises the limit; it must remain a server-side secret.

export const SEARCH_ENDPOINT = "https://api.tavily.com/search";
export const MAX_SEARCH_RESULTS = 6;
export const SEARCH_TIMEOUT_MS = 9000;
export const OWNER_TRAVELOR_URL = "https://www.travelor.com/he?fid=84016";

const LIVE_PATTERNS = [
  /כשר|kosher|חב["״'׳]?ד|chabad|בורג[׳'״]? חליפה|burj khalifa|מלונ(?:ות|י|ון) (?:ליד|קרוב|בסביבת)|hotel(?:s)? (?:near|close to)/i,
  /ביקור(?:ו|וֹ)?ת|review|מתקנ|facility|מטבח|kitchen|בריכה|pool/i,
  /צ[׳']ק[ -]?אין|check[ -]?in/i,
  /דרכון|כניסה ל|ויזה|passport|entry requirement|visa|תוקף/i,
  /מחיר|זמינות|availability|price|מדיניות|policy|עדכני|כיום|עכשיו|אצלי|באתר שלי|האתר שלי|טרוולאור|travelor/i,
];

export function needsLiveResearch(messages) {
  const latest = [...(messages || [])].reverse().find((m) => m?.role === "user")?.content || "";
  return LIVE_PATTERNS.some((pattern) => pattern.test(latest));
}

export function latestQuestion(messages) {
  return [...(messages || [])].reverse().find((m) => m?.role === "user")?.content?.trim() || "";
}

export function isOwnerTravelorQuery(messages) {
  return /(?:אצלי|באתר שלי|האתר שלי|טרוולאור|travelor)/i.test(latestQuestion(messages));
}

export function buildSearchQuery(messages) {
  const question = latestQuestion(messages);
  const ownerSite = isOwnerTravelorQuery(messages) ? `\nמקור הבעלות המועדף למחיר וזמינות: ${OWNER_TRAVELOR_URL} (שמור fid=84016 בכל קישור).` : "";
  return `${question}${ownerSite}\nהעדף מקורות רשמיים ועדכניים; למלון: אתר המלון ומקור כשרות מוסמך; לכניסה: רשות הגירה/שגרירות; לחברת תעופה: אתר החברה.`;
}

const SOCIAL_DOMAINS = new Set(["facebook.com", "www.facebook.com", "instagram.com", "www.instagram.com", "tiktok.com", "www.tiktok.com"]);
const OTA_DOMAINS = new Set(["booking.com", "www.booking.com", "agoda.com", "www.agoda.com", "expedia.com", "www.expedia.com", "tripadvisor.com", "www.tripadvisor.com", "trivago.com", "www.trivago.com", "destinia.com", "www.destinia.com"]);
const MAP_DOMAINS = new Set(["maps.google.com", "maps.apple.com", "www.openstreetmap.org"]);
const REVIEW_DOMAINS = new Set(["tripadvisor.co.il", "www.tripadvisor.co.il", "telegraph.co.uk", "www.telegraph.co.uk"]);
// Deny-by-default: a domain is never promoted to an official hotel source merely
// because a search snippet calls it official. Add only manually verified owners.
const HOTEL_OFFICIAL_DOMAINS = new Set([
  "www.armanihotels.com", "armanihotels.com",
  "www.addresshotels.com", "addresshotels.com",
  "www.tajhotels.com", "tajhotels.com",
]);
const KOSHER_AUTHORITY_DOMAINS = new Set(["www.ok.org", "ok.org", "www.oukosher.org", "oukosher.org", "www.star-k.org", "star-k.org"]);

function isOwnerTravelorUrl(url) {
  const parsed = new URL(url);
  return (parsed.hostname === "travelor.com" || parsed.hostname === "www.travelor.com") && parsed.pathname === "/he" && parsed.searchParams.get("fid") === "84016";
}

export function classifySource(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (isOwnerTravelorUrl(url)) return "owner_travelor";
  if (host === "app.travelor.com" || host.endsWith(".app.travelor.com")) return "travelor";
  if (HOTEL_OFFICIAL_DOMAINS.has(host)) return "hotel_official";
  if (KOSHER_AUTHORITY_DOMAINS.has(host)) return "kosher_certifier";
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
  }
  const priority = { owner_travelor: 0, travelor: 1 };
  return sources
    .sort((a, b) => (priority[a.sourceType] ?? 2) - (priority[b.sourceType] ?? 2))
    .slice(0, MAX_SEARCH_RESULTS);
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


export function isHotelRecommendationQuery(messages) {
  const q = latestQuestion(messages);
  return /(?:מלון|מלונות|מלוני|hotel|כשר|kosher|חב[״׳"']?ד|chabad)/i.test(q) && !/(?:מה פירוש|מה ההבדל|what (?:does|is)|meaning).*(?:HB|BB|RO|FB)/i.test(q);
}

export function filterHotelRecommendationSources(sources, messages) {
  const q = latestQuestion(messages);
  const ownerTravelor = isOwnerTravelorQuery(messages);
  const proximity = isHotelProximityQuery(messages);
  const kosher = /(?:כשר|kosher)/i.test(q);
  const allowed = new Set(["hotel_official"]);
  if (proximity) allowed.add("maps");
  if (kosher) { allowed.add("kosher_certifier"); allowed.add("community_official"); }
  if (ownerTravelor) allowed.add("owner_travelor");
  return sources.filter((source) => allowed.has(source.sourceType)).map((source) => ({
    ...source,
    ...(source.sourceType === "owner_travelor" ? { sourceLabel: "באתר שלך" } : {}),
  }));
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
  return sources.map((s, i) => `[${i + 1}] ${s.title}\nסוג מקור: ${s.sourceType || classifySource(s.url)}${s.sourceLabel ? `\nתווית הצגה: ${s.sourceLabel}` : ""}${s.lodgingType ? `\nסוג לינה: ${s.lodgingType}` : ""}\nURL: ${s.url}\nקטע מקור: ${s.content || "(ללא קטע טקסט)"}`).join("\n\n");
}
