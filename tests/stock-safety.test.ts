import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../server/db.ts';
import { adaptSqlite, postgresLockSql } from '../server/data-access.ts';
import { atualizarItem } from '../server/services/catalog.ts';
import { calcularSeparacaoRascunho, enviarSolicitacaoEstoque, ajustarItemRascunho } from '../server/services/separations.ts';
import { obterDetalheEstoque, listarFilaEstoque, confirmarEntregaEstoque, listarPendencias } from '../server/services/stock.ts';
import { AppError, type SessionUser } from '../server/services/common.ts';

const now = new Date('2026-11-20T12:00:00Z');
const ts = now.toISOString();
const coord: SessionUser = { id: 1, nome: 'QA coord', username: 'qa-coord', perfil: 'COORDENADOR' };
const stock: SessionUser = { id: 2, nome: 'QA estoque', username: 'qa-stock', perfil: 'ESTOQUE' };
function error(status: number, code: string) {
  return (e: unknown) => e instanceof AppError && e.status === status && e.code === code;
}
async function fixture() {
  // Schema real, dados inteiramente sintéticos e banco exclusivamente em memória.
  const raw = createDatabase(':memory:');
  const db = adaptSqlite(raw);
  for (const user of [coord, stock]) await db.run(
    'INSERT INTO usuarios (id,nome,username,senha_hash,perfil,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?)',
    user.id, user.nome, user.username, 'NOT_A_LOGIN_HASH', user.perfil, ts, ts);
  await db.run('INSERT INTO tecnicos (id,matricula,nome,criado_em,atualizado_em) VALUES (1,?,?,?,?)', 'QA-TECH', 'QA técnico', ts, ts);
  await db.run('INSERT INTO itens (id,codigo,nome,estoque_atual,limite_maximo,criado_em,atualizado_em) VALUES (1,?,?,100,10,?,?)', 'QA-ITEM', 'QA produto', ts, ts);
  await db.run('INSERT INTO consumos (tecnico_id,item_id,competencia,quantidade_usada) VALUES (1,1,?,22)', '2026-10');
  async function request(manual?: number) {
    const sep = await calcularSeparacaoRascunho(db, coord, 1, now);
    assert.equal(sep.itens.length, 1);
    if (manual !== undefined) await ajustarItemRascunho(db, coord, sep.id, sep.itens[0].id, manual, 'QA ajuste manual autorizado');
    await enviarSolicitacaoEstoque(db, coord, sep.id);
    return obterDetalheEstoque(db, sep.id);
  }
  const deliver = (detail: Awaited<ReturnType<typeof obterDetalheEstoque>>, quantity: number) => confirmarEntregaEstoque(db, stock, detail.id, {
    versaoEstoque: detail.versaoEstoque, itens: [{ separacaoItemId: detail.itens[0].id, quantidadeEntregue: quantity }],
  });
  const warehouse = async () => (await db.get<{ estoque_atual: number }>('SELECT estoque_atual FROM itens WHERE id=1'))!.estoque_atual;
  const balance = async () => (await db.get<{ quantidade: number }>('SELECT quantidade FROM saldos_tecnicos WHERE tecnico_id=1 AND item_id=1'))?.quantidade ?? 0;
  return { db, request, deliver, warehouse, balance, close: () => db.close() };
}

test('QA-01: formulário de estoque antigo não ressuscita unidades após entrega; nome-only preserva saldo', async () => {
  const f = await fixture(); try {
    await f.deliver(await f.request(), 8);
    assert.equal(await f.warehouse(), 92);
    await assert.rejects(atualizarItem(f.db, 1, { nome: 'Não deve persistir', estoqueAtual: 100, expectedEstoqueAtual: 100 }), error(409, 'STALE_STOCK_VERSION'));
    assert.equal(await f.warehouse(), 92);
    assert.equal((await f.db.get('SELECT nome FROM itens WHERE id=1')).nome, 'QA produto');
    const renamed = await atualizarItem(f.db, 1, { nome: 'QA novo nome', expectedEstoqueAtual: 100 });
    assert.equal(renamed.nome, 'QA novo nome');
    assert.equal(renamed.estoqueAtual, 92);
    const valid = await atualizarItem(f.db, 1, { estoqueAtual: 94, expectedEstoqueAtual: 92 });
    assert.equal(valid.estoqueAtual, 94);
  } finally { await f.close(); }
});

