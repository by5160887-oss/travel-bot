import {
  createDeliveryCache,
  parseInboundText,
  requestTravelBotReply,
  sendGupshupText,
} from "../gupshup-adapter.js";

import { createConfiguredConversationStore } from "../redis-memory.js";

// No credentials keeps the existing warm-instance behavior. Redis-configured
// deployments share the same short-lived sender history across cold starts.
let conversations;
const deliveries = createDeliveryCache();

function configured() {
  return ["GUPSHUP_API_KEY", "GUPSHUP_APP_NAME", "GUPSHUP_SOURCE_NUMBER", "GUPSHUP_WEBHOOK_TOKEN"]
    .every((name) => Boolean(process.env[name]));
}

function webhookToken(req) {
  const queryToken = Array.isArray(req.query?.token) ? req.query.token[0] : req.query?.token;
  return req.headers["x-webhook-token"] || queryToken || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!configured()) return res.status(503).json({ error: "gupshup_not_configured" });
  if (webhookToken(req) !== process.env.GUPSHUP_WEBHOOK_TOKEN) return res.status(401).json({ error: "unauthorized" });

  const inbound = parseInboundText(req.body);
  // Delivery receipts, non-text messages and provider events are acknowledged.
  if (!inbound) return res.status(200).json({ accepted: true, ignored: true });
  if (deliveries.seen(inbound.id)) return res.status(200).json({ accepted: true, duplicate: true });

  try {
    conversations ||= createConfiguredConversationStore();
    const history = await conversations.get(inbound.sender);
    const messages = [...history, { role: "user", content: inbound.text }];
    const origin = process.env.TRAVEL_BOT_BASE_URL || `https://${req.headers.host}`;
    const reply = await requestTravelBotReply({ endpoint: new URL("/api/chat", origin).toString(), messages });
    await sendGupshupText({
      apiKey: process.env.GUPSHUP_API_KEY,
      source: process.env.GUPSHUP_SOURCE_NUMBER,
      destination: inbound.sender,
      appName: process.env.GUPSHUP_APP_NAME,
      text: reply,
    });
    await conversations.append(inbound.sender, { role: "user", content: inbound.text }, { role: "assistant", content: reply });
    return res.status(200).json({ accepted: true });
  } catch (error) {
    deliveries.forget(inbound.id);
    console.error("gupshup_webhook_failed", error?.message || error);
    // A non-2xx makes Gupshup retry; successful delivery IDs prevent duplicate replies on a warm instance.
    return res.status(502).json({ error: "reply_failed" });
  }
}
