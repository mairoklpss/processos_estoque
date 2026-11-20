import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import pg from 'pg';
import { adaptSqlite, createPostgresDatabase, postgresSql, postgresLockSql, type AsyncDatabase } from '../server/database.ts';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function sqlite() {
  const raw = new Database(':memory:');
  raw.exec('CREATE TABLE balance (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL); INSERT INTO balance VALUES (1, 0)');
  return { raw, db: adaptSqlite(raw) };
}

test('database SQLite: cache and serialized transactions across awaited operations', async () => {
  const { raw, db } = sqlite();
  try {
    assert.equal(db, adaptSqlite(raw));
    await Promise.all(Array.from({ length: 15 }, () => db.transaction(async tx => {
      const row = await tx.lock<{ amount: number }>('SELECT amount FROM balance WHERE id = ?', 1);
      await wait(1);
      await tx.run('UPDATE balance SET amount = ? WHERE id = ?', row!.amount + 1, 1);
    })));
    assert.equal((await db.get<{ amount: number }>('SELECT amount FROM balance'))!.amount, 15);
  } finally { await db.close(); }
});

test('database SQLite: queued reads/writes do not enter an active transaction', async () => {
  const { db } = sqlite();
  let enter!: () => void; let finish!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  try {
    const transaction = db.transaction(async tx => {
      await tx.run('UPDATE balance SET amount = 7'); enter(); await gate;
      throw new Error('intentional rollback');
    });
    // Attach the rejection handler immediately, before allowing the callback to throw.
    const rejected = assert.rejects(transaction, /intentional rollback/);
    await entered;
    let readCompleted = false;
    const read = db.get<{ amount: number }>('SELECT amount FROM balance').then(row => { readCompleted = true; return row; });
    const write = db.run('UPDATE balance SET amount = amount + 1');
    await wait(5); assert.equal(readCompleted, false);
    finish(); await rejected;
    assert.equal((await read)!.amount, 0); await write;
    assert.equal((await db.get<{ amount: number }>('SELECT amount FROM balance'))!.amount, 1);
  } finally { finish?.(); await db.close(); }
});

test('database SQLite: rollback, expired scope, nested/root transaction misuse reject instead of deadlock', async () => {
  const { db } = sqlite(); let leaked: AsyncDatabase | undefined;
  try {
    await assert.rejects(db.transaction(async tx => {
      leaked = tx;
      await tx.run('UPDATE balance SET amount = 100');
      throw new Error('rollback');
    }), /rollback/);
    assert.equal((await db.get<{ amount: number }>('SELECT amount FROM balance'))!.amount, 0);
    await assert.rejects(leaked!.get('SELECT 1'), /encerrado/);
    await assert.rejects(db.transaction(tx => tx.transaction(async () => 1)), /aninhada/);
    await assert.rejects(db.transaction(() => db.transaction(async () => 1)), /aninhada/);
    await assert.rejects(db.transaction(() => db.get('SELECT 1')), /escopo/);
    await assert.rejects(db.transaction(tx => tx.close()), /Não feche/);
    assert.equal((await db.lockAll('SELECT * FROM balance')).length, 1);
  } finally { await db.close(); }
  await assert.rejects(db.get('SELECT 1'), /fechado/);
});

test('database SQLite: async scheduling, insert IDs, upserts, sessions and affected rows', async () => {
  const { raw, db } = sqlite();
  raw.exec('CREATE TABLE records (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE); CREATE TABLE sessoes (token TEXT PRIMARY KEY)');
  try {
    const pending = db.run('UPDATE balance SET amount = 9');
    assert.equal((raw.prepare('SELECT amount FROM balance').get() as any).amount, 0);
    await pending;
    assert.deepEqual(await db.run('INSERT INTO records (name) VALUES (?)', 'first'), { insertId: 1, affectedRows: 1 });
    assert.deepEqual(await db.run('INSERT INTO records (name) VALUES (?)', 'second'), { insertId: 2, affectedRows: 1 });
    assert.deepEqual(await db.run('INSERT INTO records (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = excluded.name; -- trailing comment', 'first'), { insertId: 1, affectedRows: 1 });
    assert.deepEqual(await db.run('INSERT INTO records (name) VALUES (?) ON CONFLICT(name) DO NOTHING', 'first'), { insertId: undefined, affectedRows: 0 });
    assert.deepEqual(await db.run('INSERT INTO sessoes (token) VALUES (?)', 'session'), { insertId: undefined, affectedRows: 1 });
    assert.deepEqual(await db.run('UPDATE records SET name = ? WHERE id = ?', 'changed', 2), { insertId: undefined, affectedRows: 1 });
    assert.deepEqual(await db.run('DELETE FROM records WHERE id = ?', 999), { insertId: undefined, affectedRows: 0 });
    await assert.rejects(db.get('SELECT 9007199254740992 AS n'), /precisão/);
    assert.equal((await db.get<{ n: number }>('SELECT 9007199254740991 AS n'))!.n, Number.MAX_SAFE_INTEGER);
  } finally { await db.close(); }
});

