import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { createDatabase, seedDatabaseIfEmpty, hashPassword } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { privateFiles } from '../server/private-files.ts';

async function fixture() {
  const raw=createDatabase(':memory:'); seedDatabaseIfEmpty(raw);
  const secret=crypto.randomBytes(18).toString('base64url');
  raw.prepare('UPDATE usuarios SET senha_hash=? WHERE id=1').run(hashPassword(secret));
  const server=await new Promise<ReturnType<ReturnType<typeof createApp>['listen']>>(resolve=>{const srv=createApp(raw).listen(0,'127.0.0.1',()=>resolve(srv));});
  const address=server.address(); assert.ok(address && typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  async function req(method:string,url:string,body?:unknown,cookie?:string) {
    const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json','X-Requested-With':'Brasilink',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    return {status:r.status,body:await r.json(),headers:r.headers};
  }
  const login=()=>req('POST','/api/auth/login',{username:'coordenador',password:secret});
  const first=await login();assert.equal(first.status,200);
  const cookie=first.headers.get('set-cookie')!.split(';')[0];
  return {raw,req,login,cookie,async close(){await new Promise<void>(resolve=>server.close(()=>resolve()));raw.close();}};
}

test('Regressão QA-06: bloqueia arquivos privados, /@fs/, caixa e caminhos codificados sem bloquear frontend',async()=>{
  const app=express();app.use(privateFiles);app.use((_req,res)=>res.send('CANARY_CONTENT'));
  const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const srv=app.listen(0,'127.0.0.1',()=>resolve(srv));});
  try{
    const address=server.address();assert.ok(address && typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
    for(const url of ['/.local/backups/probe.sqlite','/.LOCAL/postgres/app.dpapi.xml','/@fs/C:/project/data/probe.sqlite','/server.ts','/server/db.ts','/%2Elocal/backups/probe.sqlite','/%252Elocal/backups/probe.sqlite','/.env.production']) {
      const r=await fetch(base+url);assert.equal(r.status,404,url);assert.notEqual(await r.text(),'CANARY_CONTENT');
    }
    for(const url of ['/src/main.tsx','/node_modules/.vite/deps/react.js'])assert.equal((await fetch(base+url)).status,200);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('Regressão QA-03: schemas idênticos em rotas canônicas, barra final e maiúsculas',async()=>{
  const f=await fixture();try{
    const data={codigo:'QA',nome:'N'.repeat(201),estoqueAtual:1,limiteMaximo:10};
    for(const url of ['/api/coord/itens','/api/coord/itens/','/api/COORD/ITENS/'])assert.equal((await f.req('POST',url,data,f.cookie)).status,400);
    for(const url of ['/api/coord/usuarios?limit=-1','/api/COORD/USUARIOS/?limit=-1'])assert.equal((await f.req('GET',url,undefined,f.cookie)).status,400);
    assert.equal((await f.req('PATCH','/api/coord/itens/%31',{unexpected:true},f.cookie)).status,400);
  }finally{await f.close();}
});

test('Regressão QA-05: sucessos não bloqueiam, falhas continuam limitadas e sessão ativa permanece válida',async()=>{
  const f=await fixture();try{
    for(let i=0;i<6;i++)assert.equal((await f.login()).status,200);
    for(let i=0;i<5;i++)assert.equal((await f.req('POST','/api/auth/login',{username:'coordenador',password:'QA wrong password'})).status,401);
    assert.equal((await f.login()).status,429);
    assert.equal((await f.req('GET','/api/auth/me',undefined,f.cookie)).status,200);
  }finally{await f.close();}
});

test('Regressão QA-07: falha real de INSERT da auditoria reverte alteração de negócio antes da resposta',async()=>{
  const f=await fixture();try{
    const before=f.raw.prepare('SELECT nome FROM itens WHERE id=1').get() as {nome:string};
    const count=(f.raw.prepare('SELECT COUNT(*) AS c FROM audit_logs').get() as {c:number}).c;
    f.raw.exec("CREATE TRIGGER qa_reject_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'QA_AUDIT_FAILURE'); END");
    const response=await f.req('PATCH','/api/coord/itens/1',{nome:'QA SHOULD ROLLBACK'},f.cookie);
    assert.equal(response.status,503);assert.equal(response.body.code,'AUDIT_UNAVAILABLE');
    assert.equal((f.raw.prepare('SELECT nome FROM itens WHERE id=1').get() as {nome:string}).nome,before.nome);
    assert.equal((f.raw.prepare('SELECT COUNT(*) AS c FROM audit_logs').get() as {c:number}).c,count);
    assert.equal(response.headers.get('set-cookie'),null);
  }finally{await f.close();}
});

test('Regressão QA-08: auditoria identifica conta-alvo sem body ou segredo',async()=>{
  const f=await fixture();try{
    assert.equal((await f.req('PATCH','/api/coord/usuarios/2',{ativo:false},f.cookie)).status,200);
    const row=f.raw.prepare('SELECT actor_id,evento,rota FROM audit_logs ORDER BY id DESC LIMIT 1').get() as {actor_id:number;evento:string;rota:string};
    assert.equal(row.actor_id,1);assert.equal(row.evento,'USER_CHANGE');assert.equal(row.rota,'/api/coord/usuarios/2');
    assert.ok(!JSON.stringify(row).includes('password'));
  }finally{await f.close();}
});
