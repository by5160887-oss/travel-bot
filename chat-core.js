// Travel Bot — shared chat core for BOTH backends (worker.js on Cloudflare and
// api/chat.js on Vercel). One copy of the constants, the Hebrew system prompt
// and the Gemini call logic, so the two deployments cannot drift apart.

export const DEFAULT_MODEL = "gemini-3.5-flash-lite"; // free-tier model code per Google AI docs
export const MAX_HISTORY = 12;         // newest turns kept; older ones dropped
export const MAX_MSG_CHARS = 8000;     // per-message cap; over-limit is REJECTED (413), never silently chopped
export const MAX_OUTPUT_TOKENS = 3072; // headroom for multi-section legal analyses (was 800 — cut answers mid-sentence)
export const MAX_CONTINUATIONS = 1;    // server-side follow-ups after a MAX_TOKENS stop

// Hebrew system prompt. Load-bearing behaviors:
//  1. Answer the LATEST question specifically — history is context only,
//     never a template to repeat.
//  2. Before legal conclusions, surface decisive missing facts (one ticket
//     vs two, operating carriers, route, event dates, purchase point,
//     special declaration of value) and branch instead of concluding.
//  3. Montreal Convention clocks stay distinct, with article numbers:
//     Art 17(3) deemed-loss 21 days from the date the bag ought to have
//     arrived; Art 31(2) written notice 7 days (damage/missing contents) /
//     21 days (delay) from the day the bag was placed at the passenger's
//     disposal; Art 35 two-year action limit.
//  4. Never compute baggage compensation per kilogram under Montreal
//     (Warsaw-era). Montreal caps are per passenger (Art 22(2)); the
//     28 Dec 2024 ICAO revision sets 1,519 SDR — verify before quoting.
//  5. Changing legal/policy facts get the general rule plus the official
//     source to verify against — never invented specifics.
export const SYSTEM_PROMPT = `אתה Travel Bot — עוזר ידע מקצועי בעברית לסוכני נסיעות.

כללים מחייבים:
- ענה תמיד על השאלה האחרונה של המשתמש בלבד, באופן ספציפי וישיר. היסטוריית השיחה משמשת הקשר בלבד. לעולם אל תחזור על תשובה קודמת, אל תענה על שאלה קודמת במקום על החדשה, ואל תשלח רשימה כללית כשנשאלה שאלה ספציפית.
- אם השאלה החדשה שונה מהקודמת, התשובה חייבת לגעת בנושא החדש גם אם הוא קשור לקודם.
- אם המשתמש מחלק את השאלה לסעיפים ממוספרים, ענה על כל הסעיפים לפי הסדר ואל תדלג על אף סעיף.
- לפני מסקנות משפטיות או קביעת אחריות, זהה עובדות מכריעות שחסרות ובקש אותן במפורש: האם מדובר בכרטיס אחד (PNR אחד) או בשני כרטיסים נפרדים, מי חברות התעופה המפעילות בכל מקטע, המסלול המלא, תאריכי האירוע והמסירה, היכן נרכש הכרטיס, והאם בוצעה הצהרת ערך מיוחדת על הכבודה. כל עוד עובדה מכריעה חסרה, הצג את הענפים האפשריים במפורש ואל תיתן קביעה חד-משמעית (למשל: מי המוביל שיש לתבוע תלוי במבנה הכרטיס).
- תחת אמנת מונטריאול שמור על הפרדה מלאה בין שלושה מועדים שונים, תמיד עם מספר הסעיף:
  1. סעיף 17(3): כבודה שלא הגיעה בתוך 21 יום מהתאריך שבו הייתה אמורה להגיע מזכה את הנוסע באכיפת זכויותיו (חזקת אובדן). הספירה היא מהתאריך שבו הכבודה הייתה אמורה להגיע — לא מיום הגשת דרישה.
  2. סעיף 31(2): הודעה בכתב לחברת התעופה — תוך 7 ימים מקבלת הכבודה במקרה של נזק (לרבות תכולה חסרה), ותוך 21 ימים מהיום שבו הכבודה הונחה לרשות הנוסע במקרה של עיכוב. דו״ח PIR עשוי להיחשב כהודעה בכתב בהתאם לתוכנו ולפורום (פס״ד C-258/16), אך יש להמליץ תמיד על תביעה כתובה ומפורטת בנפרד.
  3. סעיף 35: הזכות לתביעה משפטית מתבטלת אם לא הוגשה תביעה בתוך שנתיים.
- לעולם אל תחשב או תציג פיצוי על כבודה "לפי משקל" תחת אמנת מונטריאול — חישוב לפי קילוגרם שייך לשיטת ורשה הישנה. תחת מונטריאול מגבלת האחריות על כבודה היא לנוסע (סעיף 22(2)); נכון לתיקון ICAO שנכנס לתוקף ב-28 בדצמבר 2024 המגבלה היא 1,519 יחידות SDR לנוסע, ויש לאמת את המספר העדכני מול ICAO לפני ציטוטו ללקוח.
- עובדות שמשתנות עם הזמן (חוק, אמנות, רגולציה, מדיניות ספק, מועדים, סכומי פיצוי): הצג את הכלל הכללי המקובל, ציין את המקור הרשמי שמולו מאמתים (טקסט אמנת מונטריאול, חוק שירותי תעופה (טיסות), תנאי ההובלה של חברת התעופה, משרד התחבורה/התיירות), וכתוב במפורש שיש לאמת מול המקור העדכני לפני התחייבות ללקוח. אל תמציא סכומים, אחוזים או מועדים מדויקים.
- אל תמציא עובדות או זכויות. אם אינך יודע, אמור זאת במפורש.
- כתוב בעברית, תמציתי ומקצועי, עד כ-150 מילים אלא אם השאלה דורשת פירוט.`;

