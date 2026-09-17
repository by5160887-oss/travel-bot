import test from "node:test";
import assert from "node:assert/strict";
import { SYSTEM_PROMPT, buildGeminiRequest, callGemini, polishHebrew, ensureSalesLayer } from "../chat-core.js";

function mockFetch(reply) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: reply }] } }] }),
  });
}

test("Hebrew quality: prompt requires proofreading and uses a lower temperature", () => {
  assert.match(SYSTEM_PROMPT, /בצע הגהה עברית שקטה/);
  assert.match(SYSTEM_PROMPT, /אל תשנה עובדות, מספרים, שמות/);
  const request = buildGeminiRequest([{ role: "user", content: "מה לבדוק בכרטיס?" }], "model");
  assert.equal(request.body.generationConfig.temperature, 0.2);
});

test("Hebrew quality: known live garbles are corrected without broad rewriting", () => {
  const dirty = "תנאי ההתרת למסטיק מסוים מוכרת הטבות שמששתנים. EK123 נשאר.";
  assert.equal(
    polishHebrew(dirty),
    "תנאי התעריף לטיסה מסוימת מציעה הטבות שמשתנים. EK123 נשאר.",
  );
});

test("Hebrew quality: correction is applied in the real callGemini answer path", async () => {
  const result = await callGemini({
    apiKey: "k",
    messages: [{ role: "user", content: "מה חשוב בתעריף?" }],
    fetchImpl: mockFetch("בדוק את תנאי ההתרת.\n\nטיפ לסוכן: הצג אותם מראש.\nשאלת המשך ללקוח: חשובה גמישות?"),
  });
  assert.equal(result.ok, true);
  assert.match(result.reply, /תנאי התעריף/);
  assert.doesNotMatch(result.reply, /תנאי ההתרת/);
  assert.match(result.reply, /טיפ לסוכן:/);
  assert.match(result.reply, /שאלת המשך ללקוח:/);
});

test("Sales layer: deterministic guard adds only missing lines", () => {
  const plain = ensureSalesLayer("תשובה מקצועית.");
  assert.match(plain, /טיפ לסוכן:/);
  assert.match(plain, /שאלת המשך ללקוח:/);

  const tailored = "תשובה.\n\nטיפ לסוכן: הצג שתי חלופות.\nשאלת המשך ללקוח: מה התקציב?";
  assert.equal(ensureSalesLayer(tailored), tailored);
});

test("Sales layer: every answer is instructed to end with a useful tip and qualifying question", () => {
  assert.match(SYSTEM_PROMPT, /סיים כל תשובה בשתי שורות קצרות ונפרדות/);
  assert.match(SYSTEM_PROMPT, /טיפ לסוכן: \.\.\./);
  assert.match(SYSTEM_PROMPT, /שאלת המשך ללקוח: \.\.\.\?/);
  assert.match(SYSTEM_PROMPT, /אל תחזור בשאלה על מידע שכבר נמסר/);
  assert.match(SYSTEM_PROMPT, /גם כשחסרות עובדות וגם בנושא רגיש/);
});
