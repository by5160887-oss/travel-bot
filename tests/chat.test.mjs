// Zero-dependency regression tests for api/chat.js — run with: npm test
// (node:test is built in; no install step, no network: fetch is mocked).

import test from "node:test";
import assert from "node:assert/strict";
import handler, { SYSTEM_PROMPT, normalizeMessages } from "../api/chat.js";

// The exact scenario from the bug report: a base delayed-baggage question,
// the generic checklist it received, then a materially different specific
// follow-up (the 21-day rule).
const BASE_Q = "מה עושים כשכבודה לא הגיעה?";
const BASE_A = "כשכבודה לא מגיעה: 1. פותחים דו״ח PIR... 2. שומרים תג כבודה...";
const FOLLOWUP_Q = "מה כלל ה-21 יום באיחור כבודה?";
const FOLLOWUP_A =
  "כלל ה-21 יום: לפי אמנת מונטריאול, כבודה שלא נמסרה בתוך 21 יום נחשבת אבודה...";

function mockRes() {
  return {
    code: null,
    payload: null,
    status(c) { this.code = c; return this; },
    json(o) { this.payload = o; return this; },
  };
}

function withMockUpstream(capture, replyText = FOLLOWUP_A) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    capture.url = url;
    capture.body = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: "text", text: replyText }] }),
    };
  };
  return () => { globalThis.fetch = real; };
}

test("regression: base baggage question then specific follow-up — the follow-up is what gets answered", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const capture = {};
  const restore = withMockUpstream(capture);
  try {
    const res = mockRes();
    await handler(
      {
        method: "POST",
        body: {
          messages: [
            { role: "user", content: BASE_Q },
            { role: "assistant", content: BASE_A },
            { role: "user", content: FOLLOWUP_Q },
          ],
        },
      },
      res,
    );

    assert.equal(res.code, 200);
    // 1. The model's specific answer is returned, not the canned checklist.
    assert.equal(res.payload.reply, FOLLOWUP_A);
    assert.notEqual(res.payload.reply, BASE_A);
    // 2. The newest question is the final message sent upstream...
    const sent = capture.body.messages;
    assert.equal(sent[sent.length - 1].role, "user");
    assert.equal(sent[sent.length - 1].content, FOLLOWUP_Q);
    // 3. ...with the earlier turns present as context only.
    assert.equal(sent[0].content, BASE_Q);
    assert.equal(sent[1].content, BASE_A);
    // 4. The system prompt orders newest-question priority...
    assert.match(capture.body.system, /השאלה האחרונה/);
    assert.match(capture.body.system, /אל תחזור על תשובה קודמת/);
    // 5. ...and source-aware handling of changing legal facts.
    assert.match(capture.body.system, /אמנת מונטריאול/);
    assert.match(capture.body.system, /אל תמציא סכומים/);
  } finally {
    restore();
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("503 with ai_not_configured when ANTHROPIC_API_KEY is unset (client falls back to local KB)", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const res = mockRes();
  await handler({ method: "POST", body: { messages: [{ role: "user", content: BASE_Q }] } }, res);
  assert.equal(res.code, 503);
  assert.equal(res.payload.error, "ai_not_configured");
});

test("400 on malformed messages payload", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    for (const body of [{}, { messages: "x" }, { messages: [] }, { messages: [{ role: "user" }] }]) {
      const res = mockRes();
      await handler({ method: "POST", body }, res);
      assert.equal(res.code, 400, JSON.stringify(body));
    }
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("405 on non-POST", async () => {
  const res = mockRes();
  await handler({ method: "GET", body: {} }, res);
  assert.equal(res.code, 405);
});

test("normalizeMessages: caps history at the 12 newest messages and enforces alternation", () => {
  const many = [];
  for (let i = 0; i < 30; i++) many.push({ role: i % 2 ? "assistant" : "user", content: "m" + i });
  const out = normalizeMessages(many);
  assert.ok(out.length <= 12);
  assert.equal(out[out.length - 1].content, "m29"); // newest kept
  for (let i = 1; i < out.length; i++) assert.notEqual(out[i].role, out[i - 1].role);

  // consecutive same-role messages merge, leading assistants drop
  const merged = normalizeMessages([
    { role: "assistant", content: "orphan" },
    { role: "user", content: "a" },
    { role: "user", content: "b" },
  ]);
  assert.deepEqual(merged, [{ role: "user", content: "a\nb" }]);
});

test("normalizeMessages: per-message length cap", () => {
  const out = normalizeMessages([{ role: "user", content: "x".repeat(5000) }]);
  assert.equal(out[0].content.length, 2000);
});

test("upstream failure maps to 502 so the client falls back", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 529, json: async () => ({}) });
  try {
    const res = mockRes();
    await handler({ method: "POST", body: { messages: [{ role: "user", content: BASE_Q }] } }, res);
    assert.equal(res.code, 502);
  } finally {
    globalThis.fetch = real;
    delete process.env.ANTHROPIC_API_KEY;
  }
});
