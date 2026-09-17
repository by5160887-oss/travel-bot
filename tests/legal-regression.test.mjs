// Regression tests for the legal-reliability audit (2026-09-17).
// Background: the two-airline delayed-baggage scenario below got an answer
// that (a) was cut mid-sentence at item 9 and lost item 10 entirely because
// maxOutputTokens was 800 and candidates[0].finishReason was never checked,
// (b) merged the three distinct Montreal Convention clocks, (c) invented a
// Warsaw-era per-kilogram compensation basis, and (d) concluded carrier
// liability without the decisive one-ticket/two-ticket fact.
// Run with: npm test (node:test, no install, no network — fetch is mocked).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SYSTEM_PROMPT,
  MAX_OUTPUT_TOKENS,
  MAX_MSG_CHARS,
  CONTINUATION_PROMPT,
  buildGeminiRequest,
  prepareChat,
  normalizeMessages,
  callGemini,
} from "../chat-core.js";
import { handleChat } from "../worker.js";
import vercelHandler from "../api/chat.js";

// The exact scenario prompt the user sent the bot (WhatsApp, 2026-09-17).
const SCENARIO =
  "אני רוצה לבדוק את רמת הידע שלך כסוכן נסיעות AI. לקוח ישראלי מזמין חופשה בפריז: " +
  "✈️ טיסה: תל אביב → אמסטרדם → פריז 🎫 שתי חברות תעופה שונות 🧳 מזוודה שנשלחה בנתב״ג " +
  "⏱️ קונקשן של שעתיים 📍 המזוודה לא מגיעה לפריז 📄 הלקוח פותח PIR בשדה " +
  "📦 המזוודה נמסרת לאחר 5 ימים ❗ לאחר קבלת המזוודה מתברר שחסרים ממנה פריטים " +
  "💳 במהלך 5 הימים הלקוח רכש בגדים ומוצרי בסיס נתח את המקרה כמו יועץ תיירות בכיר. " +
  "אני רוצה שתענה בנפרד על: 1. איזה דין/אמנה עשויים לחול? 2. מי חברת התעופה האחראית לכבודה? " +
  "3. האם מדובר בכבודה שהתעכבה או בכבודה שאבדה? 4. מה משמעות כלל 21 הימים? " +
  "5. האם יש הבדל בין המזוודה עצמה לבין פריטים שחסרים מתוכה? 6. האם ניתן לדרוש החזר עבור רכישות " +
  "שבוצעו בזמן העיכוב? 7. מהם המועדים הרלוונטיים להגשת דרישה? 8. האם PIR לבדו נחשב תביעה כספית? " +
  "9. אילו פרטים נוספים אתה חייב לקבל מהלקוח לפני שאתה נותן לו תשובה סופית? " +
  "10. ציין במפורש אילו דברים אינך יכול לקבוע בוודאות ללא בדיקה נוספת. " +
  "חשוב: אל תיתן צ'קליסט כללי. אל תחזור על \"שמור תג כבודה וקבלות\". אני רוצה ניתוח של המקרה עצמו, " +
  "הבחנה בין עובדות לבין דברים שתלויים בנסיבות, ובלי להמציא סכומים או זכויות.";

// A complete 10-section answer such as the model should produce (mocked).
const FULL_ANSWER = [
  "1. הדין החל: אמנת מונטריאול (1999) חלה על הובלה בינלאומית בין ישראל, הולנד וצרפת.",
  "2. המוביל: לא ניתן לקבוע בלי לדעת אם מדובר בכרטיס אחד או בשני כרטיסים נפרדים; בכרטיס אחד סעיף 36(3) מאפשר תביעה של המוביל הראשון, האחרון או מבצע המקטע.",
  "3. סיווג: המזוודה נמסרה ביום החמישי, ולכן מדובר בעיכוב לפי סעיף 19 ולא באובדן.",
  "4. כלל 21 הימים: לפי סעיף 17(3), כבודה שלא הגיעה 21 יום מהתאריך שהייתה אמורה להגיע נחשבת לאבודה; כאן נמסרה ביום 5 ולכן החזקה לא חלה.",
  "5. מזוודה מול תכולה: העיכוב מכוסה בסעיף 19; הפריטים החסרים הם נזק לפי סעיף 17(2) ודורשים הודעה בכתב תוך 7 ימים מהמסירה לפי סעיף 31(2).",
  "6. החזר רכישות: הוצאות סבירות והכרחיות בזמן העיכוב מוכרות, בכפוף לקבלות ולחובת הקטנת הנזק.",
  "7. מועדים: 7 ימים לנזק ו-21 ימים לעיכוב מיום שהכבודה הונחה לרשות הנוסע (סעיף 31(2)); שנתיים לתביעה משפטית (סעיף 35).",
  "8. PIR: אינו תביעה כספית מפורטת, אך עשוי להיחשב כהודעה בכתב בהתאם לתוכנו (פס״ד C-258/16); מומלץ להגיש תביעה כתובה נפרדת.",
  "9. פרטים נדרשים: מבנה הכרטיס (אחד או שניים), החברות המפעילות, תגי כבודה, תאריכים, קבלות ורשימת פריטים.",
  "10. אי-ודאות: מבנה הכרטיס, המקטע שבו אירע הנזק, מקום הרכישה והמגבלה העדכנית ב-SDR אינם ניתנים לקביעה ללא בדיקה נוספת.",
].join("\n");

