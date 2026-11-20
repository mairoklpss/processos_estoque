import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createDatabase, seedDatabaseIfEmpty } from '../server/db.ts';
import { adaptSqlite, type AsyncDatabase } from '../server/database.ts';
import { requestTransactions } from '../server/request-transactions.ts';
import { createApp } from '../server/app.ts';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('Cancelamento antes de adquirir transação não executa o handler',async()=>{
  const raw=createDatabase(':memory:'); const base=adaptSqlite(raw);
  let enter!:()=>void; const entered=new Promise<void>(resolve=>enter=resolve);
  let release!:()=>void; const gate=new Promise<void>(resolve=>release=resolve);
  const slow:AsyncDatabase={...base,transaction:async(work,options)=>{enter();await gate;return base.transaction(work,options);}};
  const {middleware}=requestTransactions(slow);let executions=0;
  const app=express();app.use(middleware);app.post('/probe',(_req,res)=>{executions++;res.json({ok:true});});
  const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try{
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const req=http.request({host:'127.0.0.1',port:address.port,path:'/probe',method:'POST'});req.on('error',()=>{});req.end();
    await entered;req.destroy();await delay(30);release();await delay(80);
    assert.equal(executions,0);
  }finally{release();await new Promise<void>(resolve=>server.close(()=>resolve()));await base.close();}
});

test('Logins abortados consomem o orçamento de falhas em vez de liberá-lo',async()=>{
  const raw=createDatabase(':memory:');seedDatabaseIfEmpty(raw);const base=adaptSqlite(raw);
  let signal:(()=>void)|undefined;
  const slow:AsyncDatabase={...base,transaction:(work,options)=>base.transaction(tx=>work({...tx,get:async(sql,...params)=>{
    if(sql.includes('FROM usuarios WHERE LOWER(username)')){signal?.();await delay(40);}
    return tx.get(sql,...params);
  }}),options)};
  const app=createApp(slow);const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try{
    const address=server.address();assert.ok(address&&typeof address!=='string');
    for(let i=0;i<5;i++){
      const entered=new Promise<void>(resolve=>signal=resolve);
      const body=JSON.stringify({username:'coordenador',password:'QA incorrect password'});
      const req=http.request({host:'127.0.0.1',port:address.port,path:'/api/auth/login',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'X-Requested-With':'Brasilink'}});
      req.on('error',()=>{});req.end(body);await entered;req.destroy();await delay(80);
    }
    const r=await fetch(`http://127.0.0.1:${address.port}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'Brasilink'},body:JSON.stringify({username:'coordenador',password:'QA incorrect password'})});
    assert.equal(r.status,429);
    assert.equal((raw.prepare('SELECT COUNT(*) AS c FROM sessoes').get() as {c:number}).c,0);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await base.close();}
});
