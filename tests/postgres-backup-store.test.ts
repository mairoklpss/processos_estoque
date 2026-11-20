import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptPgDump,decryptPgDump} from '../server/postgres-backup-store.ts';
async function fixture(work:(directory:string)=>Promise<void>){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pg-backup-test-'));try{await work(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
const secret='Synthetic QA key that is never an operational credential';
test('Backup PG: roundtrip autenticado preserva arquivo custom sem sobrescrever',()=>fixture(async dir=>{
 const source=path.join(dir,'source'),enc=path.join(dir,'encrypted'),out=path.join(dir,'restored');const bytes=Buffer.concat([Buffer.from('PGDMP'),Buffer.from([0,128,255,5]),Buffer.from('synthetic')]);
 await fs.writeFile(source,bytes);await encryptPgDump(source,enc,secret);await decryptPgDump(enc,out,secret);assert.deepEqual(await fs.readFile(out),bytes);
 await assert.rejects(encryptPgDump(source,enc,secret));await assert.rejects(decryptPgDump(enc,out,secret));assert.deepEqual(await fs.readFile(out),bytes);
}));
test('Backup PG: senha errada e adulteração não publicam arquivo restaurado',()=>fixture(async dir=>{
 const source=path.join(dir,'source'),enc=path.join(dir,'encrypted'),out=path.join(dir,'restored');await fs.writeFile(source,'PGDMP synthetic');await encryptPgDump(source,enc,secret);
 await assert.rejects(decryptPgDump(enc,out,'Another synthetic wrong key'));await assert.rejects(fs.stat(out));
 const bytes=await fs.readFile(enc);bytes[bytes.length-1]^=1;await fs.writeFile(enc,bytes);await assert.rejects(decryptPgDump(enc,out,secret));await assert.rejects(fs.stat(out));
}));
test('Backup PG: rejeita conteúdo que não é pg_dump mesmo autenticado',()=>fixture(async dir=>{
 const source=path.join(dir,'source'),enc=path.join(dir,'encrypted'),out=path.join(dir,'restored');await fs.writeFile(source,'not a PostgreSQL archive');await encryptPgDump(source,enc,secret);await assert.rejects(decryptPgDump(enc,out,secret),/pg_dump/);await assert.rejects(fs.stat(out));
}));
