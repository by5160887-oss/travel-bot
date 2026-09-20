// Zero-dependency regression tests for worker.js — run with: npm test
// (node:test is built in; no install step, no network: fetch is mocked).

import test from "node:test";
import assert from "node:assert/strict";
import { handleChat, buildGeminiRequest, normalizeMessages } from "../worker.js";

// The exact scenario from the bug report: a base delayed-baggage question,
// the generic checklist it received, then a materially different specific
// follow-up (the 21-day rule).
const BASE_Q = "מה עושים כשכבודה לא הגיעה?";
const BASE_A = "כשכבודה לא מגיעה: 1. פותחים דו״ח PIR... 2. שומרים תג כבודה...";
const FOLLOWUP_Q = "מה כלל ה-21 יום באיחור כבודה?";
const FOLLOWUP_A =
  "כלל ה-21 יום: לפי אמנת מונטריאול, כבודה שלא נמסרה בתוך 21 יום נחשבת אבודה...";

function post(payload) {
  return new Request("https://worker.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function withMockUpstream(capture, replyText = FOLLOWUP_A) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    capture.calls ||= [];
    capture.calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    capture.url = url;
    capture.headers = opts.headers;
    capture.body = capture.calls[0].body;
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: replyText }] } }] }),
    };
  };
  return () => { globalThis.fetch = real; };
}

test("regression: base baggage question then specific follow-up — the follow-up is what gets answered", async () => {
  const capture = {};
  const restore = withMockUpstream(capture);
  try {
    const res = await handleChat(
      post({
        messages: [
          { role: "user", content: BASE_Q },
          { role: "assistant", content: BASE_A },
          { role: "user", content: FOLLOWUP_Q },
        ],
      }),
      { GEMINI_API_KEY: "test-key" },
    );
    assert.equal(res.status, 200);
    const payload = await res.json();
    // 1. The model's specific answer is returned, not the canned checklist.
    assert.ok(payload.reply.startsWith(FOLLOWUP_A));
    assert.doesNotMatch(payload.reply, /טיפ לסוכן:|שאלת המשך ללקוח:|הצעד הבא:/);
    assert.notEqual(payload.reply, BASE_A);
    // 2. The newest question is the final content sent upstream...
    const sent = capture.calls[0].body.contents;
    assert.equal(sent[sent.length - 1].role, "user");
    assert.equal(sent[sent.length - 1].parts[0].text, FOLLOWUP_Q);
    // 3. ...with the earlier turns present as context (assistant→model role).
    assert.equal(sent[0].parts[0].text, BASE_Q);
    assert.equal(sent[1].role, "model");
    assert.equal(sent[1].parts[0].text, BASE_A);
    // 4. The system instruction orders newest-question priority...
    const sys = capture.body.system_instruction.parts[0].text;
    assert.match(sys, /השאלה האחרונה/);
    assert.match(sys, /אל תחזור על תשובה קודמת/);
    // 5. ...and source-aware handling of changing legal facts.
    assert.match(sys, /אמנת מונטריאול/);
    assert.match(sys, /אל תמציא סכומים/);
    // 6. The key travels server-side only, as an API header — never in the URL.
    assert.equal(capture.headers["x-goog-api-key"], "test-key");
    assert.ok(!capture.url.includes("test-key"));
    assert.match(capture.url, /models\/gemini-3\.5-flash-lite:generateContent$/);
  } finally {
    restore();
  }
});

test("503 with ai_not_configured when GEMINI_API_KEY is unset (client falls back to local KB)", async () => {
  const res = await handleChat(post({ messages: [{ role: "user", content: BASE_Q }] }), {});
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "ai_not_configured");
});

test("400 on malformed messages payload", async () => {
  for (const payload of [{}, { messages: "x" }, { messages: [] }, { messages: [{ role: "user" }] }]) {
    const res = await handleChat(post(payload), { GEMINI_API_KEY: "k" });
    assert.equal(res.status, 400, JSON.stringify(payload));
  }
  const bad = new Request("https://worker.test/api/chat", { method: "POST", body: "not json" });
  assert.equal((await handleChat(bad, { GEMINI_API_KEY: "k" })).status, 400);
});

test("405 on non-POST", async () => {
  const res = await handleChat(new Request("https://worker.test/api/chat"), { GEMINI_API_KEY: "k" });
  assert.equal(res.status, 405);
});

test("normalizeMessages: caps history at the 12 newest messages and enforces alternation", () => {
  const many = [];
  for (let i = 0; i < 30; i++) many.push({ role: i % 2 ? "assistant" : "user", content: "m" + i });
  const out = normalizeMessages(many);
  assert.ok(out.length <= 12);
  assert.equal(out[out.length - 1].content, "m29"); // newest kept
  for (let i = 1; i < out.length; i++) assert.notEqual(out[i].role, out[i - 1].role);

  const merged = normalizeMessages([
    { role: "assistant", content: "orphan" },
    { role: "user", content: "a" },
    { role: "user", content: "b" },
  ]);
  assert.deepEqual(merged, [{ role: "user", content: "a\nb" }]);
});

test("over-long messages are rejected loudly (413), never silently chopped", async () => {
  const res = await handleChat(
    post({ messages: [{ role: "user", content: "x".repeat(9000) }] }),
    { GEMINI_API_KEY: "k" },
  );
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error, "message_too_long");
  // Content under the limit is preserved intact by normalizeMessages.
  const out = normalizeMessages([{ role: "user", content: "x".repeat(5000) }]);
  assert.equal(out[0].content.length, 5000);
});

test("upstream quota exhaustion (429) maps to 502 rate_limited so the client falls back", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  try {
    const res = await handleChat(post({ messages: [{ role: "user", content: BASE_Q }] }), { GEMINI_API_KEY: "k" });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "rate_limited");
  } finally {
    globalThis.fetch = real;
  }
});

test("buildGeminiRequest: model override is honored", () => {
  const r = buildGeminiRequest([{ role: "user", content: "q" }], "gemini-3.1-flash-lite");
  assert.match(r.url, /models\/gemini-3\.1-flash-lite:/);
});
