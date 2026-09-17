import test from "node:test";
import assert from "node:assert/strict";
import { isSensitiveConversation, stripEmojis, callGemini } from "../chat-core.js";

function mockFetch(reply) {
  return async () => ({
    ok: true,
    json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: reply }] } }] }),
  });
}

test("baggage-loss legal answers lose every emoji, deterministically", async () => {
  const modelReply = "תחת אמנת מונטריאול ✈️, סעיף 17(3): 21 יום 🧳. יש להגיש תביעה כתובת 📝.";
  const res = await callGemini({
    apiKey: "k", model: "m", fetchImpl: mockFetch(modelReply),
    messages: [{ role: "user", content: "הכבודה של הלקוח אבדה בטיסה, מה המועדים לתביעה?" }],
  });
  assert.ok(res.ok);
  assert.doesNotMatch(res.reply, /\p{Extended_Pictographic}/u);
  assert.match(res.reply, /סעיף 17\(3\): 21 יום\./);
});

test("emergency answers lose every emoji", async () => {
  const res = await callGemini({
    apiKey: "k", model: "m", fetchImpl: mockFetch("התקשרו למד״א 101 מיד 🚑 ואל תזיזו את הפצוע ⚠️"),
    messages: [{ role: "user", content: "יש סכנה מיידית לאדם, מה עושים?" }],
  });
  assert.ok(res.ok);
  assert.doesNotMatch(res.reply, /\p{Extended_Pictographic}/u);
});

test("everyday answers keep their emojis untouched", async () => {
  const modelReply = "🍽️ חצי פנסיון כולל בוקר וערב. 🏨 הכל כלול כולל גם שתייה וחטיפים.";
  const res = await callGemini({
    apiKey: "k", model: "m", fetchImpl: mockFetch(modelReply),
    messages: [{ role: "user", content: "מה ההבדל בין חצי פנסיון לכל כלול?" }],
  });
  assert.ok(res.ok);
  assert.equal(res.reply, modelReply);
});

test("a sensitive earlier turn keeps short follow-ups emoji-free", async () => {
  const res = await callGemini({
    apiKey: "k", model: "m", fetchImpl: mockFetch("המגבלה היא 1,519 SDR לנוסע 💰."),
    messages: [
      { role: "user", content: "הכבודה אבדה, מה המועדים?" },
      { role: "assistant", content: "..." },
      { role: "user", content: "וכמה פיצוי מגיע?" },
    ],
  });
  assert.ok(res.ok);
  assert.doesNotMatch(res.reply, /\p{Extended_Pictographic}/u);
});

test("detector and stripper units", () => {
  assert.equal(isSensitiveConversation([{ role: "user", content: "מה זה אוברבוקינג?" }]), false);
  assert.equal(isSensitiveConversation([{ role: "user", content: "כמה קילו מותר בטרולי?" }]), false);
  assert.equal(isSensitiveConversation([{ role: "user", content: "מה הזכויות שלי כנוסע?" }]), false);
  assert.equal(isSensitiveConversation([{ role: "user", content: "זכויות נוסעים בעיכוב טיסה?" }]), true);
  assert.equal(stripEmojis("שלום ✈️🏨 עולם"), "שלום עולם");
  assert.equal(stripEmojis("בדיקה 🧳."), "בדיקה.");
  assert.equal(stripEmojis("אין כאן אמוג'ים בכלל"), "אין כאן אמוג'ים בכלל");
});
