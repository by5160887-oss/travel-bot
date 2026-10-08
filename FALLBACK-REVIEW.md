# Non-AI fallback review

Branch only, not a live release. No new provider, database, paid dependency or data scraping.

The Vercel server validates input and checks prompt injection even without Gemini keys. Missing keys, provider errors and timed-out generation return a labelled Hebrew non-AI answer. The legacy /api/4-chat route delegates to the canonical handler. Web and existing Gupshup sandbox use /api/chat, so both get the same fallback. Provider attempts have bounded timeout signals. No WhatsApp number/config change.

Knowledge: conservative definitions of overbooking, room types, board basis, non-refundable rates. Current visa, baggage, compensation, kosher and emergency facts are not guessed. Booking guidance collects destination, explicit dates with year, adults, children/ages and rooms without calling inventory. Date-only answers do not resolve relative days. Unknown destinations can be supplied after the destination question or as יעד: ... . The owner link is exactly https://www.travelor.com/he?fid=84016; search is NOT prefilled and live inventory is NOT claimed.

Existing web local fallback remains for backend/network outage. It is not a live price source. WhatsApp still requires a reachable backend/provider. This change adds no authentication scheme; current main's shared-code/client gating remains unchanged and is not suitable for selling secure subscriptions.

## PR25 overlap resolved for this independent review

This branch starts at main after Redis conversation memory PR26, NOT from PR25. It does not merge or activate the separate subscriber-access/budget/QA drafts. Legacy Vercel route consolidation removes the stale second implementation, and new fallback.js is a standalone module.

Do not merge PR25 over this handler unchanged: its missing-key early return must be removed, and its question access guard must execute before fallback returns. Provider budget/access errors must retain 401/403/429/503 and may NOT become a knowledge fallback bypass. Keep its official-source safety gates, directory logic and WhatsApp subscriber-mapping pause. Its web script must display the shared fallback rather than falling back to unsafe cached numeric knowledge. Reconcile both branches in a combined preview with separate owner approval; no such deployment or subscriber migration is part of this PR.

## Review before live

157 local tests pass with mocked providers, including no-key validation/injection, both keys 429, timeout rejection, legacy identity, and a WhatsApp adapter receiving fallback text. No real Gemini/Tavily calls, WhatsApp sends or paid resources used. Hosted preview/mobile and actual sandbox QA remain required. Existing main/production environment has not been changed.
