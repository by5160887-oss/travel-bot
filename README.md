# travel-bot
Travel Bot - Hebrew travel knowledge assistant

## Architecture (feature/ai-chat-flow branch)

- `1-index.html` — the chat UI. It first tries the AI endpoint (`POST /api/chat`)
  with the conversation history; if the endpoint is missing, unreachable, or
  returns an error (e.g. static hosting, no API key, or the free daily quota
  is exhausted), it falls back to the built-in keyword knowledge base — and
  every such fallback answer is visibly labelled "תשובה מבסיס הידע המובנה —
  ה-AI אינו זמין כרגע", so a canned answer is never mistaken for the AI.
  A reply the server flags `truncated` is labelled as cut off and marked in
  the conversation history, never rendered or stored as complete. Messages
  over 8,000 characters are rejected with a visible notice (HTTP 413), never
  silently chopped.
- `chat-core.js` — the single shared chat core used by BOTH backends: the
  Hebrew system prompt, the Gemini request builder, and the `callGemini`
  logic. `callGemini` always checks `candidates[0].finishReason`: on
  `MAX_TOKENS` it sends one server-side continuation turn and joins the
  pieces, and if the answer is still incomplete it returns
  `truncated: true` so the client can label it. Output headroom is
  3,072 tokens (a 10-section analysis used to be cut by the old 800 cap).
- `worker.js` / `api/chat.js` — thin platform adapters over `chat-core.js`
  for Cloudflare Workers (free tier, no card required) and Vercel. The model
  defaults to `gemini-3.5-flash-lite` (free-tier model per the Google AI
  docs; override with the `GEMINI_MODEL` var). The API key lives only as a
  server-side secret (`GEMINI_API_KEY`) and is sent as a header — it never
  reaches the browser or the URL.
- `wrangler.toml` — Worker config; static files are served from the repo root
  via Workers Static Assets, so the HTML and the API live on one free host.
- `tests/chat.test.mjs`, `tests/pwa.test.mjs`, `tests/legal-regression.test.mjs`
  — zero-dependency regression tests (`npm test`, Node 18+). Cover the
  reported bug scenario (a base baggage question followed by a materially
  different follow-up), the legal-reliability audit (the 10-part two-airline
  baggage scenario: complete non-truncated answers, MAX_TOKENS continuation,
  loud 413 on over-long messages, the three distinct Montreal Convention
  clocks, the per-passenger — never per-kg — compensation cap, PIR nuance,
  and the one-ticket/two-ticket fork), a drift guard that keeps both backends
  on the shared core, and the PWA shell.

## Activation (owner steps, not part of this PR)

1. Create a free Cloudflare account and a free Google AI Studio API key
   (neither requires a card).
2. `npx wrangler login`
3. `npx wrangler secret put GEMINI_API_KEY`
4. `npx wrangler deploy`

Notes: the Gemini free tier allows ~500 requests/day for Flash-Lite models;
beyond that the endpoint returns 429 and the chat falls back to the built-in
knowledge base. Free-tier prompts may be used by Google to improve its
products — do not send client personal data through the chat.

## Installable app (PWA)

The chat is installable on Android and iPhone straight from the browser — no
app store, no publication cost:

- `manifest.webmanifest` + `icons/` — standalone display, Hebrew/RTL metadata,
  maskable icon.
- `sw.js` — service worker that caches ONLY the static app shell (HTML,
  manifest, icons). Requests to `/api/` bypass the cache entirely, so no
  question or answer is ever stored, and the API key stays server-side.
  Without network, the cached shell still opens and answers from the built-in
  knowledge base.
- `tests/pwa.test.mjs` — asserts the manifest is installable, the icons exist,
  and the service worker's `/api/` bypass structurally precedes all cache
  reads/writes.

Install: open the deployed URL in Chrome (Android) → "Add to Home screen";
or in Safari (iPhone) → Share → "Add to Home Screen".

## Live research layer (feature/live-research-layer, not deployed)

Questions whose answers can change - hotels, kosher certification, Chabad proximity,
facilities/reviews, airline online check-in, passport and entry rules, prices and
availability - first call Tavily Search from the server. The default is Tavily's
free keyless mode: no account, card or secret. An optional `TAVILY_API_KEY` can be
stored as a Cloudflare/Vercel server secret for the documented free 1,000-credit
monthly tier; it is never sent to the browser or committed.

The model receives numbered HTTPS sources and must separate general knowledge from
facts checked now, cite `[n]`, prefer official sources, and decline unsupported
claims. The response also carries structured source titles/URLs, which the client
renders as clickable links. Search failure is surfaced visibly; it must not be
mistaken for a live-source answer. Search result text is untrusted evidence and any
instructions embedded in it are ignored.

This branch does not claim live inventory or rates. A price or availability claim
still requires the supplier's dated inventory/rate page for the exact dates, party
and child ages. Likewise, Chabad proximity, kosher certification and an in-room
kitchen remain separate facts.

## Gupshup WhatsApp sandbox adapter (preview only)

`POST /api/gupshup-webhook` accepts Gupshup v3 inbound text events, forwards the sender's recent conversation to `/api/chat`, and sends the Travel Bot reply through Gupshup. Recent history is held only in warm-instance memory for 30 minutes (maximum 10 messages per sender); it is deliberately not durable production storage.

Required server-side variables:

- `GUPSHUP_API_KEY`
- `GUPSHUP_APP_NAME` (sandbox app: `YehudaTravelBot`)
- `GUPSHUP_SOURCE_NUMBER` (digits only)
- `GUPSHUP_WEBHOOK_TOKEN` (random secret; configure the callback as `/api/gupshup-webhook?token=...`)
- `TRAVEL_BOT_BASE_URL` (optional; defaults to the deployment origin)

The endpoint ignores receipts and non-text events, deduplicates provider retries while an instance remains warm, commits no secrets, and does not initiate messages. Configure it only on a preview deployment until the owner approves production.
