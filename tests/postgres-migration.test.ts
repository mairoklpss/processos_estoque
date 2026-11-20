import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import type pg from 'pg';
import { safeValue, sourceArgument, compareBackup, inspectBackup } from '../scripts/postgres-migrate.ts';
import { localMigrationUrl } from '../server/postgres-migration.ts';
import { createDatabase } from '../server/db.ts';

test('requires explicit backup source and no extra arguments', () => {
  assert.throws(() => sourceArgument([]));
  assert.throws(() => sourceArgument(['--source']));
  assert.throws(() => sourceArgument(['--source', 'copy.sqlite', '--drop']));
  assert.match(sourceArgument(['--source', 'copy.sqlite']), /copy\.sqlite$/);
});
test('only dedicated loopback Docker database is accepted', () => {
  assert.ok(localMigrationUrl('postgresql://migration:private@127.0.0.1:55432/brasilink_homologacao'));
  for (const uri of ['postgresql://x:y@remote:55432/brasilink_homologacao', 'postgresql://x:y@127.0.0.1:5432/brasilink_homologacao', 'postgresql://x:y@127.0.0.1:55432/production', 'postgresql://x:y@127.0.0.1:55432/brasilink_homologacao?options=-csearch_path=other']) {
    assert.throws(() => localMigrationUrl(uri));
  }
});
test('numeric validation never silently rounds SQLite bigint or truncates double precision', () => {
  assert.equal(safeValue(2147483647n, true), 2147483647);
  assert.equal(safeValue(0.3333333333333333, false), 0.3333333333333333);
  assert.equal(safeValue(null, false), null);
  assert.throws(() => safeValue(9007199254740993n, true));
  assert.throws(() => safeValue(2147483648n, true));
  assert.throws(() => safeValue(Infinity, false));
  assert.throws(() => safeValue('a\0b', false));
});
test('snapshot integrity includes all inventory and optional historical audit', () => {
  const db = createDatabase(':memory:');
  try {
    db.defaultSafeIntegers(true);
    const tables = inspectBackup(db);
    for (const name of ['itens', 'saldos_tecnicos', 'pendencias', 'audit_logs']) assert.ok(tables.some(t => t.table === name));
    assert.ok(!tables.some(t => t.table === 'sessoes'));
  } finally { db.close(); }
});
test('unsafe source INTEGER fails before checksum and before connecting', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE usuarios(id INTEGER PRIMARY KEY); INSERT INTO usuarios VALUES(9007199254740993)');
    db.defaultSafeIntegers(true);
    assert.throws(() => inspectBackup(db), /precisão segura/);
  } finally { db.close(); }
});
test('verification includes negative and zero IDs and rejects altered stock', async () => {
  const rows = [{ id: -5, estoque_atual: 8 }, { id: 0, estoque_atual: 9 }];
  const digest = crypto.createHash('sha256').update(rows.map(r => JSON.stringify([r.id, r.estoque_atual]) + '\n').join('')).digest('hex');
  let calls = 0;
  const client = { query: async (sql: string, params?: unknown[]) => {
    if (sql.includes('COUNT(*)')) return { rows: [{ count: sql.includes('sessoes') ? '0' : '2' }] };
    assert.equal(params?.[0], null); calls++; return { rows };
  } } as unknown as pg.PoolClient;
  const expected = [{ table: 'itens', columns: ['id', 'estoque_atual'], count: 2, sha256: digest }];
  assert.equal((await compareBackup(client, expected))[0].count, 2);
  assert.equal(calls, 1);
  rows[0].estoque_atual = 7;
  await assert.rejects(() => compareBackup(client, expected), /Conteúdo divergente/);
});

test('opt-in Docker migration of explicit backup into an EMPTY dedicated database', {
  skip: !process.env.PG_MIGRATION_TEST_SOURCE || !process.env.PG_MIGRATION_URL,
}, async () => {
  const { runPostgresCopy } = await import('../scripts/postgres-migrate.ts');
  const source = process.env.PG_MIGRATION_TEST_SOURCE!;
  const migrated = await runPostgresCopy(source);
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.sessionsCopied, 0);
  const verified = await runPostgresCopy(source, true);
  assert.deepEqual(verified.verified, migrated.verified);
  await assert.rejects(() => runPostgresCopy(source), /Destino não está vazio/);
  // The migrated database is intentionally left intact: no DROP/TRUNCATE/cleanup.
});