// Ask the model to pick up exactly where it stopped (used only after a
// MAX_TOKENS finish — see callGemini).
export const CONTINUATION_PROMPT = "המשך בדיוק מאותה נקודה, בלי לחזור על מה שכבר כתבת.";

// Normalize an arbitrary client-sent history into a safe shape:
// user/assistant roles only, alternating (consecutive same-role messages are
// merged), starting with a user message, capped in count. Message CONTENT is
// never silently chopped — over-limit messages are rejected by prepareChat.
export function normalizeMessages(input) {
  if (!Array.isArray(input)) return null;
  const clean = [];
  for (const m of input) {
    if (!m || typeof m.content !== "string" || !m.content.trim()) continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = m.content.trim();
    const last = clean[clean.length - 1];
    if (last && last.role === role) last.content += "\n" + content;
    else clean.push({ role, content });
  }
  while (clean.length && clean[0].role !== "user") clean.shift();
  return clean.slice(-MAX_HISTORY);
}

// Validate a request body: returns {messages} or {error, status}. A message
// longer than MAX_MSG_CHARS is rejected loudly (413) instead of being
// silently truncated, so a long case file can never lose its ending.
export function prepareChat(body) {
  const messages = normalizeMessages(body?.messages);
  if (!messages || messages.length === 0) return { error: "bad_messages", status: 400 };
  if (messages.some((m) => m.content.length > MAX_MSG_CHARS)) {
    return { error: "message_too_long", status: 413 };
  }
  return { messages };
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

// Call Gemini and return {ok:true, reply, truncated} or {ok:false, status, error}.
// candidates[0].finishReason is ALWAYS checked: on MAX_TOKENS the partial
// answer is never returned as-is — the server sends one continuation turn and
// joins the pieces; if the continuation also hits MAX_TOKENS the reply is
// returned flagged truncated:true so the client can label it instead of
// rendering and storing a partial answer as if it were complete.
export async function callGemini({ apiKey, model = DEFAULT_MODEL, messages, fetchImpl }) {
  const doFetch = fetchImpl || globalThis.fetch;
  let working = messages;
  let combined = "";
  for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
    const req = buildGeminiRequest(working, model);
    let upstream;
    try {
      upstream = await doFetch(req.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(req.body),
      });
    } catch {
      return { ok: false, status: 502, error: "upstream_unreachable" };
    }
    if (!upstream.ok) {
      // 429 = free-tier daily quota exhausted; the client falls back to the
      // built-in knowledge base (with a visible label), so the chat degrades
      // instead of breaking.
      return {
        ok: false,
        status: 502,
        error: upstream.status === 429 ? "rate_limited" : "upstream_error",
        upstreamStatus: upstream.status,
      };
    }
    const data = await upstream.json();
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const piece = parts
      .filter((p) => typeof p?.text === "string")
      .map((p) => p.text)
      .join("\n")
      .trim();
    const finishReason = candidate?.finishReason || "STOP";
    if (!piece && !combined) return { ok: false, status: 502, error: "empty_upstream" };
    combined = combined ? combined + "\n" + piece : piece;
    if (finishReason !== "MAX_TOKENS" || attempt === MAX_CONTINUATIONS) {
      return { ok: true, reply: combined, truncated: finishReason === "MAX_TOKENS" };
    }
    working = [
      ...working,
      { role: "assistant", content: piece },
      { role: "user", content: CONTINUATION_PROMPT },
    ];
  }
}
