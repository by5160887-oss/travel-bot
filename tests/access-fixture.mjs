export const TEST_CODE='test_only_code_0123456789abcdefghij';
export const TEST_HEADERS={authorization:'Bearer '+TEST_CODE};
export const TEST_ENV={UPSTASH_REDIS_REST_URL:'https://test.upstash.io',UPSTASH_REDIS_REST_TOKEN:'fake'};
export function redisReply(url){return String(url).includes('test.upstash.io')?{ok:true,json:async()=>({result:['ok','test-user']})}:null}
