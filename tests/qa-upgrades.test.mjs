import { TEST_ENV, TEST_HEADERS, redisReply } from "./access-fixture.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isOfficialRequired, authoritativeSources, directoryReply, removeMixedScript, itineraryGaps, onlyNecessaryFollowup, rejectUnsupportedNegative, travelorSteps, officialAnswerHasSupport, NO_OFFICIAL_REPLY } from '../qa-policy.js';
import { needsLiveResearch, classifySource } from '../research.js';
import { callGemini } from '../chat-core.js';
import handler from '../api/chat.js';
const q = content => [{role:'user',content}];
const source={title:'Test source',url:'https://www.elal.com/example-fixture',sourceType:'airline',content:'Synthetic official baggage test source. No actual factual claim.'};
const community={title:'Chabad test',url:'https://chabadprague.cz/en/contact-us-2/',sourceType:'community_official',content:'Address: U Milosrdných 6 Praha 1\nPhone: +420724300120\ninfo@chabadprague.cz'};
test('baggage, visas, law and contextual followup force official live research',()=>{
 for(const question of ['כמה כבודה בוויז?','דרכון ישראלי ליפן','ויזה לארהב','החזר באוברבוקינג','חוק שירותי תעופה','טרולי באל על'])assert.equal(needsLiveResearch(q(question)),true,question);
 assert.equal(isOfficialRequired([...q('כבודה באל על'),...q('אז כמה?')]),true);
 assert.equal(isOfficialRequired([...q('כבודה באל על'),...q('מה ההבדל בין BB ו HB?')]),false);
 assert.equal(authoritativeSources([source,community,{...source,sourceType:'other'}]).length,1);
});
test('official classification denies spoofed host names',()=>{
 assert.equal(classifySource('https://not-really-chabad.example/a'),'other');
 assert.equal(classifySource('https://elal.attacker.example/a'),'other');
 // Existing broad airline regex is tested below after tightening.
});
test('directory preserves only provided phone/address/email and labels missing fields',()=>{
 const reply=directoryReply([source,community]);assert.match(reply,/\+420724300120/);assert.match(reply,/U Milosrdných/);assert.match(reply,/\[2\]/);
 assert.match(directoryReply([{...community,content:'A local center exists.'}]),/לא אומת/);
 assert.match(directoryReply([]),/אינה הוכחה שאין/);
});
test('Thailand never turns missing evidence into proof no kosher hotel exists',()=>{
 const reply=rejectUnsupportedNegative('אין מלון כשר בבנגקוק',q('מלון כשר בבנגקוק'),[source,community]);
 assert.match(reply,/אינה הוכחה/);assert.match(reply,/\[2\]/);
 assert.match(reply,/כשרות הארוחות אינה כשרות/);
});
test('mixed-script corrections are local and preserve normal names, URLs and numbers',()=>{
 assert.equal(removeMixedScript('יכולة לנסוע 21 יום https://example.com'), 'יכולה לנסוע 21 יום https://example.com');
 assert.equal(removeMixedScript('Tokyo Москва مرحبا'), 'Tokyo Москва مرحبا');
 assert.match(removeMixedScript('מילа מוזרה'),/מילה לא ברורה/);
});
test('itinerary validates every day plus practical sections and Shabbat/kosher',()=>{
 assert.ok(itineraryGaps('מסלול כללי בטוקיו',q('יפן 11 ימים')).includes('יום 11'));
 const complete=Array.from({length:11},(_,i)=>`יום ${i+1}\nבוקר: אזור\nצהריים: אתר\nערב: מנוחה\nלינה: באותו אזור`).join('\n')+'\nשבת: ללא נסיעה\nאוכל כשר: בתיאום';
 assert.deepEqual(itineraryGaps(complete,q('יפן 11 ימים')),[]);
 assert.deepEqual(itineraryGaps('ידע',q('כבודה תוך 21 ימים')),[]);
});
test('complete answers do not end in an automatic offer, missing crucial details may remain',()=>{
 assert.equal(onlyNecessaryFollowup('HB הוא חצי פנסיון.\n\nהאם תרצה עזרה נוספת?',q('מה זה HB?')),'HB הוא חצי פנסיון.');
 assert.match(onlyNecessaryFollowup('מידע.\nבאילו תאריכים?',q('מלון כשר בפראג')),/באילו תאריכים/);
});
test('Travelor steps keep owner referral and do not invent private dashboard capabilities',()=>{
 const text=travelorSteps(q('איך מחפשים מלון ב Travelor'));assert.match(text,/fid=84016/);assert.match(text,/אין לי גישה לחשבון הסוכן/);assert.match(text,/גילאי הילדים/);
});
test('uncited numeric official claims are suppressed, citations must exist',()=>{
 assert.equal(officialAnswerHasSupport('23 קג.',[source]),false);
 assert.equal(officialAnswerHasSupport('23 קג [99].',[source]),false);
 assert.equal(officialAnswerHasSupport('23 קג [1].',[source]),true);
});
test('official-source outage blocks Gemini entirely instead of answering from memory',async()=>{
 const real=globalThis.fetch,saved=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test';Object.assign(process.env,TEST_ENV);let calls=0;
 globalThis.fetch=async url=>{if(redisReply(url))return redisReply(url);calls++;assert.ok(String(url).includes('tavily'));return {ok:false,status:429}};
 const res={code:0,status(x){this.code=x;return this},json(x){this.body=x;return this}};
 try{await handler({method:'POST',headers:TEST_HEADERS,body:{messages:q('כמה כבודה בוויז?')}},res);assert.equal(res.body.reply,NO_OFFICIAL_REPLY);assert.equal(calls,1)}
 finally{globalThis.fetch=real;if(saved===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=saved}
});
test('incomplete itinerary gets bounded repair and fails clearly if still incomplete',async()=>{
 let calls=0;const result=await callGemini({apiKey:'fake',messages:q('יפן 11 ימים'),fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'מסלול גנרי בטוקיו'}]}}]})}}});
 assert.equal(result.error,'itinerary_incomplete');assert.equal(calls,4);
});
test('client does not use knowledge-base numeric fallback for official-required questions',()=>{
 const html=readFileSync(new URL('../1-index.html',import.meta.url),'utf8');assert.match(html,/אין כרגע אימות מול מקור רשמי/);assert.match(html,/r.status===503/);
});
