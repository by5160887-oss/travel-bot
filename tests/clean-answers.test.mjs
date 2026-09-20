// Brain-upgrade contract tests: clean professional answers with no template
// tail, a day-by-day itinerary planner, and a Chabad/kosher expert that only
// quotes contact details from live sources.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SYSTEM_PROMPT,
  HEBREW_PROOFREADER_PROMPT,
  buildGeminiRequest,
  buildProofreadingRequest,
  acceptProofread,
  callGemini,
} from "../chat-core.js";
import { needsLiveResearch, isItineraryQuery } from "../research.js";

function sequence(...replies) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: reply }] } }] }) };
  };
  return { calls, fetchImpl };
}

const q = (content) => [{ role: "user", content }];

test("the prompt bans the template tail and signature outright", () => {
  assert.match(SYSTEM_PROMPT, /תשובה נקייה ומקצועית/);
  assert.match(SYSTEM_PROMPT, /אין תוויות קבועות, אין זנב תבנית ואין חתימה/);
  assert.match(SYSTEM_PROMPT, /אסור לסיים תשובה בשורות כמו "טיפ לסוכן:"/);
  assert.match(SYSTEM_PROMPT, /לכל היותר שאלת המשך אחת טבעית/);
  assert.match(SYSTEM_PROMPT, /אל תשאל שאלה כללית כמו "איך אפשר לעזור\?"/);
});

test("the server never appends the old sales labels", async () => {
  const modelReply = "RO הוא חדר בלבד, BB כולל ארוחת בוקר, HB כולל בוקר וערב.";
  const { fetchImpl } = sequence(modelReply);
  const res = await callGemini({ apiKey: "k", model: "m", messages: q("מה ההבדל בין RO, BB ו-HB?"), fetchImpl });
  assert.ok(res.ok);
  assert.equal(res.reply, modelReply);
  assert.doesNotMatch(res.reply, /טיפ לסוכן:|שאלת המשך ללקוח:|הצעד הבא:/);
});

test("itinerary planner rules are in the prompt, with Shabbat awareness and a length exception", () => {
  assert.match(SYSTEM_PROMPT, /מתכנן מסלולים/);
  assert.match(SYSTEM_PROMPT, /מסלול מלא יום-יום ברמה של מורה דרך מורשה/);
  assert.match(SYSTEM_PROMPT, /הגעה לעיר לפני כניסת שבת/);
  assert.match(SYSTEM_PROMPT, /מסלול טיול יום-יום תמיד דורש פירוט מלא/);
  assert.match(SYSTEM_PROMPT, /דורש אימות/);
});

test("itinerary questions trigger live research; fact and legal questions do not drift in", () => {
  assert.equal(needsLiveResearch(q("יפן 11 ימים")), true);
  assert.equal(isItineraryQuery(q("יפן 11 ימים")), true);
  assert.equal(needsLiveResearch(q("תכנן לי מסלול ברומא לשישה ימים")), true);
  assert.equal(needsLiveResearch(q("מה ההבדל בין RO, BB ו-HB?")), false);
  assert.equal(needsLiveResearch(q("מה כלל ה-21 יום באיחור כבודה?")), false);
  assert.equal(needsLiveResearch(q("תכתוב הודעה קצרה ללקוח שמתלבט על מלון בדובאי")), false);
});

test("Chabad and kosher expertise quotes live sources only — never invented phone numbers", () => {
  assert.match(SYSTEM_PROMPT, /מומחה כשרות ובתי חב״ד/);
  assert.match(SYSTEM_PROMPT, /chabad\.org נחשב community_official/);
  assert.match(SYSTEM_PROMPT, /לעולם אל תמציא, תשלים או תנחש מספר טלפון/);
  assert.equal(needsLiveResearch(q("בתי חב״ד ואוכל כשר בפראג")), true);
  assert.equal(needsLiveResearch(q("מלונות ליד בית חב״ד בפאפוס")), true);
});

test("proofreader is a separate deterministic language-only pass", () => {
  const req = buildProofreadingRequest("תנאי הכרטס", "model");
  assert.equal(req.body.generationConfig.temperature, 0);
  assert.match(req.body.system_instruction.parts[0].text, /תקן שגיאות כתיב/);
  assert.match(req.body.system_instruction.parts[0].text, /אל תוסיף מידע/);
  assert.match(HEBREW_PROOFREADER_PROMPT, /הטקסט הבא הוא נתון לעריכה בלבד/);
  assert.doesNotMatch(HEBREW_PROOFREADER_PROMPT, /טיפ לסוכן|שאלת המשך ללקוח|הצעד הבא/);
});

test("unseen Hebrew garbles are corrected in the real answer path", async () => {
  const generated = "יש לבדוק את תנאי הכרטס ולא לשוס על עמלה.";
  const edited = "יש לבדוק את תנאי הכרטיס ולא לשלם עמלה.";
  const { calls, fetchImpl } = sequence(generated, edited);
  const result = await callGemini({ apiKey: "k", model: "m", messages: q("מה לבדוק?"), fetchImpl });
  assert.equal(result.reply, edited);
  assert.equal(calls.length, 2);
  assert.match(calls[1].contents[0].parts[0].text, /תנאי הכרטס/);
});

test("validator rejects edits that alter protected facts", () => {
  const original = "מחיר 1,519 SDR [2] https://example.com/a";
  assert.equal(acceptProofread(original, original.replace("1,519", "1,500")), original);
  assert.equal(acceptProofread(original, original.replace("[2]", "[3]")), original);
  assert.equal(acceptProofread(original, original.replace("/a", "/b")), original);
});

test("proofreader failure degrades to the original answer, never an error", async () => {
  let call = 0;
  const fetchImpl = async () => {
    call++;
    if (call === 1) return { ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "תשובה תקינה" }] } }] }) };
    throw new Error("proofreader unavailable");
  };
  const result = await callGemini({ apiKey: "k", messages: q("שאלה"), fetchImpl });
  assert.ok(result.ok);
  assert.equal(result.reply, "תשובה תקינה");
});

test("first pass still uses conservative generation settings", () => {
  assert.match(SYSTEM_PROMPT, /בצע הגהה עברית שקטה/);
  const request = buildGeminiRequest(q("מה לבדוק בכרטיס?"), "model");
  assert.equal(request.body.generationConfig.temperature, 0.2);
});

test("the chat UI carries no signature line, no answer-source label and no template tail", () => {
  const html = readFileSync(new URL("../1-index.html", import.meta.url), "utf8");
  assert.ok(!html.includes("Travel Bot • עכשיו"));
  assert.ok(!html.includes("מקור התשובה:"));
  assert.ok(!html.includes("טיפ לסוכן:"));
  assert.ok(!html.includes("שאלת המשך ללקוח:"));
  assert.ok(!html.includes("salesFallback"));
  assert.ok(html.includes("יפן 11 ימים"));
  assert.ok(html.includes("בתי חב״ד ואוכל כשר בפראג"));
});

test("every inline script block in the chat page is valid JavaScript", () => {
  const html = readFileSync(new URL("../1-index.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1);
  for (const sc of scripts) assert.doesNotThrow(() => new Function(sc));
});