function post(payload) {
  return new Request("https://worker.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// Mock fetch that serves a scripted sequence of Gemini responses.
function mockSequence(steps) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: step.text }] }, finishReason: step.finishReason }],
      }),
    };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test("the exact 10-part two-airline scenario comes back complete (items 1-10, no truncation)", async () => {
  const { calls, restore } = mockSequence([{ text: FULL_ANSWER, finishReason: "STOP" }]);
  try {
    const res = await handleChat(post({ messages: [{ role: "user", content: SCENARIO }] }), { GEMINI_API_KEY: "k" });
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.ok(payload.reply.startsWith(FULL_ANSWER));
    assert.match(payload.reply, /טיפ לסוכן:/);
    assert.match(payload.reply, /שאלת המשך ללקוח:/);
    assert.equal(payload.truncated, undefined);
    for (let i = 1; i <= 10; i++) assert.ok(payload.reply.includes(`${i}.`), `item ${i} present`);
    // The whole scenario reaches the model as the newest message...
    const sent = calls[0].body.contents;
    assert.equal(sent[sent.length - 1].role, "user");
    assert.equal(sent[sent.length - 1].parts[0].text, SCENARIO);
    // ...with real output headroom instead of the old 800-token cap.
    assert.ok(MAX_OUTPUT_TOKENS >= 2500, "output cap raised");
    assert.equal(calls[0].body.generationConfig.maxOutputTokens, MAX_OUTPUT_TOKENS);
  } finally {
    restore();
  }
});

test("finishReason MAX_TOKENS triggers one server-side continuation and joins the pieces", async () => {
  const part1 = FULL_ANSWER.split("\n").slice(0, 5).join("\n");
  const part2 = FULL_ANSWER.split("\n").slice(5).join("\n");
  const { calls, restore } = mockSequence([
    { text: part1, finishReason: "MAX_TOKENS" },
    { text: part2, finishReason: "STOP" },
  ]);
  try {
    const res = await handleChat(post({ messages: [{ role: "user", content: SCENARIO }] }), { GEMINI_API_KEY: "k" });
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.ok(payload.reply.startsWith(part1 + "\n" + part2));
    assert.match(payload.reply, /טיפ לסוכן:/);
    assert.match(payload.reply, /שאלת המשך ללקוח:/);
    assert.equal(payload.truncated, undefined);
    assert.equal(calls.length, 2);
    // The continuation turn carries the partial answer back as a model turn.
    const cont = calls[1].body.contents;
    assert.equal(cont[cont.length - 2].role, "model");
    assert.equal(cont[cont.length - 2].parts[0].text, part1);
    assert.equal(cont[cont.length - 1].role, "user");
    assert.equal(cont[cont.length - 1].parts[0].text, CONTINUATION_PROMPT);
  } finally {
    restore();
  }
});

test("repeated MAX_TOKENS is flagged truncated:true — a partial answer is never returned as complete", async () => {
  const { restore } = mockSequence([{ text: "חצי תשובה", finishReason: "MAX_TOKENS" }]);
  try {
    const res = await handleChat(post({ messages: [{ role: "user", content: SCENARIO }] }), { GEMINI_API_KEY: "k" });
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.truncated, true);
    assert.ok(payload.reply.includes("חצי תשובה"));
  } finally {
    restore();
  }
});

test("long messages are rejected loudly (413 message_too_long), never silently chopped", async () => {
  const res = await handleChat(
    post({ messages: [{ role: "user", content: "x".repeat(MAX_MSG_CHARS + 1) }] }),
    { GEMINI_API_KEY: "k" },
  );
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error, "message_too_long");
  // And content under the (raised) limit survives normalizeMessages intact.
  const kept = normalizeMessages([{ role: "user", content: "y".repeat(5000) }]);
  assert.equal(kept[0].content.length, 5000);
  assert.ok(MAX_MSG_CHARS > 2000, "cap raised above the old silent 2000-char chop");
});

test("system prompt: decisive missing facts are requested BEFORE liability conclusions", () => {
  assert.match(SYSTEM_PROMPT, /כרטיס אחד/);
  assert.match(SYSTEM_PROMPT, /שני כרטיסים נפרדים/);
  assert.match(SYSTEM_PROMPT, /PNR/);
  assert.match(SYSTEM_PROMPT, /חברות התעופה המפעילות/);
  assert.match(SYSTEM_PROMPT, /הצהרת ערך מיוחדת/);
  assert.match(SYSTEM_PROMPT, /הענפים האפשריים/);
});

