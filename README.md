# travel-bot
Travel Bot - Hebrew travel knowledge assistant

## Architecture (feature/ai-chat-flow branch)

- `1-index.html` — the chat UI. It first tries the AI endpoint (`POST /api/chat`)
  with the conversation history; if the endpoint is missing, unreachable, or
  returns an error (e.g. GitHub Pages static hosting, or `ANTHROPIC_API_KEY`
  not set), it falls back to the built-in keyword knowledge base, so the page
  keeps working exactly as before in any static deployment.
- `api/chat.js` — serverless function (Vercel-style Node runtime) that calls
  the Anthropic Messages API. Requires `ANTHROPIC_API_KEY`; optional
  `AI_MODEL` override (default `claude-sonnet-4-5`). Not active on GitHub
  Pages; deploying it requires a hosting decision and a paid provider
  credential — both pending owner approval.
- `tests/chat.test.mjs` — zero-dependency regression tests (`npm test`,
  Node 18+). Covers the reported bug scenario: a base baggage question
  followed by a materially different follow-up must get its own specific
  answer, with history passed as context and the newest question last.
