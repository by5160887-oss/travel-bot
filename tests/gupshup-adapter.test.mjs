import test from "node:test";
import assert from "node:assert/strict";
import {
  GUPSHUP_MESSAGE_URL,
  buildGupshupForm,
  createConversationStore,
  createDeliveryCache,
  parseInboundText,
  requestTravelBotReply,
  sendGupshupText,
} from "../gupshup-adapter.js";

test("parses Gupshup v3 inbound text and ignores events", () => {
  assert.deepEqual(parseInboundText({ type: "message", payload: { id: "m1", source: "972500000000", type: "text", payload: { text: "  שלום  " } } }), { sender: "972500000000", text: "שלום", id: "m1" });
  assert.equal(parseInboundText({ type: "message-event", payload: { source: "9725" } }), null);
  assert.equal(parseInboundText({ type: "message", payload: { source: "9725", type: "image", payload: {} } }), null);
});

test("keeps short sender-scoped history and expires it", () => {
  let clock = 1000;
  const store = createConversationStore({ now: () => clock, ttlMs: 100, maxMessages: 2 });
  store.append("a", { role: "user", content: "1" }, { role: "assistant", content: "2" });
  store.append("a", { role: "user", content: "3" });
  store.append("b", { role: "user", content: "other" });
  assert.deepEqual(store.get("a").map((m) => m.content), ["2", "3"]);
  assert.deepEqual(store.get("b").map((m) => m.content), ["other"]);
  clock = 1101;
  assert.deepEqual(store.get("a"), []);
});

test("deduplicates delivery IDs within the retry window", () => {
  let clock = 0;
  const cache = createDeliveryCache({ now: () => clock, ttlMs: 10 });
  assert.equal(cache.seen("m1"), false);
  assert.equal(cache.seen("m1"), true);
  clock = 11;
  assert.equal(cache.seen("m1"), false);
});

test("builds Gupshup sandbox send form", () => {
  const form = buildGupshupForm({ source: "917000000000", destination: "972500000000", appName: "YehudaTravelBot", text: "שלום" });
  assert.equal(form.get("channel"), "whatsapp");
  assert.equal(form.get("src.name"), "YehudaTravelBot");
  assert.deepEqual(JSON.parse(form.get("message")), { type: "text", text: "שלום" });
});

test("calls Travel Bot API and sends reply through Gupshup without exposing credentials", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === "https://example.test/api/chat") return new Response(JSON.stringify({ reply: "תשובה" }), { status: 200 });
    return new Response("ok", { status: 200 });
  };
  const reply = await requestTravelBotReply({ fetchImpl, endpoint: "https://example.test/api/chat", messages: [{ role: "user", content: "שאלה" }] });
  await sendGupshupText({ fetchImpl, apiKey: "secret", source: "917", destination: "972", appName: "YehudaTravelBot", text: reply });
  assert.equal(reply, "תשובה");
  assert.equal(calls[1].url, GUPSHUP_MESSAGE_URL);
  assert.equal(calls[1].options.headers.apikey, "secret");
  assert.equal(calls[1].options.body.get("destination"), "972");
});
