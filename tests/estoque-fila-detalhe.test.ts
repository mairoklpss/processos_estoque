import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createApp } from '../server/app.ts';
import { createDatabase, seedDatabaseIfEmpty } from '../server/db.ts';

// Issue 13: o detalhe da fila do estoque passa a expor o estoque total do snapshot
// (estoqueDisponivel), além do valor limitado (quantidadeASeparar) que já existia.

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

test('Detalhe da fila do estoque expõe o estoque total do snapshot', async () => {
  const srv = await startTestServer();
  try {
    const coordHeaders = { 'X-Requested-With': 'Brasilink', Cookie: await loginAs(srv.baseUrl, 'coordenador', 'Coord@2026') };

    // Cria e envia um rascunho para o técnico 1 (entra na fila do estoque)
    const calc = await fetch(`${srv.baseUrl}/api/coord/separacoes/calcular`, {
      method: 'POST',
      headers: { ...coordHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tecnicoId: 1 }),
    });
    assert.equal(calc.status, 201);
    const rascunho = (await calc.json()) as { id: number; itens: Array<{ estoqueAlmoxarifado: number }> };
    const enviar = await fetch(`${srv.baseUrl}/api/coord/separacoes/${rascunho.id}/enviar`, { method: 'POST', headers: coordHeaders });
    assert.equal(enviar.status, 200);

    // Estoque vê o detalhe e encontra o estoque total do snapshot por item
    const estoqueHeaders = { 'X-Requested-With': 'Brasilink', Cookie: await loginAs(srv.baseUrl, 'estoque', 'Estoque@2026') };
    const detalhe = await fetch(`${srv.baseUrl}/api/estoque/fila/${rascunho.id}`, { headers: estoqueHeaders });
    assert.equal(detalhe.status, 200);
    const corpo = (await detalhe.json()) as { itens: Array<{ estoqueDisponivel?: number }> };
    assert.ok(corpo.itens.length > 0);
    for (const [i, item] of corpo.itens.entries()) {
      assert.equal(item.estoqueDisponivel, rascunho.itens[i].estoqueAlmoxarifado, 'estoqueDisponivel deve ser o snapshot do estoque do cálculo.');
    }
  } finally {
    await srv.close();
  }
});
