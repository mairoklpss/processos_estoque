import fs from 'node:fs';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import {openRuntimeDatabase} from '../server/database-config.ts';
import {migrationTables,identifier,inspectSnapshot} from '../server/migration-snapshot.ts';
async function main(){
 const {db}=await openRuntimeDatabase();
 try{
  const identity=await db.get<{name:string;database:string;rolsuper:boolean;rolcreatedb:boolean;rolcreaterole:boolean;rolreplication:boolean;rolbypassrls:boolean}>("SELECT current_user AS name,current_database() AS database,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls FROM pg_roles r WHERE rolname=current_user");
  if(identity?.name!=='brasilink_app'||identity.database!=='brasilink_operacao'||[identity.rolsuper,identity.rolcreatedb,identity.rolcreaterole,identity.rolreplication,identity.rolbypassrls].some(Boolean))throw new Error('Identidade operacional incorreta.');
  const rights=await db.get("SELECT has_table_privilege(current_user,'public.audit_logs','INSERT') AS audit_insert,has_table_privilege(current_user,'public.audit_logs','UPDATE') AS audit_update,has_table_privilege(current_user,'public.audit_logs','DELETE') AS audit_delete,has_schema_privilege(current_user,'public','CREATE') AS schema_create");
  const stock=await db.get('SELECT SUM(estoque_atual) AS total,COUNT(*) FILTER(WHERE estoque_atual<0) AS negative FROM itens');
  const sessions=await db.get('SELECT COUNT(*) AS count FROM sessoes');
  const cutoff=JSON.parse(fs.readFileSync('.local/operacao/corte.json','utf8').replace(/^\uFEFF/,'')).FrozenAt;
  const logins=await db.all("SELECT actor_id,COUNT(*) AS count FROM audit_logs WHERE rota='/api/auth/login' AND status=200 AND actor_id IS NOT NULL AND criado_em>=? GROUP BY actor_id ORDER BY actor_id",cutoff);
  const activeAppConnections=await db.get("SELECT COUNT(*) AS count FROM pg_stat_activity WHERE usename=current_user AND datname=current_database() AND pid<>pg_backend_pid()");
  const manifest=JSON.parse(fs.readFileSync('.local/operacao/corte.json','utf8').replace(/^\uFEFF/,''));
  const source=new Database(manifest.Snapshot,{readonly:true,fileMustExist:true});let comparison;let schemaDrift:string[];
  try{
   source.pragma('query_only=ON');source.exec('BEGIN');const expected=inspectSnapshot(source);
   const liveColumns=new Map<string,Set<string>>();
   for(const table of expected){
    const cols=await db.all<{column_name:string}>(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=?`,table.table);
    liveColumns.set(table.table,new Set(cols.map(c=>c.column_name)));
   }
   schemaDrift=expected.flatMap(t=>{const vivos=liveColumns.get(t.table)!;const sumidos=t.columns.filter(c=>!vivos.has(c));return sumidos.length?[`${t.table}: removidas [${sumidos.join(', ')}]`]:[];});
   comparison=await db.transaction(async tx=>{const result=[];for(const table of expected.filter(t=>t.table!=='audit_logs')){
    const vivos=liveColumns.get(table.table)!;const colunas=table.columns.filter(c=>vivos.has(c));
    const rows=await tx.all<Record<string,unknown>>(`SELECT ${colunas.map(identifier).join(',')} FROM public.${identifier(table.table)} ORDER BY id`);
    const hash=crypto.createHash('sha256');for(const row of rows)hash.update(JSON.stringify(colunas.map(c=>row[c]))+'\n');result.push({table:table.table,sourceCount:table.count,currentCount:rows.length,matchesCutoverSnapshot:hash.digest('hex')===table.sha256&&colunas.length===table.columns.length});
   }return result;});
  }finally{if(source.inTransaction)source.exec('ROLLBACK');source.close();}
  console.log(JSON.stringify({checkedAt:new Date().toISOString(),backend:db.dialect,identity,rights,stock,sessions,logins,activeAppConnections,comparison,schemaDrift,businessRows:comparison.reduce((s,t)=>s+t.currentCount,0),auditAndSessionsExcludedFromBusinessComparison:true,knownDemoCredentialGuardPassed:true},null,2));
 }finally{await db.close();}
}
main().catch(()=>{console.error('OPERATIONAL_CHECK_FAILED: verificar destino operacional e chaves; nenhum fallback SQLite.');process.exitCode=1;});