test('database SQL: placeholder scanner preserves quotes, escaped strings, comments and dollar literals', () => {
  const input = `SELECT '?', "?", $$?$$, $tag$?$tag$, ? /* ? /* ? */ ? */ -- ?\n, ?`;
  assert.equal(postgresSql(input), `SELECT '?', "?", $$?$$, $tag$?$tag$, $1 /* ? /* ? */ ? */ -- ?\n, $2`);
  assert.equal(postgresSql("SELECT 'it''s ?', \"a\"\"?\", ?"), "SELECT 'it''s ?', \"a\"\"?\", $1");
  assert.equal(postgresSql(String.raw`SELECT E'it\'s ?', ?`), String.raw`SELECT E'it\'s ?', $1`);
  assert.throws(() => postgresSql("SELECT 'unterminated ?"), /terminado/);
  assert.throws(() => postgresSql('SELECT /* nested /* missing */'), /terminado/);
  assert.throws(() => postgresSql('SELECT $tag$missing'), /terminado/);
});

test('database SQL: row locks use the itens alias, preserve order and trailing comments', () => {
  assert.equal(postgresLockSql('SELECT * FROM balance WHERE id = ?; -- note'), 'SELECT * FROM balance WHERE id = ? FOR UPDATE; -- note');
  assert.equal(postgresLockSql('SELECT i.id FROM separacao_itens si JOIN itens i ON si.item_id = i.id'), 'SELECT i.id FROM separacao_itens si JOIN itens i ON si.item_id = i.id FOR UPDATE OF i');
  assert.equal(postgresLockSql('SELECT i.id FROM si JOIN "public"."itens" AS "i" ON true ORDER BY i.id'), 'SELECT i.id FROM si JOIN "public"."itens" AS "i" ON true ORDER BY i.id FOR UPDATE OF i');
  assert.equal(postgresLockSql("SELECT 'FOR UPDATE', id FROM balance -- tail"), "SELECT 'FOR UPDATE', id FROM balance FOR UPDATE -- tail");
  assert.equal(postgresLockSql('SELECT * FROM balance FOR UPDATE'), 'SELECT * FROM balance FOR UPDATE');
});

test('database PostgreSQL: client lifecycle, shared advisory lock and bounded retries (mock, no server)', async t => {
  const commands: string[] = []; let releases = 0; let connects = 0; let rolledBack = 0;
  const client = {
    async query(sql: string, params?: unknown[]) {
      commands.push(sql); if (sql === 'ROLLBACK') rolledBack++;
      if (sql.includes('pg_attribute')) return { rows: [{ has_id: params?.[0] !== 'sessoes' }], rowCount: 1, fields: [] };
      if (sql.startsWith('INSERT')) {
        assert.equal(params?.[0], 'test');
        return { rows: sql.includes('RETURNING id') ? [{ id: 5 }] : [], rowCount: 1, fields: [] };
      }
      return { rows: [], rowCount: 0, fields: [] };
    },
    release() { releases++; },
  };
  // Mock prototype I/O rather than the constructor: node's constructor mock retains
  // the original prototype and cannot safely stand in for pg's BoundPool class.
  t.mock.method(pg.Pool.prototype, 'query', async (sql: string) => {
    commands.push(sql); return { rows: [{ value: 1 }], rowCount: 1, fields: [] };
  });
  t.mock.method(pg.Pool.prototype, 'connect', async () => { connects++; return client; });
  t.mock.method(pg.Pool.prototype, 'end', async () => { commands.push('END'); });
  const db = await createPostgresDatabase({});
  try {
    let attempts = 0;
    assert.equal(await db.transaction(async () => {
      if (++attempts < 3) throw Object.assign(new Error('serialization retry'), { code: '40001' });
      return 42;
    }), 42);
    assert.equal(attempts, 3); assert.equal(rolledBack, 2); assert.equal(releases, 3);
    await db.run('UPDATE balance SET amount = ?', 2);
    assert.equal(commands.filter(sql => sql.includes('pg_advisory_xact_lock')).length, 4);
    assert.equal(commands.filter(sql => sql === 'COMMIT').length, 2);
    await assert.rejects(db.transaction(async () => { throw Object.assign(new Error('deadlock'), { code: '40P01' }); }), /deadlock/);
    assert.equal(connects, 7); assert.equal(releases, 7);
    await assert.rejects(db.transaction(async () => { throw Object.assign(new Error('constraint'), { code: '23505' }); }), /constraint/);
    assert.equal(connects, 8); assert.equal(releases, 8);
    await assert.rejects(db.lock('SELECT 1'), /transacional/);
    await assert.rejects(db.transaction(tx => tx.transaction(async () => 1)), /aninhada/);
    await assert.rejects(db.transaction(() => db.get('SELECT 1')), /escopo/);
    assert.deepEqual(await db.run('INSERT INTO records (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = excluded.name; -- tail', 'test'), { insertId: 5, affectedRows: 1 });
    assert.ok(commands.includes('INSERT INTO records (name) VALUES ($1) ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id; -- tail'));
    assert.deepEqual(await db.run('INSERT INTO sessoes (token) VALUES (?)', 'test'), { insertId: undefined, affectedRows: 1 });
    assert.ok(commands.includes('INSERT INTO sessoes (token) VALUES ($1)'));
    let expired!: AsyncDatabase;
    await db.transaction(async tx => { expired = tx; });
    await assert.rejects(expired.get('SELECT 1'), /encerrado/);
  } finally { await db.close(); }
  await assert.rejects(db.get('SELECT 1'), /fechado/);
});