test('QA-01: alteração de estoque exige expected inteiro estrito dentro do intervalo PostgreSQL', async () => {
  const f = await fixture(); try {
    await assert.rejects(atualizarItem(f.db, 1, { estoqueAtual: 101 }), error(400, 'EXPECTED_STOCK_REQUIRED'));
    for (const invalid of [-1, 1.5, 2147483648, NaN, Infinity, null, '100']) {
      await assert.rejects(atualizarItem(f.db, 1, { estoqueAtual: 101, expectedEstoqueAtual: invalid as number }), error(400, 'VALIDATION_ERROR'));
    }
    assert.equal(await f.warehouse(), 100);
    await atualizarItem(f.db, 1, { estoqueAtual: 0, expectedEstoqueAtual: 100 });
    await atualizarItem(f.db, 1, { estoqueAtual: 2147483647, expectedEstoqueAtual: 0 });
    await atualizarItem(f.db, 1, { estoqueAtual: 1, expectedEstoqueAtual: 2147483647 });
    await assert.rejects(atualizarItem(f.db, 1, { estoqueAtual: 2147483648, expectedEstoqueAtual: 1 }), error(400, 'VALIDATION_ERROR'));
  } finally { await f.close(); }
});

test('QA-02: dois pedidos 10+10; hash antigo rejeitado, refresh reduz a zero, confirmação zero sem falta fictícia', async () => {
  const f = await fixture(); try {
    const first = await f.request(); const second = await f.request();
    assert.equal(first.itens[0].quantidadeSolicitada, 10); // reposição até o máximo (10 − saldo 0)
    assert.equal(second.itens[0].quantidadeSolicitada, 10);
    await f.deliver(first, 10);
    await assert.rejects(f.deliver(second, 10), error(409, 'STALE_STOCK_VERSION'));
    const fresh = await obterDetalheEstoque(f.db, second.id);
    assert.notEqual(fresh.versaoEstoque, second.versaoEstoque);
    assert.equal(fresh.itens[0].quantidadeSolicitada, 0); // saldo 10 atingiu o máximo => nada a repor
    assert.equal(fresh.itens[0].quantidadeASeparar, 0);
    assert.equal((await listarFilaEstoque(f.db))[0].totalUnidadesASeparar, 0);
    await assert.rejects(f.deliver(fresh, 8), error(400, 'EXCEEDS_REQUESTED'));
    const done = await f.deliver(fresh, 0);
    assert.equal(done.status, 'SEPARADA');
    assert.equal(done.itens[0].quantidadeSolicitada, 0);
    assert.equal(done.itens[0].quantidadeEntregue, 0);
    assert.equal(await f.balance(), 10);
    assert.equal(await f.warehouse(), 90);
    assert.deepEqual(await listarPendencias(f.db), []);
    const item = await f.db.get('SELECT * FROM separacao_itens WHERE id=?', second.itens[0].id);
    assert.equal(item.saldo_tecnico_snapshot, 10);
    assert.equal(item.quantidade_solicitada, 0);
    assert.equal(item.quantidade_calculada_original, 10);
    assert.match(item.ajuste_justificativa, /Revalidação automática/);
    assert.ok(item.ajustado_em);
    assert.deepEqual(await listarFilaEstoque(f.db), []);
    await assert.rejects(f.deliver(done, 0), error(409, 'DOUBLE_CONFIRMATION'));
  } finally { await f.close(); }
});

