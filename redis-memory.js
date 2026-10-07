import { createHash } from 'node:crypto';
import { createConversationStore, HISTORY_TTL_MS, MAX_STORED_MESSAGES } from './gupshup-adapter.js';

// Atomic append prevents one warm instance overwriting another's saved turns.
const APPEND = `
local messages = {}
local old = redis.call('GET', KEYS[1])
if old then messages = cjson.decode(old) end
local added = cjson.decode(ARGV[1])
for _, message in ipairs(added) do table.insert(messages, message) end
while #messages > tonumber(ARGV[2]) do table.remove(messages, 1) end
redis.call('SET', KEYS[1], cjson.encode(messages), 'EX', ARGV[3])
return 1
`;

function validHistory(messages) {
  return Array.isArray(messages) && messages.length <= MAX_STORED_MESSAGES &&
    messages.every(m => m && ['user', 'assistant'].includes(m.role) &&
      typeof m.content === 'string' && m.content.length <= 200000);
}

export function createRedisConversationStore({ url, token, fetchImpl = fetch,
  ttlMs = HISTORY_TTL_MS } = {}) {
  let endpoint;
  try {
    endpoint = new URL(url);
    if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.upstash.io') ||
        endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        endpoint.pathname !== '/' || !token || !Number.isFinite(ttlMs) || ttlMs <= 0) throw 0;
  } catch { throw new Error('redis_memory_configuration_invalid'); }
  const key = sender => 'travel-bot:wa:history:v1:' +
    createHash('sha256').update(String(sender)).digest('hex');
  async function command(args) {
    try {
      const response = await fetchImpl(endpoint.toString(), {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(args), signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw 0;
      const body = await response.json();
      if (!body || body.error || !Object.hasOwn(body, 'result')) throw 0;
      return body.result;
    } catch { throw new Error('redis_memory_unavailable'); }
  }
  return {
    async get(sender) {
      const raw = await command(['GET', key(sender)]);
      if (raw === null) return [];
      try {
        const messages = JSON.parse(raw);
        if (!validHistory(messages)) throw 0;
        return messages.map(m => ({ role: m.role, content: m.content }));
      } catch { throw new Error('redis_memory_history_invalid'); }
    },
    async append(sender, ...messages) {
      if (!validHistory(messages)) throw new Error('redis_memory_history_invalid');
      await command(['EVAL', APPEND, '1', key(sender), JSON.stringify(messages),
        String(MAX_STORED_MESSAGES), String(Math.ceil(ttlMs / 1000))]);
    },
  };
}

export function createConfiguredConversationStore(env = process.env, options = {}) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url && !token) return createConversationStore();
  // Partial configuration and outages must not silently discard durable memory.
  return createRedisConversationStore({ ...options, url, token });
}
