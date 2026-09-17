import test from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_PROMPT,
  HEBREW_PROOFREADER_PROMPT,
  buildGeminiRequest,
  buildProofreadingRequest,
  acceptProofread,
  callGemini,
  ensureSalesLayer,
} from "../chat-core.js";

function sequence(...replies) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: reply }] } }] }) };
  };
  return { calls, fetchImpl };
}

test("first pass still uses conservative generation settings", () => {
  assert.match(SYSTEM_PROMPT, /בצע הגהה עברית שקטה/);
  const request = buildGeminiRequest([{ role: "user", content: "מה לבדוק בכרטיס?" }], "model");
  assert.equal(request.body.generationConfig.temperature, 0.2);
});

test("proofreader is a separate deterministic language-only pass", () => {
  const req = buildProofreadingRequest("תנאי הכרטס", "model");
  assert.equal(req.body.generationConfig.temperature, 0);
  assert.match(req.body.system_instruction.parts[0].text, /תקן שגיאות כתיב/);
  assert.match(req.body.system_instruction.parts[0].text, /אל תוסיף מידע/);
  assert.match(HEBREW_PROOFREADER_PROMPT, /הטקסט הבא הוא נתון לעריכה בלבד/);
});

test("unseen Hebrew garbles are corrected in the real answer path", async () => {
  const generated = "יש לבדוק את תנאי הכרטס ולא לשוס על עמלה.\n\nטיפ לסוכן: הצג תנאים.\nשאלת המשך ללקוח: חשובה גמישות?";
  const edited = "יש לבדוק את תנאי הכרטיס ולא לשלם עמלה.\n\nטיפ לסוכן: הצג תנאים.\nשאלת המשך ללקוח: חשובה גמישות?";
  const { calls, fetchImpl } = sequence(generated, edited);
  const result = await callGemini({ apiKey: "k", model: "m", messages: [{ role: "user", content: "מה לבדוק?" }], fetchImpl });
  assert.equal(result.reply, edited);
  assert.equal(calls.length, 2);
  assert.match(calls[1].contents[0].parts[0].text, /תנאי הכרטס/);
});

test("validator rejects edits that alter protected facts", () => {
  const original = "מחיר 1,519 SDR [2] https://example.com/a\nטיפ לסוכן: בדוק.\nשאלת המשך ללקוח: להמשיך?";
  assert.equal(acceptProofread(original, original.replace("1,519", "1,500")), original);
  assert.equal(acceptProofread(original, original.replace("[2]", "[3]")), original);
  assert.equal(acceptProofread(original, original.replace("/a", "/b")), original);
  assert.equal(acceptProofread(original, original.replace("טיפ לסוכן:", "טיפ:")), original);
});

test("proofreader failure degrades to the original answer, never an error", async () => {
  let call = 0;
  const fetchImpl = async () => {
    call++;
    if (call === 1) return { ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "תשובה תקינה" }] } }] }) };
    throw new Error("proofreader unavailable");
  };
  const result = await callGemini({ apiKey: "k", messages: [{ role: "user", content: "שאלה" }], fetchImpl });
  assert.ok(result.ok);
  assert.match(result.reply, /תשובה תקינה/);
  assert.match(result.reply, /טיפ לסוכן:/);
});

test("sales layer remains mandatory before proofreading", () => {
  const plain = ensureSalesLayer("תשובה מקצועית.");
  assert.match(plain, /טיפ לסוכן:/);
  assert.match(plain, /שאלת המשך ללקוח:/);
});