test('QA-02: hash inclui saldo técnico mesmo se almoxarifado não mudar', async () => {
  const f = await fixture(); try {
    const old = await f.request();
    await f.db.run('INSERT INTO saldos_tecnicos (tecnico_id,item_id,quantidade,atualizado_em) VALUES (1,1,3,?)', ts);
    assert.equal(await f.warehouse(), 100);
    const fresh = await obterDetalheEstoque(f.db, old.id);
    assert.notEqual(fresh.versaoEstoque, old.versaoEstoque);
    assert.equal(fresh.itens[0].quantidadeSolicitada, 7); // 10 − saldo 3
    await assert.rejects(f.deliver(old, 0), error(409, 'STALE_STOCK_VERSION'));
  } finally { await f.close(); }
});

test('QA-02: ajuste manual é preservado; pendência considera apenas demanda efetiva restante', async () => {
  const f = await fixture(); try {
    const first = await f.request(); const second = await f.request(6);
    await f.deliver(first, 3); // primeira pendência: 8-3=5
    const fresh = await obterDetalheEstoque(f.db, second.id);
    assert.equal(fresh.itens[0].quantidadeSolicitada, 3); // ajuste 6 menos saldo adicional 3
    await f.deliver(fresh, 1);
    const pending = (await listarPendencias(f.db)).find(p => p.separacaoId === second.id)!;
    assert.equal(pending.quantidadeSolicitada, 3);
    assert.equal(pending.quantidadeReferencia, 1);
    assert.equal(pending.diferenca, 2);
    assert.equal(pending.tipo, 'ENTREGA_PARCIAL');
    const item = await f.db.get('SELECT * FROM separacao_itens WHERE id=?', second.itens[0].id);
    assert.match(item.ajuste_justificativa, /QA ajuste manual autorizado/);
    assert.match(item.ajuste_justificativa, /Revalidação automática/);
    assert.equal(item.alvo_kit, 8);
    assert.equal(item.quantidade_calculada_original, 10); // cálculo automático novo: 10 − saldo 0
    assert.equal(await f.balance(), 4);
    assert.equal(await f.warehouse(), 96);
  } finally { await f.close(); }
});

test('QA-02: saldo menor que snapshot não aumenta pedido autorizado', async () => {
  const f = await fixture(); try {
    await f.db.run('INSERT INTO saldos_tecnicos (tecnico_id,item_id,quantidade,atualizado_em) VALUES (1,1,3,?)', ts);
    const old = await f.request();
    assert.equal(old.itens[0].quantidadeSolicitada, 7); // 10 − saldo 3
    await f.db.run('UPDATE saldos_tecnicos SET quantidade=0 WHERE tecnico_id=1 AND item_id=1');
    const fresh = await obterDetalheEstoque(f.db, old.id);
    assert.equal(fresh.itens[0].quantidadeSolicitada, 7); // saldo menor não AUMENTA o pedido autorizado
    await assert.rejects(f.deliver(fresh, 8), error(400, 'EXCEEDS_REQUESTED'));
    await f.deliver(fresh, 7);
    assert.equal(await f.balance(), 7);
  } finally { await f.close(); }
});

test('QA-02: confirmações concorrentes de pedidos distintos não duplicam reposição', async () => {
  const f = await fixture(); try {
    const first = await f.request(); const second = await f.request();
    const results = await Promise.allSettled([f.deliver(first, 8), f.deliver(second, 8)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    assert.ok(error(409, 'STALE_STOCK_VERSION')(rejected.reason));
    assert.equal(await f.balance(), 8);
    assert.equal(await f.warehouse(), 92);
  } finally { await f.close(); }
});

test('SQL de lock PostgreSQL usa OF i, nunca lock da relação nullable de saldo', () => {
  const sql = postgresLockSql('SELECT i.id, st.quantidade FROM separacao_itens si JOIN itens i ON i.id=si.item_id LEFT JOIN saldos_tecnicos st ON st.item_id=i.id WHERE si.separacao_id=? ORDER BY i.id');
  assert.match(sql, /FOR UPDATE OF i$/);
  assert.doesNotMatch(sql, /FOR UPDATE OF st/);
});
