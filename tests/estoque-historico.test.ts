import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createApp } from '../server/app.ts';
import { createDatabase, seedDatabaseIfEmpty } from '../server/db.ts';

// Issue 15: o estoque tem histórico de separações (somente leitura).
// RASCUNHO é invisível ao estoque: não aparece na listagem e pedido explícito → 400.

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

async function loginAs(baseUrl: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

test('Histórico do estoque: mostra CALCULADA/SEPARADA, nunca RASCUNHO; protegido por perfil', async () => {
  const srv = await startTestServer();
  try {
    const coordHeaders = { 'X-Requested-With': 'Brasilink', Cookie: await loginAs(srv.baseUrl, 'coordenador', 'Coord@2026') };

    // Um rascunho enviado (CALCULADA) e um rascunho ainda aberto (RASCUNHO)
    for (const criar of [true, false]) {
      const calc = await fetch(`${srv.baseUrl}/api/coord/separacoes/calcular`, {
        method: 'POST',
        headers: { ...coordHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tecnicoId: 1 }),
      });
      assert.equal(calc.status, 201);
      const rascunho = (await calc.json()) as { id: number };
      if (criar) {
        const enviar = await fetch(`${srv.baseUrl}/api/coord/separacoes/${rascunho.id}/enviar`, { method: 'POST', headers: coordHeaders });
        assert.equal(enviar.status, 200);
      }
    }

    const estoqueHeaders = { 'X-Requested-With': 'Brasilink', Cookie: await loginAs(srv.baseUrl, 'estoque', 'Estoque@2026') };

    // Listagem do estoque traz só o enviado; rascunho aberto não aparece
    const lista = await fetch(`${srv.baseUrl}/api/estoque/separacoes`, { headers: estoqueHeaders });
    assert.equal(lista.status, 200);
    const itens = (await lista.json()) as Array<{ id: number; status: string }>;
    assert.equal(itens.length, 1);
    assert.equal(itens[0].status, 'CALCULADA');

    // Pedido explícito de RASCUNHO é recusado
    const rascunhoPedido = await fetch(`${srv.baseUrl}/api/estoque/separacoes?status=RASCUNHO`, { headers: estoqueHeaders });
    assert.equal(rascunhoPedido.status, 400);

    // Filtro por status funciona
    const separadas = await fetch(`${srv.baseUrl}/api/estoque/separacoes?status=SEPARADA`, { headers: estoqueHeaders });
    assert.equal(separadas.status, 200);
    assert.equal(((await separadas.json()) as unknown[]).length, 0);

    // Coordenador não usa a rota do estoque
    const comoCoord = await fetch(`${srv.baseUrl}/api/estoque/separacoes`, { headers: coordHeaders });
    assert.equal(comoCoord.status, 403);
  } finally {
    await srv.close();
  }
});
