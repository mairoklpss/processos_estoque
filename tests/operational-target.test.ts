import test from 'node:test';
import assert from 'node:assert/strict';
import {localMigrationUrl} from '../server/postgres-migration.ts';
import {runtimePostgresUrl,assertSqliteSelection} from '../server/database-config.ts';

test('Destino operacional exige perfil explícito; homologação padrão continua isolada',()=>{
 const operation='postgresql://localhost:55433/brasilink_operacao';
 assert.throws(()=>localMigrationUrl(operation));
 assert.equal(new URL(localMigrationUrl(operation,'operacao')).port,'55433');
 assert.ok(localMigrationUrl('postgresql://localhost:55432/brasilink_homologacao'));
 assert.throws(()=>localMigrationUrl('postgresql://localhost:55432/brasilink_homologacao','operacao'));
});
test('Guarda operacional rejeita nativo, remoto, nome errado, query e perfil inválido',()=>{
 for(const uri of ['postgresql://localhost:5432/brasilink_operacao','postgresql://remote.invalid:55433/brasilink_operacao','postgresql://localhost:55433/other','postgresql://localhost:55433/brasilink_operacao?options=-csearch_path=other'])assert.throws(()=>localMigrationUrl(uri,'operacao'));
 assert.throws(()=>localMigrationUrl('postgresql://localhost:55433/brasilink_operacao','unknown'));
});
test('Após corte registrado não permite seleção silenciosa do SQLite',()=>{
 assert.throws(()=>assertSqliteSelection(true,false,true),/Operação migrada/);
 assert.throws(()=>assertSqliteSelection(true,true,false),/Operação migrada/);
 assert.doesNotThrow(()=>assertSqliteSelection(false,false,false));
 assert.doesNotThrow(()=>assertSqliteSelection(true,true,true));
});
test('Runtime local mantém perfis separados e não usa PostgreSQL nativo',()=>{
 assert.equal(runtimePostgresUrl('postgresql://localhost:55433/brasilink_operacao',false,'operacao').pathname,'/brasilink_operacao');
 assert.throws(()=>runtimePostgresUrl('postgresql://localhost:55432/brasilink_homologacao',false,'operacao'));
 assert.throws(()=>runtimePostgresUrl('postgresql://localhost:55433/brasilink_operacao'));
 assert.throws(()=>runtimePostgresUrl('postgresql://localhost:5432/brasilink_operacao',false,'operacao'));
 assert.throws(()=>runtimePostgresUrl('postgresql://remote.invalid:55433/brasilink_operacao',false,'operacao'));
 assert.throws(()=>runtimePostgresUrl('postgresql://localhost:55433/brasilink_operacao',false,'bad'));
 assert.equal(runtimePostgresUrl('postgresql://remote.invalid/db?sslmode=disable',true,'operacao').searchParams.has('sslmode'),false);
});
