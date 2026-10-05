import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import net from 'node:net';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {LUA} from '../access-control.js';
function command(socket,args){return new Promise((resolve,reject)=>{const c=net.createConnection(socket);let data='';c.on('error',reject);c.on('connect',()=>c.write('*'+args.length+'\r\n'+args.map(x=>{x=String(x);return '$'+Buffer.byteLength(x)+'\r\n'+x+'\r\n'}).join('')));c.on('data',chunk=>{data+=chunk;const a=data.split('\r\n');if(a[0][0]==='+'){c.end();resolve(a[0].slice(1))}if(a[0][0]==='-'){c.end();reject(Error(a[0]))}if(a[0][0]==='*'){const n=Number(a[0].slice(1));if(a.length>=1+n*2+1){c.end();resolve(Array.from({length:n},(_,i)=>a[i*2+2]))}}})})}
test('real Redis enforces concurrent user/global/provider limits and revocation',{skip:!process.env.REDIS_SERVER_BIN},async()=>{
 const dir=mkdtempSync(tmpdir()+'/tb-redis-'),socket=dir+'/s';const child=spawn(process.env.REDIS_SERVER_BIN,['--port','0','--unixsocket',socket,'--save','','--appendonly','no']);
 try{for(let i=0;i<100;i++){try{await command(socket,['PING']);break}catch{await new Promise(r=>setTimeout(r,20))}}
 for(const id of ['a','b'])await command(socket,['SET','code:'+id,JSON.stringify({id,enabled:true})]);
 const run=(id,k='question',d='day1',ul=30,gl=300,expected='')=>command(socket,['EVAL',LUA,1,'code:'+id,k,d,'minute:'+d,ul,gl,100,'',expected,Date.now()]);
 const results=await Promise.all(Array.from({length:50},()=>run('a')));assert.equal(results.filter(x=>x[0]==='ok').length,30);
 assert.deepEqual(await run('b','question','day1',30,30),['daily_limit_reached']);assert.equal((await run('b','question','day1',1,31))[0],'ok');assert.equal((await run('a','question','day2'))[0],'ok');
 const providers=await Promise.all(Array.from({length:20},()=>run('a','gemini','day2',4,4,'a')));assert.equal(providers.filter(x=>x[0]==='ok').length,4);
 assert.deepEqual(await run('a','search','day2',4,4,'b'),['unauthorized']);
 await command(socket,['SET','code:a',JSON.stringify({id:'a',enabled:false})]);assert.deepEqual(await run('a','question','day3'),['unauthorized']);
 await command(socket,['SET','code:a',JSON.stringify({id:'a',enabled:true,expiresAt:Date.now()-1})]);assert.deepEqual(await run('a','question','day3'),['unauthorized']);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));rmSync(dir,{recursive:true,force:true})}
});
