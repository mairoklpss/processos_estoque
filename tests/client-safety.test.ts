import test from 'node:test';
import assert from 'node:assert/strict';
import {api,ApiError,requestAllPages,buildItemUpdatePayload} from '../src/lib/api.ts';
const json=(rows:unknown)=>new Response(JSON.stringify(rows),{headers:{'Content-Type':'application/json'}});
test('QA-04: sete listas da UI recuperam 501 registros preservando filtros',async()=>{
 const original=globalThis.fetch;const calls:URL[]=[];
 try{
  globalThis.fetch=async(input)=>{const url=new URL(String(input),'http://localhost');calls.push(url);assert.equal(url.searchParams.get('limit'),'500');const offset=Number(url.searchParams.get('offset'));return json(Array.from({length:offset===0?500:1},(_,i)=>({id:offset+i+1})));};
  const lists=[()=>api.listarItens(),()=>api.listarTecnicos(),()=>api.listarUsuarios(),()=>api.listarPendenciasCoord(),()=>api.listarPendenciasEstoque(),()=>api.listarFilaEstoque(),()=>api.listarSeparacoes({tecnicoId:'1',competencia:'2026-10',status:'SEPARADA'})];
  for(const list of lists){const rows=await list();assert.equal(rows.length,501);assert.equal(new Set(rows.map(r=>r.id)).size,501);}
  assert.equal(calls.length,14);for(const url of calls.slice(-2)){assert.equal(url.searchParams.get('competencia'),'2026-10');assert.equal(url.searchParams.get('status'),'SEPARADA');assert.equal(url.searchParams.get('tecnicoId'),'1');}
 }finally{globalThis.fetch=original;}
});
test('Paginação instável não retorna dados parciais silenciosamente',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async()=>{calls++;return json(Array.from({length:500},(_,i)=>({id:i+1})));};await assert.rejects(requestAllPages('/api/coord/itens'),(e:unknown)=>e instanceof ApiError&&e.code==='UNSTABLE_PAGINATION');assert.equal(calls,2);}finally{globalThis.fetch=original;}
});
test('Paginação tem limite explícito e não entra em loop com servidor que nunca termina',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(input)=>{calls++;const offset=Number(new URL(String(input),'http://localhost').searchParams.get('offset'));return json(Array.from({length:500},(_,i)=>({id:offset+i+1})));};await assert.rejects(requestAllPages('/api/coord/itens'),(e:unknown)=>e instanceof ApiError&&e.code==='PAGINATION_LIMIT');assert.equal(calls,21);}finally{globalThis.fetch=original;}
});
test('QA-01: editar metadados omite estoque; ajuste explícito inclui referência, inclusive zero',()=>{
 const fields={codigo:'A',nome:'Nome atualizado',unidade:'un',limiteMaximo:10};
 assert.deepEqual(buildItemUpdatePayload({...fields,estoqueAtual:100},100),fields);
 assert.deepEqual(buildItemUpdatePayload({...fields,estoqueAtual:92},100),{...fields,estoqueAtual:92,expectedEstoqueAtual:100});
 assert.deepEqual(buildItemUpdatePayload({...fields,estoqueAtual:1},0),{...fields,estoqueAtual:1,expectedEstoqueAtual:0});
});
