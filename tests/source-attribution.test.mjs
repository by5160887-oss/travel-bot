import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifySource, normalizeSources, OWNER_TRAVELOR_URL } from "../research.js";
import { normalizeCitations } from "../chat-core.js";
import { answerBasis } from "../worker.js";

test("Travelor sources are recognized and sorted first", () => {
  assert.equal(classifySource(OWNER_TRAVELOR_URL), "owner_travelor");
  assert.equal(classifySource("https://app.travelor.com/public/hotel/123"), "travelor");
  const sources = normalizeSources([
    { title: "Web", url: "https://example.com/x", content: "x" },
    { title: "BeAgent", url: "https://app.travelor.com/public/hotel/123", content: "y" },
    { title: "Yehuda", url: OWNER_TRAVELOR_URL, content: "z" },
  ]);
  assert.deepEqual(sources.map((s) => s.sourceType), ["owner_travelor", "travelor", "other"]);
});

test("answer basis is explicit for every path", () => {
  assert.equal(answerBasis("live", [{ sourceType: "owner_travelor" }]), "travelor");
  assert.equal(answerBasis("live", [{ sourceType: "government" }]), "internet");
  assert.equal(answerBasis("not_needed", []), "knowledge");
  assert.equal(answerBasis("search_unreachable", []), "safety");
});

test("citation numbers map to the displayed source list", () => {
  assert.equal(normalizeCitations("טענה [3,5] וגם [2]", 5), "טענה [3] [5] וגם [2]");
  assert.equal(normalizeCitations("טענה [7] וגם [2]", 3), "טענה וגם [2]");
  assert.equal(normalizeCitations("ידע [1]", 0), "ידע");
});

test("UI labels every answer source and numbers displayed links", () => {
  const html = readFileSync(new URL("../1-index.html", import.meta.url), "utf8");
  for (const label of ["מטראוולור", "מהאינטרנט", "מבסיס הידע שלנו"]) assert.ok(html.includes(label));
  assert.ok(html.includes("box.textContent='מקורות:'"));
  assert.ok(html.includes("`[${i+1}]"));
  assert.ok(html.includes("d.basis"));
});