test("system prompt: the three Montreal clocks stay separate, with article numbers", () => {
  assert.match(SYSTEM_PROMPT, /17\(3\)/);          // deemed loss
  assert.match(SYSTEM_PROMPT, /הייתה אמורה להגיע/); // correct trigger date, not the claim date
  assert.match(SYSTEM_PROMPT, /31\(2\)/);           // written notice windows
  assert.match(SYSTEM_PROMPT, /7 ימים/);            // damage / missing contents
  assert.match(SYSTEM_PROMPT, /21 ימים/);           // delay
  assert.match(SYSTEM_PROMPT, /הונחה לרשות הנוסע/); // correct notice trigger
  assert.match(SYSTEM_PROMPT, /35/);
  assert.match(SYSTEM_PROMPT, /שנתיים/);            // two-year action limit
});

test("system prompt: no per-kilogram baggage compensation under Montreal", () => {
  assert.match(SYSTEM_PROMPT, /אל תחשב או תציג פיצוי על כבודה "לפי משקל"/);
  assert.match(SYSTEM_PROMPT, /לנוסע/);
  assert.match(SYSTEM_PROMPT, /22\(2\)/);
  assert.match(SYSTEM_PROMPT, /1,519/);
  assert.match(SYSTEM_PROMPT, /ICAO/);
});

test("system prompt: PIR nuance and no invented amounts or rights", () => {
  assert.match(SYSTEM_PROMPT, /C-258\/16/);
  assert.match(SYSTEM_PROMPT, /PIR עשוי להיחשב/);
  assert.match(SYSTEM_PROMPT, /אל תמציא סכומים/);
  assert.match(SYSTEM_PROMPT, /אל תמציא עובדות או זכויות/);
});

test("backend drift guard: both backends import the shared core and keep no private prompt copy", () => {
  const workerSrc = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  const vercelSrc = readFileSync(new URL("../api/chat.js", import.meta.url), "utf8");
  assert.match(workerSrc, /from "\.\/chat-core\.js"/);
  assert.match(vercelSrc, /from "\.\.\/chat-core\.js"/);
  for (const [name, src] of [["worker.js", workerSrc], ["api/chat.js", vercelSrc]]) {
    assert.ok(!src.includes("אתה Travel Bot"), `${name} must not carry its own prompt copy`);
    assert.ok(!src.includes("maxOutputTokens"), `${name} must not set its own output cap`);
    assert.ok(!src.includes("MAX_MSG_CHARS"), `${name} must not set its own length cap`);
  }
});

test("client: KB fallback is visibly labelled, truncation and 413 are handled, input is capped", () => {
  const html = readFileSync(new URL("../1-index.html", import.meta.url), "utf8");
  assert.ok(html.includes("תשובה מבסיס הידע המובנה — ה-AI אינו זמין כרגע"), "KB fallback label");
  assert.ok(html.includes("d.truncated"), "truncated replies detected");
  assert.ok(html.includes("התשובה נקטעה באמצע"), "truncated replies labelled");
  assert.ok(html.includes("r.status===413"), "over-long message handled explicitly");
  assert.ok(html.includes('maxlength="8000"'), "composer input capped at the server limit");
  assert.ok(html.includes("מקורות שנבדקו עכשיו"), "live sources shown to the user");
  assert.ok(html.includes("noopener noreferrer"), "source links isolated");
  assert.ok(html.includes("אתר הזמנות"), "source quality labels rendered");
});

test("Vercel mirror: same behavior through the shared core (200 reply, 413, truncated flag)", async () => {
  function resShim() {
    return {
      statusCode: 0,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(p) { this.payload = p; return this; },
    };
  }
  const { restore } = mockSequence([{ text: "תשובה מלאה", finishReason: "STOP" }]);
  const savedKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "k";
  try {
    const res = resShim();
    await vercelHandler({ method: "POST", body: { messages: [{ role: "user", content: SCENARIO }] } }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.payload.reply.startsWith("תשובה מלאה"));
    assert.match(res.payload.reply, /טיפ לסוכן:/);
    assert.match(res.payload.reply, /שאלת המשך ללקוח:/);
  } finally {
    restore();
  }
  const res413 = resShim();
  await vercelHandler(
    { method: "POST", body: { messages: [{ role: "user", content: "x".repeat(MAX_MSG_CHARS + 1) }] } },
    res413,
  );
  assert.equal(res413.statusCode, 413);
  assert.equal(res413.payload.error, "message_too_long");
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedKey;
});

test("callGemini: empty upstream reply is an error, not a silent empty answer", async () => {
  const result = await callGemini({
    apiKey: "k",
    messages: [{ role: "user", content: "q" }],
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [] } }] }) }),
  });
  assert.deepEqual(result, { ok: false, status: 502, error: "empty_upstream" });
});

test("buildGeminiRequest: model override still honored through the shared core", () => {
  const r = buildGeminiRequest([{ role: "user", content: "q" }], "gemini-3.1-flash-lite");
  assert.match(r.url, /models\/gemini-3\.1-flash-lite:/);
});

test("prepareChat: bad payloads still rejected with 400", () => {
  for (const body of [{}, { messages: "x" }, { messages: [] }, { messages: [{ role: "user" }] }]) {
    assert.equal(prepareChat(body).status, 400, JSON.stringify(body));
  }
});
