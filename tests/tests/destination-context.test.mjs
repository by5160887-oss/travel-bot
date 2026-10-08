import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareChat,buildGeminiRequest} from '../chat-core.js';
import {scopeDestinationHistory} from '../destination-context.js';
import {fallbackAnswer,travelSlots,isHotelPriceQuery,hotelPriceGuidance} from '../fallback.js';
import handler from '../api/chat.js';
const user=content=>({role:'user',content});
const old=[user('יפן 11 ימים'),{role:'assistant',content:'יפן וארצות הברית'},user('מלון ביפן 2027-01-01 2027-01-05 2 מבוגרים ללא ילדים 1 חדרים')];
test('explicit Thailand switch drops another country and its dates, including misspellings',()=>{
 for(const name of ['תאילנד','תילאנד','תאילאנד','Thailand']){
 const m=[...old,user('מלון ב'+name)];assert.equal(prepareChat({messages:m}).messages.length,1);
 const slots=travelSlots(m);assert.ok(['תאילנד','thailand'].includes(slots.destination));assert.deepEqual(slots.dates,[]);
 const r=fallbackAnswer(m);assert.doesNotMatch(r.reply,/יפן|ארצות הברית/);
 }
});
test('follow-up, same-country and multi-country comparisons preserve context',()=>{
 for(const q of ['כמה ימים אמרתי?','מלונות ביפן','השווה יפן ותאילנד']){const m=[...old,user(q)];assert.equal(scopeDestinationHistory(m).length,m.length)}
});
test('model request explicitly scopes the current country',()=>{
 const text=buildGeminiRequest([user('מה יש לעשות בתאילנד')],'mock').body.system_instruction.parts[0].text;assert.match(text,/יעד השאלה הנוכחית: תאילנד/);
});
test('browser network errors use the shared safe fallback, not first KB substring',()=>{
 const html=fs.readFileSync(new URL('../1-index.html',import.meta.url),'utf8');assert.match(html,/import\('\.\/fallback\.js'\)/);assert.doesNotMatch(html,/const hit=KB.find/);
 assert.doesNotMatch(fallbackAnswer([user('האם צריך esta לתאילנד')]).reply,/ארצות הברית|ESTA/);
});
test('hotel prices have no guessed quote and keep exact affiliate link',()=>{
 for(const q of ['מחיר מלון בתאילנד','כמה עולה מלון בפוקט','hotel price Thailand']){
 assert.equal(isHotelPriceQuery([user(q)]),true);const r=hotelPriceGuidance([user(q)]);assert.equal(r.liveInventory,false);assert.equal(r.researchStatus,'travelor_inventory_not_connected');assert.match(r.reply,/fid=84016/);assert.deepEqual(r.sources,[]);
 }
 assert.equal(isHotelPriceQuery([user('מה זה מחיר non refundable')]),false);
 assert.equal(isHotelPriceQuery([user('מלון בתאילנד'),user('כמה עולה?')]),true);
});
test('Vercel blocks unverified hotel prices before calling any provider',async()=>{
 const fetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Provider must not run')};
 try{const res={status(n){this.code=n;return this},json(p){this.payload=p;return this}};await handler({method:'POST',body:{messages:[user('מחיר מלון בתאילנד')]}},res);assert.equal(res.code,200);assert.equal(res.payload.liveInventory,false);assert.equal(res.payload.researchStatus,'travelor_inventory_not_connected')}finally{globalThis.fetch=fetch}
});

test('budget and family details cannot override the country or leak previous dates',()=>{
 const m=[user('יפן 11 ימים'),{role:'assistant',content:'יפן וארצות הברית'},user('תבנה לי מסלול של שבועיים בתילאנד בתקציב של $500 לאדם לזוג פלוס 2')];
 const prepared=prepareChat({messages:m});assert.equal(prepared.messages.length,1);assert.match(prepared.messages[0].content,/תאילנד/);assert.match(prepared.messages[0].content,/\$500/);assert.match(prepared.messages[0].content,/זוג פלוס 2/);
});
