import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createApp } from '../server/app.ts';
import { createDatabase, seedDatabaseIfEmpty } from '../server/db.ts';

// Issue 06: a busca de produtos no IXC (por ID ou descrição) fica preparada e protegida,
// respondendo indisponibilidade explícita até a integração IXC existir.

async function startTestServer(fixedNow?: Date) {
  const db = createDatabase(':memory:');
  seedDatabaseIfEmpty(db, fixedNow);
  const app = createApp(db, fixedNow ? { getNow: () => fixedNow } : undefined);
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

async function loginAs(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'coordenador', password: 'Coord@2026' }),
  });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

test('Busca de produtos no IXC: rota protegida e indisponível de forma clara até a API existir', async () => {
  const srv = await startTestServer();
  try {
    const semAuth = await fetch(`${srv.baseUrl}/api/coord/itens/ixc/buscar?modo=id&termo=77`);
    assert.equal(semAuth.status, 401);

    const cookie = await loginAs(srv.baseUrl);
    const headers = { 'X-Requested-With': 'Brasilink', Cookie: cookie };
    const buscar = await fetch(`${srv.baseUrl}/api/coord/itens/ixc/buscar?modo=nome&termo=splitter`, { headers });
    assert.equal(buscar.status, 503);
    const corpo = (await buscar.json()) as { code?: string };
    assert.equal(corpo.code, 'IXC_INTEGRACAO_INDISPONIVEL');

    const modoInvalido = await fetch(`${srv.baseUrl}/api/coord/itens/ixc/buscar?modo=descricao&termo=x`, { headers });
    assert.equal(modoInvalido.status, 400);
  } finally {
    await srv.close();
  }
});
