import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createConfiguredConversationStore, createRedisConversationStore } from '../redis-memory.js';

const url = 'https://memory-test.upstash.io';
const token = 'test-only-not-a-secret';
function database() {
  const values = new Map(); const calls = []; let now = 0;
  return {
    values, calls, advance(ms) { now += ms; },
    async fetchImpl(endpoint, options) {
      assert.equal(endpoint, url + '/');
      assert.equal(options.headers.authorization, `Bearer ${token}`);
      assert.ok(options.signal);
      const args = JSON.parse(options.body); calls.push(args);
      const k = args[args[0] === 'GET' ? 1 : 3];
      let item = values.get(k);
      if (item && item.expires <= now) { values.delete(k); item = null; }
      if (args[0] === 'GET') return Response.json({ result: item?.raw ?? null });
      assert.equal(args[0], 'EVAL');
      assert.match(args[1], /redis.call\('SET'.*'EX'/);
      const history = item ? JSON.parse(item.raw) : [];
      const merged = [...history, ...JSON.parse(args[4])].slice(-Number(args[5]));
      values.set(k, { raw: JSON.stringify(merged), expires: now + Number(args[6]) * 1000 });
      return Response.json({ result: 1 });
    },
  };
}

test('cross-instance memory, sender isolation, hashed keys, ten-message cap, TTL renewal', async () => {
  const db = database(); const opts = { url, token, fetchImpl: db.fetchImpl };
  const a = createRedisConversationStore(opts), b = createRedisConversationStore(opts);
  assert.deepEqual(await a.get('sender-a'), []);
  await a.append('sender-a', { role: 'user', content: 'שלום' });
  assert.equal((await b.get('sender-a'))[0].content, 'שלום');
  assert.deepEqual(await b.get('sender-b'), []);
  for (let i = 0; i < 12; i++) await b.append('sender-a', { role: 'assistant', content: String(i) });
  assert.equal((await a.get('sender-a')).length, 10);
  assert.equal((await a.get('sender-a'))[0].content, '2');
  const k = [...db.values.keys()][0];
  assert.match(k, /^travel-bot:wa:history:v1:[a-f0-9]{64}$/);
  db.advance(1799000);
  await b.append('sender-a', { role: 'user', content: 'renewed' });
  db.advance(1799000);
  assert.equal((await a.get('sender-a')).at(-1).content, 'renewed');
  db.advance(1001);
  assert.deepEqual(await a.get('sender-a'), []);
});

test('no configured credentials preserves old local store; partial credentials fail', async () => {
  const local = createConfiguredConversationStore({});
  await local.append('a', { role: 'user', content: 'local' });
  assert.equal((await local.get('a'))[0].content, 'local');
  assert.throws(() => createConfiguredConversationStore({ UPSTASH_REDIS_REST_URL: url }), /configuration_invalid/);
  assert.throws(() => createConfiguredConversationStore({ UPSTASH_REDIS_REST_TOKEN: token }), /configuration_invalid/);
  for (const bad of ['http://memory-test.upstash.io', 'https://upstash.io.evil.test', url + '?token=x', 'https://user:pass@memory-test.upstash.io']) {
    assert.throws(() => createRedisConversationStore({ url: bad, token }), /configuration_invalid/);
  }
});

test('outages, provider errors and malformed history produce sanitized errors', async () => {
  for (const fetchImpl of [async () => { throw new Error(token + url); },
    async () => new Response(token, { status: 401 }),
    async () => Response.json({ error: token }),
    async () => Response.json({ missing: true })]) {
    const s = createRedisConversationStore({ url, token, fetchImpl });
    await assert.rejects(s.get('a'), { message: 'redis_memory_unavailable' });
    await assert.rejects(s.append('a', { role: 'user', content: 'x' }), { message: 'redis_memory_unavailable' });
  }
  for (const raw of ['invalid', '{}', '[{"role":"system","content":"x"}]']) {
    const s = createRedisConversationStore({ url, token, fetchImpl: async () => Response.json({ result: raw }) });
    await assert.rejects(s.get('a'), { message: 'redis_memory_history_invalid' });
  }
});

test('webhook awaits history reads and writes inside its retry-safe catch', () => {
  const source = readFileSync(new URL('../api/gupshup-webhook.js', import.meta.url), 'utf8');
  assert.match(source, /try \{\s*conversations \|\|= createConfiguredConversationStore\(\);\s*const history = await conversations.get/);
  assert.match(source, /await conversations.append/);
});
