import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/chat.js";

function makeReq() {
  return { method: "POST", body: { messages: [{ role: "user", content: "מה זה overbooking?" }] } };
}

function makeRes() {
  return {
    code: 0,
    payload: null,
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

async function withKeys(primary, backup, fn) {
  const before = { primary: process.env.GEMINI_API_KEY, backup: process.env.GEMINI_API_KEY_BACKUP };
  process.env.GEMINI_API_KEY = primary;
  if (backup) process.env.GEMINI_API_KEY_BACKUP = backup; else delete process.env.GEMINI_API_KEY_BACKUP;
  try { await fn(); } finally {
    if (before.primary === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = before.primary;
    if (before.backup === undefined) delete process.env.GEMINI_API_KEY_BACKUP; else process.env.GEMINI_API_KEY_BACKUP = before.backup;
  }
}

test("Vercel chat retries quota and availability failures with the backup key", async () => {
  for (const failedStatus of [429, 503]) {
    await withKeys("primary", "backup", async () => {
      const realFetch = globalThis.fetch;
      const keys = [];
      globalThis.fetch = async (_url, options) => {
        keys.push(options.headers["x-goog-api-key"]);
        if (keys.length === 1) return { ok: false, status: failedStatus };
        return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "אוברבוקינג הוא מכירת יתר." }] } }] }) };
      };
      try {
        const res = makeRes();
        await handler(makeReq(), res);
        assert.equal(res.code, 200);
        assert.deepEqual(keys.slice(0, 2), ["primary", "backup"]);
      } finally { globalThis.fetch = realFetch; }
    });
  }
});

test("Vercel chat leaves non-quota errors to the existing client fallback", async () => {
  await withKeys("primary", "backup", async () => {
    const realFetch = globalThis.fetch;
    const keys = [];
    globalThis.fetch = async (_url, options) => {
      keys.push(options.headers["x-goog-api-key"]);
      return { ok: false, status: 400 };
    };
    try {
      const res = makeRes();
      await handler(makeReq(), res);
      assert.equal(res.code, 502);
      assert.deepEqual(keys, ["primary"]);
    } finally { globalThis.fetch = realFetch; }
  });
});
