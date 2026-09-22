import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SYSTEM_PROMPT, isPromptInjectionAttempt } from "../chat-core.js";
import { needsLiveResearch } from "../research.js";

const writing = "תכתוב הודעה קצרה ללקוח שמתלבט על מלון בדובאי";
test("ordinary sales writing is neither safety nor live research", () => {
  assert.equal(isPromptInjectionAttempt([{ role: "user", content: writing }]), false);
  assert.equal(needsLiveResearch([{ role: "user", content: writing }]), false);
});

test("knowledge includes original practical sales, Shabbat, Japan and Travelor guidance", () => {
  for (const phrase of ["לקוח שומר שבת", "התנגדות מחיר", "Downtown", "14.02–01.03.2027", "reservations@travelor.com", "fid=84016", "אין לך גישה לדשבורד הפרטי"]) {
    assert.ok(SYSTEM_PROMPT.includes(phrase), phrase);
  }
});

test("fallback knowledge mirrors the key enrichment areas", () => {
  const html = readFileSync(new URL("../1-index.html", import.meta.url), "utf8");
  for (const phrase of ["שומר שבת", "יקר מדי", "טיול מאורגן ליפן"]) assert.ok(html.includes(phrase), phrase);
});


test("fallback has broad offline coverage and keeps AI-first flow", () => {
  const html = readFileSync(new URL("../1-index.html", import.meta.url), "utf8");
  for (const phrase of ["EU261", "חוק שירותי תעופה", "esta.cbp.dhs.gov", "GOV.UK", "ETIAS", "Thai e-Visa", "chabadprague.cz", "chabadhungary.com", "chabad.at", "תסריט מכירה"]) assert.ok(html.includes(phrase), phrase);
  assert.ok(html.includes("fetch('/api/chat'"));
  assert.ok(html.includes("setTimeout(()=>answer(v),250)"));
  assert.ok(html.includes("const ACCESS='TRAVEL2026'"));
});
