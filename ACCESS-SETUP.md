# Access/caps draft: no live approval

Dedicated Upstash Redis Free database required before activation. No card, paid
upgrade or automatic billing. No service/account has been created in this PR.
Free route source: https://upstash.com/docs/redis/overall/billing . Quota exhaustion
or storage outage rejects provider calls rather than using memory counters.

Server-only preview variables: UPSTASH_REDIS_REST_URL and secret
UPSTASH_REDIS_REST_TOKEN. Never store secrets in GitHub, chat, screenshots or
public environment variables. Personal codes are generated from at least 32
cryptographically random bytes (base64url). Redis key tb:v1:code:<SHA-256(code)>
contains JSON {"id":"stable-subscriber-id","enabled":true}. No plaintext code,
chat or phone is stored in Redis. Optional dailyLimit can lower question limit;
expiresAt is epoch milliseconds. Revoke with enabled=false. Every provider
reservation rechecks it. In-flight calls cannot be recalled after revocation.

Reuse the subscriber id when rotating codes and revoke all old ones; otherwise
new ids reset per-user counters. Codes can still be shared, sharing the quota.
There is no public management endpoint. Subscriber provisioning/distribution
requires separate secure setup and user permission, not this PR's publication.

Defaults, all configurable positive integers:
BOT_USER_DAILY_QUESTIONS=30; BOT_GLOBAL_DAILY_QUESTIONS=300
BOT_USER_DAILY_GEMINI_CALLS=120; BOT_GLOBAL_DAILY_GEMINI_CALLS=1200
BOT_USER_DAILY_SEARCH_CALLS=30; BOT_GLOBAL_DAILY_SEARCH_CALLS=300
BOT_USER_MINUTE_REQUESTS=6; global minute burst 60.

Atomic Lua checks all counters and increments together. Daily buckets use
Asia/Jerusalem. TTL 48 hours for daily counters and 120 seconds for minute ones.
Provider attempts include continuation, proofreading, backup-key retries and
search calls. They consume budget even if upstream fails. They are call caps,
not a guaranteed shekel spending limit or protection for other apps sharing keys.
Unauthenticated traffic can still consume hosting resources; invalid random
well-shaped codes use storage lookups and may exhaust free storage allowance.

Client no longer trusts an old browser 'ok' flag. API auth is enforced server-side
on both current and legacy handlers and Worker mirrors. The shared code is
removed from current HTML but permanently exposed in Git history; never reuse it.
Old cached clients will need refresh and a new code. No automatic browser fallback
on access denial, cap or storage unavailability.

Gupshup webhook intentionally pauses with 503 and makes no AI/paid send until
reviewed durable phone-to-subscriber mapping is added. The sandbox won't answer
when deployed. Warn users before final approval; webhook retries may continue,
so disconnecting it during migration may be necessary. No quiet service-code bypass.

Review order: free preview storage and test subscribers, real Upstash EVAL check,
concurrency tests, mobile screenshots, refresh/migration, then explicit approval
before merge. This PR conflicts with QA upgrade #23 in shared handlers/client;
combine and re-run all tests in a review branch before either live rollout.

151 local tests including actual Redis concurrency passed. No real Gemini/Tavily
calls made. Hosted preview/service integration is not verified by local tests.
