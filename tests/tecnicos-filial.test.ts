import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createApp } from '../server/app.ts';
import { createDatabase, seedDatabaseIfEmpty } from '../server/db.ts';

// Issue 03: o campo dos técnicos é "filial" (cidade, futura do IXC) — "regiao" deixa de existir
// como campo aceito pela API, em qualquer camada.

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

test('Criar técnico aceita filial, lista expõe filial e payload com regiao é recusado', async () => {
  const srv = await startTestServer();
  try {
    const cookie = await loginAs(srv.baseUrl);
    const headers = { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json', Cookie: cookie };

    const criar = await fetch(`${srv.baseUrl}/api/coord/tecnicos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ matricula: 'TEC-FIL', nome: 'Técnica Filial', filial: 'Tianguá' }),
    });
    assert.equal(criar.status, 201);
    const criado = (await criar.json()) as { filial?: string; regiao?: string };
    assert.equal(criado.filial, 'Tianguá');
    assert.equal(criado.regiao, undefined, 'DTO não deve mais expor regiao');

    const listar = await fetch(`${srv.baseUrl}/api/coord/tecnicos`, { headers });
    assert.equal(listar.status, 200);
    const lista = (await listar.json()) as Array<{ filial?: string; regiao?: string }>;
    const alvo = lista.find((t) => t.filial === 'Tianguá');
    assert.ok(alvo, 'Técnico criado deve aparecer na lista com filial');
    assert.ok(lista.every((t) => t.regiao === undefined), 'Lista não deve mais expor regiao');

    const criarComRegiao = await fetch(`${srv.baseUrl}/api/coord/tecnicos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ matricula: 'TEC-REG', nome: 'Técnica Região', regiao: 'Qualquer' }),
    });
    assert.equal(criarComRegiao.status, 400);
    const erro = (await criarComRegiao.json()) as { code?: string };
    assert.equal(erro.code, 'VALIDATION_ERROR');
  } finally {
    await srv.close();
  }
});
