// Pure helpers for the Gupshup WhatsApp sandbox adapter.
// No credentials are committed: all provider values are supplied at runtime.

export const HISTORY_TTL_MS = 30 * 60 * 1000;
export const DELIVERY_TTL_MS = 60 * 60 * 1000;
export const MAX_STORED_MESSAGES = 10;
export const GUPSHUP_MESSAGE_URL = "https://api.gupshup.io/wa/api/v1/msg";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseInboundText(body) {
  if (!body || body.type !== "message") return null;
  const p = body.payload || {};
  const text = clean(p.payload?.text || p.text);
  const sender = clean(p.source || p.sender?.phone || p.sender);
  if (!text || !sender) return null;
  return { sender, text, id: clean(p.id || body.id) || `${sender}:${body.timestamp || ""}:${text}` };
}

export function createConversationStore({ now = Date.now, ttlMs = HISTORY_TTL_MS, maxMessages = MAX_STORED_MESSAGES } = {}) {
  const conversations = new Map();
  return {
    get(sender) {
      const item = conversations.get(sender);
      if (!item || now() - item.updatedAt > ttlMs) {
        conversations.delete(sender);
        return [];
      }
      return item.messages.map((message) => ({ ...message }));
    },
    append(sender, ...messages) {
      const current = this.get(sender);
      conversations.set(sender, {
        updatedAt: now(),
        messages: [...current, ...messages].slice(-maxMessages),
      });
    },
  };
}

export function createDeliveryCache({ now = Date.now, ttlMs = DELIVERY_TTL_MS } = {}) {
  const deliveries = new Map();
  return {
    seen(id) {
      if (deliveries.has(id) && now() - deliveries.get(id) <= ttlMs) return true;
      deliveries.set(id, now());
      for (const [key, value] of deliveries) if (now() - value > ttlMs) deliveries.delete(key);
      return false;
    },
    forget(id) { deliveries.delete(id); },
  };
}

export function buildTravelBotRequest(messages) {
  return { messages };
}

export function buildGupshupForm({ source, destination, appName, text }) {
  const form = new URLSearchParams();
  form.set("channel", "whatsapp");
  form.set("source", source);
  form.set("destination", destination);
  form.set("src.name", appName);
  form.set("message", JSON.stringify({ type: "text", text }));
  return form;
}

export async function requestTravelBotReply({ fetchImpl = fetch, endpoint, messages }) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildTravelBotRequest(messages)),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !clean(body.reply)) throw new Error(body.error || `travel_bot_${response.status}`);
  return body.reply;
}

export async function sendGupshupText({ fetchImpl = fetch, apiKey, source, destination, appName, text }) {
  const response = await fetchImpl(GUPSHUP_MESSAGE_URL, {
    method: "POST",
    headers: { apikey: apiKey, "content-type": "application/x-www-form-urlencoded" },
    body: buildGupshupForm({ source, destination, appName, text }),
  });
  if (!response.ok) throw new Error(`gupshup_${response.status}`);
}
