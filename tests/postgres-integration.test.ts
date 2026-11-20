import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { createDatabase, seedDatabaseIfEmpty } from '../server/db.ts';
import { createPostgresDatabase } from '../server/data-access.ts';
import { localMigrationUrl } from '../server/postgres-migration.ts';
import { migrationTables, identifier } from '../server/migration-snapshot.ts';
import { createApp } from '../server/app.ts';
import { calcularSeparacaoRascunho, enviarSolicitacaoEstoque, obterDetalheEstoque, confirmarEntregaEstoque, criarUsuario } from '../server/services.ts';

// Não substitui PostgreSQL por emulador. Sem Docker/URL explícita, o teste é marcado como NÃO EXECUTADO.
test('PostgreSQL real: API, isolamento, sequences, rollback e concorrência de estoque em schema efêmero', {
  skip: !process.env.TEST_DATABASE_URL ? 'Docker/TEST_DATABASE_URL indisponível; homologação real pendente.' : false,
}, async () => {
  const url = localMigrationUrl(process.env.TEST_DATABASE_URL!);
  const schema = 'test_brasilink_' + crypto.randomBytes(8).toString('hex');
  const admin = new pg.Pool({ connectionString: url, ssl: false, max: 1 });
  const raw = createDatabase(':memory:'); seedDatabaseIfEmpty(raw);
  let db: Awaited<ReturnType<typeof createPostgresDatabase>> | undefined;
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA ${identifier(schema)}`); created = true;
    db = await createPostgresDatabase({ connectionString: url, options: `-c search_path=${schema}`, max: 5, ssl: false });
    const ddl = await fs.readFile(new URL('../server/postgres-schema.sql', import.meta.url), 'utf8');
    const setup = await admin.connect();
    try { await setup.query(`SET search_path TO ${identifier(schema)}`); await setup.query(ddl); }
    finally { setup.release(); }
    await db.transaction(async tx => {
      for (const table of migrationTables) {
        const rows = raw.prepare(`SELECT * FROM ${identifier(table)} ORDER BY id`).all() as Record<string, unknown>[];
        for (const row of rows) {
          const columns = Object.keys(row);
          await tx.run(`INSERT INTO ${identifier(table)} (${columns.map(identifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, ...Object.values(row));
        }
        await tx.get(`SELECT setval(pg_get_serial_sequence(?, 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${identifier(table)}`, table);
      }
    });
    const createdUser = await criarUsuario(db, { nome: 'Teste', username: 'pg_teste', password: 'Frase longa de homologação', perfil: 'ESTOQUE' });
    assert.equal(createdUser.id, 3);
    await assert.rejects(db.transaction(async tx => { await tx.run('UPDATE itens SET estoque_atual = 0 WHERE id = 1'); throw new Error('rollback'); }), /rollback/);
    assert.equal((await db.get<{ estoque_atual: number }>('SELECT estoque_atual FROM itens WHERE id = 1'))!.estoque_atual, 180);
    const coord = { id: 1, nome: 'Coord', username: 'coordenador', perfil: 'COORDENADOR' as const };
    const stock = { id: 2, nome: 'Estoque', username: 'estoque', perfil: 'ESTOQUE' as const };
    const a = await calcularSeparacaoRascunho(db, coord, 1); const b = await calcularSeparacaoRascunho(db, coord, 2);
    await enviarSolicitacaoEstoque(db, coord, a.id); await enviarSolicitacaoEstoque(db, coord, b.id);
    const da = await obterDetalheEstoque(db, a.id); const dbb = await obterDetalheEstoque(db, b.id);
    const input = (d: typeof da) => ({ versaoEstoque: d.versaoEstoque, itens: d.itens.map(i => ({ separacaoItemId: i.id, quantidadeEntregue: i.quantidadeASeparar })) });
    const confirmed = await Promise.allSettled([confirmarEntregaEstoque(db, stock, a.id, input(da)), confirmarEntregaEstoque(db, stock, b.id, input(dbb))]);
    assert.equal(confirmed.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(confirmed.filter(r => r.status === 'rejected').length, 1);
    const winner = confirmed[0].status === 'fulfilled' ? a.id : b.id;
    const oldInput = winner === a.id ? input(da) : input(dbb);
    await assert.rejects(confirmarEntregaEstoque(db, stock, winner, oldInput), (error: any) => error.code === 'DOUBLE_CONFIRMATION');
    assert.equal((await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM itens WHERE estoque_atual < 0'))!.count, 0);
    const app = createApp(db);
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Brasilink' }, body: JSON.stringify({ username: 'estoque', password: 'Estoque@2026' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await fetch(base + '/api/coord/usuarios', { headers: { Cookie: cookie } })).status, 403);
    assert.equal((await fetch(base + '/api/estoque/fila', { headers: { Cookie: cookie } })).status, 200);
    assert.ok((await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM audit_logs'))!.count > 0);
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    if (db) await db.close(); raw.close();
    if (created) await admin.query(`DROP SCHEMA ${identifier(schema)} CASCADE`); // Apenas namespace novo criado por este teste.
    await admin.end();
  }
});
