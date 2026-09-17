import test from "node:test";
import assert from "node:assert/strict";
import { SYSTEM_PROMPT, buildGeminiRequest } from "../chat-core.js";

function instructionFor(question) {
  return buildGeminiRequest([{ role: "user", content: question }], "model").body.system_instruction.parts[0].text;
}

test("casual off-topic asks stay useful, light and travel-adjacent instead of blocked", () => {
  const prompt = instructionFor("תן לי מתכון לעוגת שוקולד");
  assert.match(prompt, /עוזר AI אמיתי וכללי/);
  assert.match(prompt, /עדיין תן עזרה שימושית וקצרה/);
  assert.match(prompt, /אירוע במלון/);
  assert.match(prompt, /אל תחסום/);
  assert.match(prompt, /אל תכריח בדיחה/);
  assert.doesNotMatch(prompt, /ענה רק על שאלות בתחום התיירות/);
});

test("mixed or ambiguous travel and non-travel asks keep both relevant parts", () => {
  const prompt = instructionFor("תן רעיון לעוגה לאירוע במלון וגם מלון מתאים");
  assert.match(prompt, /שילוב או עמימות בין תיירות לנושא אחר/);
  assert.match(prompt, /ענה לשני החלקים הרלוונטיים/);
  assert.match(prompt, /אל תסווג אותה אוטומטית/);
});

test("sensitive non-travel asks never get humor or a forced travel callback", () => {
  const prompt = instructionFor("יש סכנה מיידית לאדם, מה עושים?");
  assert.match(prompt, /בנושאים רגישים/);
  for (const topic of ["משפט", "בטיחות", "בריאות", "נגישות", "חירום", "אלימות", "מצוקה", "סיכון לאדם"]) {
    assert.ok(prompt.includes(topic), `missing sensitive topic: ${topic}`);
  }
  assert.match(prompt, /טון רציני, ברור ואמפתי/);
  assert.match(prompt, /אין להשתמש בהומור/);
  assert.match(prompt, /קריצה תיירותית/);
});

// The numbered deployment copies must remain byte-identical to their canonical sources.
test("deployment copy keeps the same off-topic policy", async () => {
  const { readFile } = await import("node:fs/promises");
  const canonical = await readFile(new URL("../chat-core.js", import.meta.url), "utf8");
  const numbered = await readFile(new URL("../2-chat-core.js", import.meta.url), "utf8");
  assert.equal(numbered, canonical);
});
