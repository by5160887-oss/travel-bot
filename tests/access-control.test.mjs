import test from 'node:test';import assert from 'node:assert/strict';
import {createGuard,digest,day,limit} from '../access-control.js';
import {TEST_ENV,TEST_HEADERS} from './access-fixture.mjs';
import handler from '../api/chat.js';import legacy from '../api/4-chat.js';import webhook from '../api/gupshup-webhook.js';
const ok=()=>({ok:true,json:async()=>({result:['ok','u1']})});
const res=()=>({code:0,status(n){this.code=n;return this},json(p){this.body=p;return this}});
test('missing, malformed and old client ok flag deny without network',async()=>{
 for(const h of [{},{authorization:'ok'},{authorization:'Bearer short'}]){let calls=0;const g=createGuard(TEST_ENV,h,async()=>{calls++;return ok()});await assert.rejects(g.reserve('question'),e=>e.status===401);assert.equal(calls,0)}
});
test('no config, storage outage and denial fail closed',async()=>{
 for(const p of [{ok:false},{ok:true,json:async()=>({error:'fail'})},{ok:true,json:async()=>({result:['daily_limit_reached']})},{ok:true,json:async()=>({result:['unauthorized']})}]){
 let providers=0;const g=createGuard(TEST_ENV,TEST_HEADERS,async url=>{if(String(url).includes('upstash'))return p;providers++});await assert.rejects(g.fetch('gemini')('https://provider.invalid'));assert.equal(providers,0)}
 await assert.rejects(createGuard({},TEST_HEADERS).reserve('question'),e=>e.status===503);
 assert.throws(()=>limit('0',30));assert.equal(limit(undefined,30),30);
});
test('each actual provider call rechecks revocation and spends durable budget',async()=>{
 let n=0,calls=0;const commands=[];const g=createGuard(TEST_ENV,TEST_HEADERS,async(url,o)=>{if(String(url).includes('upstash')){commands.push(JSON.parse(o.body));n++;return n<=2?ok():{ok:true,json:async()=>({result:['unauthorized']})}}calls++;return {ok:true}});
 await g.reserve('question');await g.fetch('gemini')('https://provider.invalid');await assert.rejects(g.fetch('gemini')('https://provider.invalid'),e=>e.status===401);assert.equal(calls,1);
 assert.deepEqual(commands.map(c=>c[4]),['question','gemini','gemini']);assert.equal(commands[0][7],30);assert.equal(commands[0][8],300);assert.equal(commands[1][7],120);assert.equal(commands[1][8],1200);assert.equal(commands[1][11],'u1');
 assert.ok(commands[0][3].endsWith(await digest(TEST_HEADERS.authorization.slice(7))));
});
test('Jerusalem daily reset uses daylight and winter midnight',()=>{assert.equal(day(new Date('2026-10-05T21:00:00Z')),'2026-10-06');assert.equal(day(new Date('2026-12-01T22:00:00Z')),'2026-12-02')});
test('legacy and WhatsApp routes are not exemptions',async()=>{
 const saved=process.env.GEMINI_API_KEY,real=globalThis.fetch;process.env.GEMINI_API_KEY='fake';let n=0;globalThis.fetch=async()=>{n++;throw 0};try{
 for(const h of [handler,legacy]){const r=res();await h({method:'POST',body:{messages:[{role:'user',content:'מה זה HB?'}]}},r);assert.equal(r.code,401)}const w=res();await webhook({method:'POST'},w);assert.equal(w.code,503);assert.equal(n,0);
 }finally{globalThis.fetch=real;if(saved===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=saved}
});
test('continuation proofreading and backup cannot skip provider cap',async()=>{
 const saved={...process.env},real=globalThis.fetch;Object.assign(process.env,TEST_ENV,{GEMINI_API_KEY:'fake',GEMINI_API_KEY_BACKUP:'fake-backup'});
 try{for(const mode of ['continuation','proofreading','backup']){let n=0,providers=0;globalThis.fetch=async url=>{if(String(url).includes('upstash')){n++;return n<=2?ok():{ok:true,json:async()=>({result:['daily_limit_reached']})}}providers++;if(mode==='backup')return {ok:false,status:429};return {ok:true,json:async()=>({candidates:[{finishReason:mode==='continuation'?'MAX_TOKENS':'STOP',content:{parts:[{text:'תשובה'}]}}]})}};
 const r=res();await handler({method:'POST',headers:TEST_HEADERS,body:{messages:[{role:'user',content:'מה זה HB?'}]}},r);assert.equal(r.code,429,mode);assert.equal(providers,1,mode)}}finally{globalThis.fetch=real;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved)}
});
