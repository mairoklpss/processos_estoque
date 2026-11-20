import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase, seedDatabaseIfEmpty } from '../server/db.ts';
import { adaptSqlite, postgresSql } from '../server/data-access.ts';
import { purgeExpiredRuntimeSessions } from '../server/database-config.ts';
import { calcularSeparacaoRascunho, enviarSolicitacaoEstoque, obterDetalheEstoque, confirmarEntregaEstoque, atualizarUsuario, loginUsuario, redefinirSenhaUsuario, getUsuarioBySession } from '../server/services.ts';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('Adaptador SQLite: cache, isolamento async e rollback sem operações intercaladas', async () => {
  const raw = createDatabase(':memory:'); const db = adaptSqlite(raw);
  try {
    assert.equal(adaptSqlite(raw), db);
    raw.exec('CREATE TABLE test_balance (id INTEGER PRIMARY KEY, amount INTEGER)');
    raw.prepare('INSERT INTO test_balance VALUES (1, 0)').run();
    await Promise.all(Array.from({ length: 10 }, () => db.transaction(async tx => {
      const row = await tx.get<{ amount: number }>('SELECT amount FROM test_balance WHERE id = 1');
      await wait(1);
      await tx.run('UPDATE test_balance SET amount = ? WHERE id = 1', row!.amount + 1);
    })));
    assert.equal((await db.get<{ amount: number }>('SELECT amount FROM test_balance'))!.amount, 10);
    await assert.rejects(db.transaction(async tx => {
      await tx.run('UPDATE test_balance SET amount = 99'); throw new Error('rollback');
    }), /rollback/);
    assert.equal((await db.get<{ amount: number }>('SELECT amount FROM test_balance'))!.amount, 10);
    await assert.rejects(db.transaction(tx => tx.transaction(async () => 1)), /aninhada/);
  } finally { await db.close(); }
});

test('SQL PostgreSQL: converte placeholders preservando literais, comentários e dollar quotes', () => {
  const input = `SELECT '?', "?", $$?$$, $tag$?$tag$, ? /* ? /* ? */ ? */ -- ?\n, ?`;
  assert.equal(postgresSql(input), `SELECT '?', "?", $$?$$, $tag$?$tag$, $1 /* ? /* ? */ ? */ -- ?\n, $2`);
  assert.equal(postgresSql("SELECT 'it''s ?', ?"), "SELECT 'it''s ?', $1");
});

test('Manutenção async: elimina somente sessões expiradas e registra auditoria', async () => {
  const raw = createDatabase(':memory:'); seedDatabaseIfEmpty(raw);
  const db = adaptSqlite(raw);
  try {
    raw.prepare('INSERT INTO sessoes VALUES (?, 1, ?, ?)').run('expired', '2020-01-01T00:00:00.000Z', '2020-02-01T00:00:00.000Z');
    raw.prepare('INSERT INTO sessoes VALUES (?, 1, ?, ?)').run('valid', '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z');
    assert.equal(await purgeExpiredRuntimeSessions(db, new Date('2026-11-19T00:00:00.000Z')), 1);
    assert.equal((await db.get<{ token: string }>('SELECT token FROM sessoes'))!.token, 'valid');
    assert.equal((await db.get<{ evento: string }>('SELECT evento FROM audit_logs'))!.evento, 'SESSION_PURGE');
  } finally { await db.close(); }
});

test('Concorrência SQLite async: apenas uma confirmação por separação, saldo nunca negativo', async () => {
  const raw = createDatabase(':memory:'); seedDatabaseIfEmpty(raw);
  const db = adaptSqlite(raw);
  try {
    const coord = { id: 1, nome: 'Coord', username: 'coordenador', perfil: 'COORDENADOR' as const };
    const stock = { id: 2, nome: 'Estoque', username: 'estoque', perfil: 'ESTOQUE' as const };
    const sep = await calcularSeparacaoRascunho(db, coord, 1);
    await enviarSolicitacaoEstoque(db, coord, sep.id);
    const detail = await obterDetalheEstoque(db, sep.id);
    const input = { versaoEstoque: detail.versaoEstoque, itens: detail.itens.map(i => ({ separacaoItemId: i.id, quantidadeEntregue: i.quantidadeASeparar })) };
    const results = await Promise.allSettled([confirmarEntregaEstoque(db, stock, sep.id, input), confirmarEntregaEstoque(db, stock, sep.id, input)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    assert.equal((await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM itens WHERE estoque_atual < 0'))!.count, 0);
  } finally { await db.close(); }
});


test('Segurança transacional: mantém um coordenador ativo mesmo com alterações concorrentes', async () => {
  const raw = createDatabase(':memory:'); seedDatabaseIfEmpty(raw); const db = adaptSqlite(raw);
  try {
    await assert.rejects(atualizarUsuario(db, 1, 1, { perfil: 'ESTOQUE' }), (error: any) => error.code === 'LAST_COORDINATOR');
    await atualizarUsuario(db, 1, 2, { perfil: 'COORDENADOR' });
    const changes = await Promise.allSettled([atualizarUsuario(db, 1, 1, { perfil: 'ESTOQUE' }), atualizarUsuario(db, 2, 2, { perfil: 'ESTOQUE' })]);
    assert.equal(changes.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM usuarios WHERE ativo = 1 AND perfil = 'COORDENADOR'"))!.c, 1);
  } finally { await db.close(); }
});

test('Segurança transacional: reset concorrente não deixa sessão válida criada com senha antiga', async () => {
  const raw = createDatabase(':memory:'); seedDatabaseIfEmpty(raw); const db = adaptSqlite(raw);
  try {
    const [session] = await Promise.all([loginUsuario(db, 'coordenador', 'Coord@2026'), redefinirSenhaUsuario(db, 1, 'Nova frase longa de teste')]);
    assert.equal(await getUsuarioBySession(db, session.token), null);
    await assert.rejects(loginUsuario(db, 'coordenador', 'Coord@2026'), (error: any) => error.code === 'INVALID_CREDENTIALS');
    const current = await loginUsuario(db, 'coordenador', 'Nova frase longa de teste');
    assert.equal((await getUsuarioBySession(db, current.token))!.id, 1);
  } finally { await db.close(); }
});
