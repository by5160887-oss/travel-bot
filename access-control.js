// Server-only durable auth and counters. Secrets are environment values only.
export class AccessError extends Error { constructor(error,status=503){super(error);this.error=error;this.status=status} }
export function limit(v,d){if(v===undefined||v==='')return d;const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>1000000)throw new AccessError('access_not_configured');return n}
export function day(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)}
export async function digest(code){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export const LUA=`
local raw=redis.call('GET',KEYS[1]);if not raw then return {'unauthorized'} end
local ok,u=pcall(cjson.decode,raw)
if not ok or type(u)~='table' or u.enabled~=true or type(u.id)~='string' or not string.match(u.id,'^[%w_-]+$') or #u.id>64 then return {'unauthorized'} end
if ARGV[8]~='' and u.id~=ARGV[8] then return {'unauthorized'} end
if u.expiresAt~=nil and (type(u.expiresAt)~='number' or u.expiresAt<=tonumber(ARGV[9])) then return {'unauthorized'} end
local kind=ARGV[1];local ul=tonumber(ARGV[4]);local gl=tonumber(ARGV[5]);local keys={};local limits={}
if kind=='question' then
 if u.dailyLimit~=nil then
  if type(u.dailyLimit)~='number' or u.dailyLimit<1 or u.dailyLimit>1000000 or u.dailyLimit~=math.floor(u.dailyLimit) then return {'unauthorized'} end
  ul=math.min(ul,u.dailyLimit)
 end
 keys={ARGV[2]..':u:'..u.id..':q',ARGV[2]..':g:q',ARGV[3]..':u:'..u.id,ARGV[3]..':g'};limits={ul,gl,tonumber(ARGV[6]),60}
elseif kind=='check' then keys={ARGV[3]..':u:'..u.id,ARGV[3]..':g'};limits={tonumber(ARGV[6]),60}
elseif kind=='gemini' or kind=='search' then keys={ARGV[2]..':u:'..u.id..':'..kind,ARGV[2]..':g:'..kind};limits={ul,gl}
else return {'access_not_configured'} end
for i,k in ipairs(keys) do if tonumber(redis.call('GET',k) or '0')>=limits[i] then return {(kind=='check' or (kind=='question' and i>2)) and 'request_rate_limited' or 'daily_limit_reached'} end end
for i,k in ipairs(keys) do redis.call('INCR',k);redis.call('EXPIRE',k,(kind=='check' or (kind=='question' and i>2)) and 120 or 172800) end
return {'ok',u.id}
`;
export function createGuard(env,headers,fetchImpl=globalThis.fetch,now=()=>new Date()){
 let hash,id='',error=null;
 async function reserve(kind){try{
 const auth=typeof headers?.get==='function'?headers.get('authorization'):headers?.authorization;
 if(typeof auth!=='string'||!/^Bearer [A-Za-z0-9_-]{32,128}$/.test(auth))throw new AccessError('unauthorized',401);
 if(!/^https:\/\/[A-Za-z0-9-]+\.upstash\.io\/?$/.test(env.UPSTASH_REDIS_REST_URL||'')||!env.UPSTASH_REDIS_REST_TOKEN)throw new AccessError('access_not_configured');
 hash ||= await digest(auth.slice(7));const at=now();
 const uq=limit(env.BOT_USER_DAILY_QUESTIONS,30),gq=limit(env.BOT_GLOBAL_DAILY_QUESTIONS,300);
 const ul=kind==='gemini'?limit(env.BOT_USER_DAILY_GEMINI_CALLS,120):kind==='search'?limit(env.BOT_USER_DAILY_SEARCH_CALLS,30):uq;
 const gl=kind==='gemini'?limit(env.BOT_GLOBAL_DAILY_GEMINI_CALLS,1200):kind==='search'?limit(env.BOT_GLOBAL_DAILY_SEARCH_CALLS,300):gq;
 const r=await fetchImpl(env.UPSTASH_REDIS_REST_URL,{method:'POST',headers:{authorization:`Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(['EVAL',LUA,1,'tb:v1:code:'+hash,kind,'tb:v1:'+day(at),'tb:v1:minute:'+Math.floor(at.getTime()/60000),ul,gl,limit(env.BOT_USER_MINUTE_REQUESTS,6),'',id,at.getTime()]),signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw new AccessError('access_store_unavailable');const p=await r.json();
 if(p.error||!Array.isArray(p.result))throw new AccessError('access_store_unavailable');
 const [status,user]=p.result;
 if(status!=='ok')throw new AccessError(['unauthorized','daily_limit_reached','request_rate_limited'].includes(status)?status:'access_store_unavailable',status==='unauthorized'?401:['daily_limit_reached','request_rate_limited'].includes(status)?429:503);
 if(typeof user!=='string'||!/^[\w-]{1,64}$/.test(user))throw new AccessError('access_store_unavailable');id=user;
 }catch(e){error=e instanceof AccessError?e:new AccessError('access_store_unavailable');throw error}}
 return {reserve,get error(){return error},fetch:kind=>async(...args)=>{await reserve(kind);return fetchImpl(...args)}};
}
