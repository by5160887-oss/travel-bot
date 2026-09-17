import test from "node:test";
import assert from "node:assert/strict";
import { SYSTEM_PROMPT, buildGeminiRequest } from "../chat-core.js";

function instructionFor(question) {
  return buildGeminiRequest([{ role: "user", content: question }], "model").body.system_instruction.parts[0].text;
}

test("everyday answers get tasteful, measured emoji guidance", () => {
  const prompt = instructionFor("מה ההבדל בין חצי פנסיון לכל כלול?");
  assert.match(prompt, /אמוג'ים רלוונטיים/);
  assert.match(prompt, /בטוב טעם ובמידה/);
  assert.match(prompt, /אחד עד שלושה לתשובה/);
  assert.match(prompt, /אינו מחליף מילים, מספרים או מקורות/);
  assert.match(prompt, /אובדן או נזק לכבודה וזכויות נוסעים/);
  assert.match(prompt, /גם לא אמוג'י נושא תמים/);
});

test("sensitive topics stay emoji-free and the serious-tone rule stays intact", () => {
  const prompt = instructionFor("יש סכנה מיידית לאדם, מה עושים?");
  assert.match(prompt, /בנושאים רגישים/);
  assert.match(prompt, /טון רציני, ברור ואמפתי/);
  assert.match(prompt, /אין להשתמש בהומור/);
  assert.match(prompt, /קריצה תיירותית/);
  assert.match(prompt, /ואין לשלב אמוג'ים כלל/);
});

// The numbered deployment copies must remain byte-identical to their canonical sources.
test("deployment copy keeps the same emoji policy", async () => {
  const { readFile } = await import("node:fs/promises");
  const canonical = await readFile(new URL("../chat-core.js", import.meta.url), "utf8");
  const numbered = await readFile(new URL("../2-chat-core.js", import.meta.url), "utf8");
  assert.equal(numbered, canonical);
});
