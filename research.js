// Provider-neutral live web research for Travel Bot.
// Default: Tavily keyless mode (free, rate-limited, no account or secret).
// Optional: TAVILY_API_KEY raises the limit; it must remain a server-side secret.

export const SEARCH_ENDPOINT = "https://api.tavily.com/search";
export const MAX_SEARCH_RESULTS = 6;
export const SEARCH_TIMEOUT_MS = 9000;

const LIVE_PATTERNS = [
  /מלונ|hotel|כשר|kosher|חב["״']?ד|chabad|בורג'? חליפה|burj khalifa/i,
  /ביקור(?:ו|וֹ)?ת|review|מתקנ|facility|מטבח|kitchen|בריכה|pool/i,
  /צ'ק[ -]?אין|check[ -]?in/i,
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

export function sourceContext(sources) {
  return sources.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\nקטע מקור: ${s.content || "(ללא קטע טקסט)"}`).join("\n\n");
}
