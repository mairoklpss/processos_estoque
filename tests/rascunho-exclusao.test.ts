import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createApp } from '../server/app.ts';
import { createDatabase, seedDatabaseIfEmpty } from '../server/db.ts';

// Issue 11: o coordenador pode excluir um rascunho retomado (evita acumular rascunhos obsoletos).
// Só RASCUNHO pode ser apagado; CALCULADA/SEPARADA ficam preservadas no histórico e na fila.

async function startTestServer() {
  const db = createDatabase(':memory:');
  seedDatabaseIfEmpty(db);
  const app = createApp(db);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}

async function loginAs(baseUrl: string, username = 'coordenador', password = 'Coord@2026'): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

test('Rascunho retomado pode ser excluído pelo coordenador e some das listas', async () => {
  const srv = await startTestServer();
  try {
    const cookie = await loginAs(srv.baseUrl);
    const headers = { 'X-Requested-With': 'Brasilink', Cookie: cookie };

    // Cria um rascunho para o primeiro técnico
    const calc = await fetch(`${srv.baseUrl}/api/coord/separacoes/calcular`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tecnicoId: 1 }),
    });
    assert.equal(calc.status, 201);
    const rascunho = (await calc.json()) as { id: number; status: string };
    assert.equal(rascunho.status, 'RASCUNHO');

    // Exclui o rascunho
    const del = await fetch(`${srv.baseUrl}/api/coord/separacoes/${rascunho.id}`, { method: 'DELETE', headers });
    assert.equal(del.status, 200);
    const corpo = (await del.json()) as { ok?: boolean };
    assert.equal(corpo.ok, true);

    // Some da listagem de rascunhos e do detalhe
    const lista = await fetch(`${srv.baseUrl}/api/coord/separacoes?status=RASCUNHO`, { headers });
    const itens = (await lista.json()) as Array<{ id: number }>;
    assert.ok(!itens.some((s) => s.id === rascunho.id));
    const detalhe = await fetch(`${srv.baseUrl}/api/coord/separacoes/${rascunho.id}`, { headers });
    assert.equal(detalhe.status, 404);

    // Excluir de novo → 404
    const del2 = await fetch(`${srv.baseUrl}/api/coord/separacoes/${rascunho.id}`, { method: 'DELETE', headers });
    assert.equal(del2.status, 404);
  } finally {
    await srv.close();
  }
});

test('Exclusão de rascunho: só coordenador, e só quando está em RASCUNHO', async () => {
  const srv = await startTestServer();
  try {
    const cookie = await loginAs(srv.baseUrl);
    const headers = { 'X-Requested-With': 'Brasilink', Cookie: cookie };

    // Sem nenhuma marcação de mesma origem: CSRF rejeita antes (403, defesa em profundidade)
    const semNada = await fetch(`${srv.baseUrl}/api/coord/separacoes/1`, { method: 'DELETE' });
    assert.equal(semNada.status, 403);
    // Com header de mesma origem mas sem sessão: auth rejeita (401)
    const semAuth = await fetch(`${srv.baseUrl}/api/coord/separacoes/1`, {
      method: 'DELETE',
      headers: { 'X-Requested-With': 'Brasilink' },
    });
    assert.equal(semAuth.status, 401);

    const cookieEstoque = await loginAs(srv.baseUrl, 'estoque', 'Estoque@2026');
    const comoEstoque = await fetch(`${srv.baseUrl}/api/coord/separacoes/1`, {
      method: 'DELETE',
      headers: { 'X-Requested-With': 'Brasilink', Cookie: cookieEstoque },
    });
    assert.equal(comoEstoque.status, 403);

    // Rascunho enviado (CALCULADA) não pode ser apagado
    const calc = await fetch(`${srv.baseUrl}/api/coord/separacoes/calcular`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tecnicoId: 1 }),
    });
    assert.equal(calc.status, 201);
    const rascunho = (await calc.json()) as { id: number };
    const enviar = await fetch(`${srv.baseUrl}/api/coord/separacoes/${rascunho.id}/enviar`, { method: 'POST', headers });
    assert.equal(enviar.status, 200);
    const del = await fetch(`${srv.baseUrl}/api/coord/separacoes/${rascunho.id}`, { method: 'DELETE', headers });
    assert.equal(del.status, 409);
    const erro = (await del.json()) as { code?: string };
    assert.equal(erro.code, 'DRAFT_ONLY');
  } finally {
    await srv.close();
  }
});
