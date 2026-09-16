# travel-bot
Travel Bot - Hebrew travel knowledge assistant

## Architecture (feature/ai-chat-flow branch)

- `1-index.html` — the chat UI. It first tries the AI endpoint (`POST /api/chat`)
  with the conversation history; if the endpoint is missing, unreachable, or
  returns an error (e.g. static hosting, no API key, or the free daily quota
  is exhausted), it falls back to the built-in keyword knowledge base, so the
  page keeps working exactly as before in any static deployment.
- `worker.js` — a Cloudflare Worker (free tier, no card required) that calls
  the Google Gemini API. Model defaults to `gemini-3.5-flash-lite` (free-tier
  model per the Google AI docs; override with the `GEMINI_MODEL` var). The
  API key lives only as a Worker secret (`GEMINI_API_KEY`) and is sent as a
  header — it never reaches the browser or the URL.
- `wrangler.toml` — Worker config; static files are served from the repo root
  via Workers Static Assets, so the HTML and the API live on one free host.
- `tests/chat.test.mjs` — zero-dependency regression tests (`npm test`,
  Node 18+). Covers the reported bug scenario: a base baggage question
  followed by a materially different follow-up must get its own specific
  answer, with history passed as context and the newest question last.

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