// Opt-in only. Never uses DATABASE_URL or discovers/runs local database services.
// DDL/data is confined to a uniquely named schema owned by this test and removed afterwards.
test('database PostgreSQL integration: dedicated schema, upsert/session IDs, rollback, JOIN lock, serialization and type compatibility', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const connectionString = process.env.TEST_DATABASE_URL!;
  const schema = `adapter_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  let db: AsyncDatabase | undefined; let created = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    await admin.query(`CREATE TABLE "${schema}".itens (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE, amount INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE "${schema}".links (item_id BIGINT REFERENCES "${schema}".itens(id));
      CREATE TABLE "${schema}".sessoes (token TEXT PRIMARY KEY)`);
    db = await createPostgresDatabase({ connectionString, max: 5, options: `-c search_path=${schema}` });
    assert.deepEqual(await db.run('INSERT INTO itens (name) VALUES (?)', 'first'), { insertId: 1, affectedRows: 1 });
    await db.run('INSERT INTO itens (name) VALUES (?)', 'second');
    assert.deepEqual(await db.run('INSERT INTO itens (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = excluded.name; -- tail', 'first'), { insertId: 1, affectedRows: 1 });
    assert.deepEqual(await db.run('INSERT INTO itens (name) VALUES (?) ON CONFLICT(name) DO NOTHING', 'first'), { insertId: undefined, affectedRows: 0 });
    assert.deepEqual(await db.run('INSERT INTO sessoes (token) VALUES (?)', 'test'), { insertId: undefined, affectedRows: 1 });
    assert.deepEqual(await db.run('INSERT INTO links (item_id) VALUES (?)', 1), { insertId: undefined, affectedRows: 1 });
    await db.transaction(async tx => {
      const row = await tx.lock<{ id: number }>('SELECT i.id FROM links l JOIN itens i ON i.id = l.item_id WHERE i.id = ?', 1);
      assert.equal(row!.id, 1);
      assert.equal((await tx.lockAll('SELECT * FROM itens WHERE id = ?', 1)).length, 1);
    });
    await Promise.all(Array.from({ length: 10 }, () => db!.transaction(async tx => {
      const row = await tx.get<{ amount: number }>('SELECT amount FROM itens WHERE id = ?', 1);
      await wait(2); await tx.run('UPDATE itens SET amount = ? WHERE id = ?', row!.amount + 1, 1);
    })));
    assert.equal((await db.get<{ amount: number }>('SELECT amount FROM itens WHERE id = ?', 1))!.amount, 10);
    await assert.rejects(db.transaction(async tx => { await tx.run('UPDATE itens SET amount = 999'); throw new Error('rollback'); }), /rollback/);
    assert.equal((await db.get<{ amount: number }>('SELECT amount FROM itens WHERE id = ?', 1))!.amount, 10);
    const types = await db.get<{ n: number; d: string; stamp: string }>("SELECT COUNT(*) AS n, DATE '2026-11-19' AS d, TIMESTAMP '2026-11-19 12:00:00' AS stamp FROM itens");
    assert.equal(types!.n, 2); assert.equal(types!.d, '2026-11-19'); assert.equal(typeof types!.stamp, 'string');
    await assert.rejects(db.get("SELECT '9007199254740992'::bigint AS n"), /precisão/);
  } finally {
    try { if (db) await db.close(); }
    finally { try { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await admin.end(); } }
  }
});
