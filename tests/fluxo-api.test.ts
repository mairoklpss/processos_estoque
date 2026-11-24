import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createApp } from '../server/app.ts';
import { createDatabase, seedDatabaseIfEmpty } from '../server/db.ts';
import type {
  PendenciaDTO,
  SeparacaoCoordenadorDTO,
  SeparacaoEstoqueDetalheDTO,
  SeparacaoEstoqueFilaDTO,
} from '../src/shared/types.ts';

async function startTestServer(fixedNow?: Date) {
  const db = createDatabase(':memory:');
  seedDatabaseIfEmpty(db, fixedNow);
  const app = createApp(db, fixedNow ? { getNow: () => fixedNow } : undefined);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    db,
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          db.close();
          if (err) reject(err);
          else resolve();
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
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'Cookie de sessão deve ser emitido no login');
  return setCookie.split(';')[0];
}

test('Fluxo completo: rascunho invisível ao estoque, ajuste com justificativa, envio, isolamento de API, entrega parcial atômica, dupla confirmação e recálculo com saldo atualizado', async () => {
  const fixedNow = new Date('2026-11-19T14:00:00.000Z');
  const srv = await startTestServer(fixedNow);

  try {
    const coordCookie = await loginAs(srv.baseUrl, 'coordenador', 'Coord@2026');
    const estoqueCookie = await loginAs(srv.baseUrl, 'estoque', 'Estoque@2026');

    // 1. Coordenador calcula separação do técnico 1 (Lucas) -> cria RASCUNHO
    const calcRes = await fetch(`${srv.baseUrl}/api/coord/separacoes/calcular`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json', Cookie: coordCookie },
      body: JSON.stringify({ tecnicoId: 1 }),
    });
    assert.equal(calcRes.status, 201);
    const sep = (await calcRes.json()) as SeparacaoCoordenadorDTO;
    assert.equal(sep.status, 'RASCUNHO');
    assert.equal(sep.competencia, '2026-10');

    // 1b. Observação foi removida da rodada: payload com o campo é recusado de forma clara (issue 02)
    const calcComObsRes = await fetch(`${srv.baseUrl}/api/coord/separacoes/calcular`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json', Cookie: coordCookie },
      body: JSON.stringify({ tecnicoId: 1, observacoes: 'qualquer coisa' }),
    });
    assert.equal(calcComObsRes.status, 400);
    const calcComObsJson = (await calcComObsRes.json()) as { code?: string };
    assert.equal(calcComObsJson.code, 'VALIDATION_ERROR');

    // 2. Rascunho deve ser INVISÍVEL ao estoque
    const filaAntes = await fetch(`${srv.baseUrl}/api/estoque/fila`, {
      headers: { 'X-Requested-With': 'Brasilink', Cookie: estoqueCookie },
    });
    assert.equal(filaAntes.status, 200);
    const filaAntesJson = (await filaAntes.json()) as SeparacaoEstoqueFilaDTO[];
    assert.equal(filaAntesJson.length, 0);

    const detalheDraftRes = await fetch(`${srv.baseUrl}/api/estoque/fila/${sep.id}`, {
      headers: { 'X-Requested-With': 'Brasilink', Cookie: estoqueCookie },
    });
    assert.equal(detalheDraftRes.status, 403);

    // 3. Estoque não pode acessar rotas de Coordenador
    const coordRouteAsEstoque = await fetch(`${srv.baseUrl}/api/coord/separacoes/${sep.id}`, {
      headers: { 'X-Requested-With': 'Brasilink', Cookie: estoqueCookie },
    });
    assert.equal(coordRouteAsEstoque.status, 403);

    // 4. Ajuste no rascunho exige justificativa
    const itemConector = sep.itens.find((i) => i.itemCodigo === 'MAT-001')!;
    const ajusteSemJustRes = await fetch(
      `${srv.baseUrl}/api/coord/separacoes/${sep.id}/itens/${itemConector.id}`,
      {
        method: 'PATCH',
        headers: { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json', Cookie: coordCookie },
        body: JSON.stringify({ quantidadeSolicitada: 20, justificativa: '' }),
      }
    );
    assert.equal(ajusteSemJustRes.status, 400);

    // Ajuste válido no rascunho
    const ajusteOkRes = await fetch(
      `${srv.baseUrl}/api/coord/separacoes/${sep.id}/itens/${itemConector.id}`,
      {
        method: 'PATCH',
        headers: { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json', Cookie: coordCookie },
        body: JSON.stringify({ quantidadeSolicitada: 20, justificativa: 'Reforço de instalação na zona norte' }),
      }
    );
    assert.equal(ajusteOkRes.status, 200);
    const sepAjustada = (await ajusteOkRes.json()) as SeparacaoCoordenadorDTO;
    const conectorAjustado = sepAjustada.itens.find((i) => i.itemCodigo === 'MAT-001')!;
    assert.equal(conectorAjustado.quantidadeSolicitada, 20);
    assert.equal(conectorAjustado.quantidadeCalculadaOriginal, itemConector.quantidadeSolicitada);

    // 5. Envio ao estoque muda status para CALCULADA (sem baixar estoque)
    const estoqueAntesEnvio = (
      srv.db.prepare("SELECT estoque_atual FROM itens WHERE codigo = 'MAT-001'").get() as { estoque_atual: number }
    ).estoque_atual;
    assert.equal(estoqueAntesEnvio, 180);

    const enviarRes = await fetch(`${srv.baseUrl}/api/coord/separacoes/${sep.id}/enviar`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'Brasilink', Cookie: coordCookie },
    });
    assert.equal(enviarRes.status, 200);
    const sepEnviada = (await enviarRes.json()) as SeparacaoCoordenadorDTO;
    assert.equal(sepEnviada.status, 'CALCULADA');

    const estoqueAposEnvio = (
      srv.db.prepare("SELECT estoque_atual FROM itens WHERE codigo = 'MAT-001'").get() as { estoque_atual: number }
    ).estoque_atual;
    assert.equal(estoqueAposEnvio, 180, 'Envio não pode dar baixa no estoque');

    // 6. Ajuste após envio deve ser rejeitado (somente em RASCUNHO)
    const ajustePosEnvio = await fetch(
      `${srv.baseUrl}/api/coord/separacoes/${sep.id}/itens/${itemConector.id}`,
      {
        method: 'PATCH',
        headers: { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json', Cookie: coordCookie },
        body: JSON.stringify({ quantidadeSolicitada: 25, justificativa: 'Tentativa pós-envio' }),
      }
    );
    assert.equal(ajustePosEnvio.status, 409);

    // 7. Fila do estoque lista a separação e DTO estrito não expõe parâmetros internos
    const filaDepois = await fetch(`${srv.baseUrl}/api/estoque/fila`, {
      headers: { 'X-Requested-With': 'Brasilink', Cookie: estoqueCookie },
    });
    assert.equal(filaDepois.status, 200);
    const filaDepoisJson = (await filaDepois.json()) as SeparacaoEstoqueFilaDTO[];
    assert.equal(filaDepoisJson.length, 1);

    const detalheRes = await fetch(`${srv.baseUrl}/api/estoque/fila/${sep.id}`, {
      headers: { 'X-Requested-With': 'Brasilink', Cookie: estoqueCookie },
    });
    assert.equal(detalheRes.status, 200);
    const detalheJson = (await detalheRes.json()) as SeparacaoEstoqueDetalheDTO & Record<string, unknown>;
    assert.equal(detalheJson.status, 'CALCULADA');
    const firstItemRaw = detalheJson.itens[0] as unknown as Record<string, unknown>;
    assert.equal('usoMesAnterior' in firstItemRaw, false);
    assert.equal('demandaDiariaInformativa' in firstItemRaw, false);
    assert.equal('minimoEfetivo' in firstItemRaw, false);
    assert.equal('limiteMaximo' in firstItemRaw, false);
    assert.equal('saldoTecnico' in firstItemRaw, false);

    // 8. Entrega parcial no estoque: entrega apenas 12 de 20 para MAT-001 e 0 para os demais
    const itensEntrega = detalheJson.itens.map((item) => ({
      separacaoItemId: item.id,
      quantidadeEntregue: item.codigo === 'MAT-001' ? 12 : 0,
    }));

    const confirmarRes = await fetch(`${srv.baseUrl}/api/estoque/fila/${sep.id}/confirmar`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json', Cookie: estoqueCookie },
      body: JSON.stringify({ versaoEstoque: detalheJson.versaoEstoque, itens: itensEntrega }),
    });
    assert.equal(confirmarRes.status, 200);
    const confirmado = (await confirmarRes.json()) as SeparacaoEstoqueDetalheDTO;
    assert.equal(confirmado.status, 'SEPARADA');

    // Estoque de MAT-001 baixou de 180 para 168
    const estoqueAposConfirmacao = (
      srv.db.prepare("SELECT estoque_atual FROM itens WHERE codigo = 'MAT-001'").get() as { estoque_atual: number }
    ).estoque_atual;
    assert.equal(estoqueAposConfirmacao, 168);

    // 9. Dupla confirmação concorrente deve ser rejeitada (409)
    const duplaRes = await fetch(`${srv.baseUrl}/api/estoque/fila/${sep.id}/confirmar`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json', Cookie: estoqueCookie },
      body: JSON.stringify({ versaoEstoque: detalheJson.versaoEstoque, itens: itensEntrega }),
    });
    assert.equal(duplaRes.status, 409);

    // 10. Pendência remanescente visível (20 - 12 = 8 para MAT-001)
    const pendRes = await fetch(`${srv.baseUrl}/api/estoque/pendencias`, {
      headers: { 'X-Requested-With': 'Brasilink', Cookie: estoqueCookie },
    });
    assert.equal(pendRes.status, 200);
    const pendencias = (await pendRes.json()) as PendenciaDTO[];
    const pendConector = pendencias.find((p) => p.itemNome.includes('Conector'));
    assert.ok(pendConector);
    assert.equal(pendConector.quantidadeSolicitada, 20);
    assert.equal(pendConector.quantidadeReferencia, 12);
    assert.equal(pendConector.diferenca, 8);
    assert.equal(pendConector.status, 'ABERTA');

    // 11. Segundo cálculo após entrega usa saldo atualizado do técnico (12 inicial + 12 entregues = 24)
    const calc2Res = await fetch(`${srv.baseUrl}/api/coord/separacoes/calcular`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json', Cookie: coordCookie },
      body: JSON.stringify({ tecnicoId: 1 }),
    });
    assert.equal(calc2Res.status, 201);
    const sep2 = (await calc2Res.json()) as SeparacaoCoordenadorDTO;
    const conectorSep2 = sep2.itens.find((i) => i.itemCodigo === 'MAT-001')!;
    assert.equal(conectorSep2.saldoTecnico, 24, 'Segundo cálculo deve refletir o saldo incrementado pela entrega anterior');

    // 12. Alterações futuras no catálogo não reescrevem o snapshot da primeira separação
    await fetch(`${srv.baseUrl}/api/coord/itens/${itemConector.itemId}`, {
      method: 'PATCH',
      headers: { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json', Cookie: coordCookie },
      body: JSON.stringify({ limiteMaximo: 99 }),
    });
    const sep1Reloaded = await (
      await fetch(`${srv.baseUrl}/api/coord/separacoes/${sep.id}`, {
        headers: { 'X-Requested-With': 'Brasilink', Cookie: coordCookie },
      })
    ).json() as SeparacaoCoordenadorDTO;
    assert.equal(
      sep1Reloaded.itens.find((i) => i.itemCodigo === 'MAT-001')!.limiteMaximo,
      60,
      'Snapshot histórico não deve ser alterado após mudança no catálogo'
    );
  } finally {
    await srv.close();
  }
});

test('Rejeição por estoque desatualizado quando saldo do almoxarifado muda antes da confirmação', async () => {
  const srv = await startTestServer(new Date('2026-11-19T14:00:00.000Z'));
  try {
    const coordCookie = await loginAs(srv.baseUrl, 'coordenador', 'Coord@2026');
    const estoqueCookie = await loginAs(srv.baseUrl, 'estoque', 'Estoque@2026');

    const sep = (await (
      await fetch(`${srv.baseUrl}/api/coord/separacoes/calcular`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json', Cookie: coordCookie },
        body: JSON.stringify({ tecnicoId: 1 }),
      })
    ).json()) as SeparacaoCoordenadorDTO;

    await fetch(`${srv.baseUrl}/api/coord/separacoes/${sep.id}/enviar`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'Brasilink', Cookie: coordCookie },
    });

    const detalhe = (await (
      await fetch(`${srv.baseUrl}/api/estoque/fila/${sep.id}`, {
        headers: { 'X-Requested-With': 'Brasilink', Cookie: estoqueCookie },
      })
    ).json()) as SeparacaoEstoqueDetalheDTO;

    // Simula alteração externa no estoque de um item após o carregamento da tela
    srv.db.prepare("UPDATE itens SET estoque_atual = 1 WHERE codigo = 'MAT-001'").run();

    const confirmarRes = await fetch(`${srv.baseUrl}/api/estoque/fila/${sep.id}/confirmar`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'Brasilink', 'Content-Type': 'application/json', Cookie: estoqueCookie },
      body: JSON.stringify({
        versaoEstoque: detalhe.versaoEstoque,
        itens: detalhe.itens.map((i) => ({ separacaoItemId: i.id, quantidadeEntregue: i.quantidadeASeparar })),
      }),
    });
    assert.equal(confirmarRes.status, 409);
  } finally {
    await srv.close();
  }
});


test('Segurança: cookie-only, hash de sessão, headers e rejeição de Bearer/cookie inválido', async () => {
  const srv = await startTestServer();
  try {
    const res = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Brasilink' },
      body: JSON.stringify({ username: 'coordenador', password: 'Coord@2026' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).token, undefined);
    const cookie = res.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const raw = cookie.split(';')[0].split('=')[1];
    const stored = srv.db.prepare('SELECT token FROM sessoes').get() as { token: string };
    assert.match(stored.token, /^sha256:/); assert.notEqual(raw, stored.token);
    assert.equal((await fetch(`${srv.baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${raw}` } })).status, 401);
    assert.equal((await fetch(`${srv.baseUrl}/api/auth/me`, { headers: { Cookie: 'brasilink_sid=%broken' } })).status, 401);
    assert.equal((await fetch(`${srv.baseUrl}/api/auth/me`, { headers: { Cookie: cookie.split(';')[0] } })).status, 200);
    assert.equal((await fetch(`${srv.baseUrl}/api/coord/usuarios/1e999`, { method: 'PATCH', headers: { Cookie: cookie.split(';')[0], 'X-Requested-With': 'Brasilink' } })).status, 400);
  } finally { await srv.close(); }
});

test('Segurança: CSRF exige header e origem, incluindo login e logout', async () => {
  const srv = await startTestServer();
  try {
    const body = JSON.stringify({ username: 'coordenador', password: 'Coord@2026' });
    const cases: Record<string, string>[] = [
      { 'Content-Type': 'application/json' },
      { 'Content-Type': 'application/json', 'X-Requested-With': 'Brasilink', Origin: 'https://malicioso.example' },
      { 'Content-Type': 'application/json', 'X-Requested-With': 'Brasilink', 'Sec-Fetch-Site': 'cross-site' },
    ];
    for (const headers of cases) {
      assert.equal((await fetch(`${srv.baseUrl}/api/auth/login`, { method: 'POST', headers, body })).status, 403);
    }
    const cookie = await loginAs(srv.baseUrl, 'coordenador', 'Coord@2026');
    assert.equal((await fetch(`${srv.baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } })).status, 403);
    assert.equal((await fetch(`${srv.baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${srv.baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie, 'X-Requested-With': 'Brasilink', Origin: srv.baseUrl } })).status, 200);
    assert.equal((await fetch(`${srv.baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })).status, 401);
  } finally { await srv.close(); }
});

test('Segurança: força bruta limitada por usuário e IP, sem confiar em X-Forwarded-For', async () => {
  const srv = await startTestServer();
  try {
    const attempt = (username: string, ip: string) => fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Brasilink', 'X-Forwarded-For': ip },
      body: JSON.stringify({ username, password: 'errada' }),
    });
    for (let i = 0; i < 5; i++) assert.equal((await attempt('coordenador', `10.0.0.${i}`)).status, 401);
    const blocked = await attempt('COORDENADOR', '10.1.1.1');
    assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '900');
    for (let i = 0; i < 15; i++) assert.equal((await attempt(`inexistente${i}`, `10.2.0.${i}`)).status, 401);
    assert.equal((await attempt('outro', '10.3.0.1')).status, 429);
  } finally { await srv.close(); }
});

test('Segurança: limite JSON explícito, JSON malformado, tipos e tamanho de campos', async () => {
  const srv = await startTestServer();
  try {
    const post = (body: string) => fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Brasilink' }, body,
    });
    assert.equal((await post(JSON.stringify({ username: 'x', password: 'x'.repeat(110000) }))).status, 413);
    assert.equal((await post('{')).status, 400);
    assert.equal((await post(JSON.stringify({ username: {}, password: 'x' }))).status, 400);
    assert.equal((await post(JSON.stringify({ username: 'x', password: 'x'.repeat(129) }))).status, 400);
    assert.equal((await post('[]')).status, 400);
  } finally { await srv.close(); }
});

test('Segurança: senha forte, revogação após reset e troca de perfil', async () => {
  const srv = await startTestServer();
  try {
    const coord = await loginAs(srv.baseUrl, 'coordenador', 'Coord@2026');
    const stock = await loginAs(srv.baseUrl, 'estoque', 'Estoque@2026');
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'Brasilink', Cookie: coord };
    const reset = (novaSenha: string) => fetch(`${srv.baseUrl}/api/coord/usuarios/2/reset-password`, { method: 'POST', headers, body: JSON.stringify({ novaSenha }) });
    assert.equal((await reset('curta')).status, 400);
    assert.equal((await reset('UmaFraseLonga@2026')).status, 200);
    assert.equal((await fetch(`${srv.baseUrl}/api/auth/me`, { headers: { Cookie: stock } })).status, 401);
    const renewed = await loginAs(srv.baseUrl, 'estoque', 'UmaFraseLonga@2026');
    assert.equal((await fetch(`${srv.baseUrl}/api/coord/usuarios/2`, { method: 'PATCH', headers, body: JSON.stringify({ perfil: 'COORDENADOR' }) })).status, 200);
    assert.equal((await fetch(`${srv.baseUrl}/api/auth/me`, { headers: { Cookie: renewed } })).status, 401);
    assert.equal((await fetch(`${srv.baseUrl}/api/coord/usuarios`, { method: 'POST', headers, body: JSON.stringify({ nome: 'Teste', username: 'teste', password: '123456', perfil: 'ESTOQUE' }) })).status, 400);
  } finally { await srv.close(); }
});

test('Segurança: configuração de produção exige HTTPS e emite CSP/HSTS/cookie Secure', async () => {
  const saved = { node: process.env.NODE_ENV, origin: process.env.PUBLIC_ORIGIN };
  const db = createDatabase(':memory:');
  try {
    process.env.NODE_ENV = 'production'; delete process.env.PUBLIC_ORIGIN;
    assert.throws(() => createApp(db), /HTTPS/);
    process.env.PUBLIC_ORIGIN = 'http://estoque.example';
    assert.throws(() => createApp(db), /HTTPS/);
    process.env.PUBLIC_ORIGIN = 'https://estoque.example';
    const srv = await startTestServer();
    try {
      const res = await fetch(`${srv.baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Brasilink', Origin: 'https://estoque.example' }, body: JSON.stringify({ username: 'coordenador', password: 'Coord@2026' }) });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('set-cookie')!, /Secure/);
      assert.match(res.headers.get('content-security-policy')!, /script-src 'self'/);
      assert.equal(res.headers.get('strict-transport-security'), 'max-age=31536000');
    } finally { await srv.close(); }
  } finally {
    db.close();
    if (saved.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.node;
    if (saved.origin === undefined) delete process.env.PUBLIC_ORIGIN; else process.env.PUBLIC_ORIGIN = saved.origin;
  }
});


test('Auditoria persistente: registra operações e bloqueios sem senha/token e isola perfil', async () => {
  const srv = await startTestServer();
  try {
    const coord = await loginAs(srv.baseUrl, 'coordenador', 'Coord@2026');
    const estoque = await loginAs(srv.baseUrl, 'estoque', 'Estoque@2026');
    const result = await fetch(`${srv.baseUrl}/api/coord/auditoria?limit=1`, { headers: { Cookie: coord } });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).length, 1);
    assert.equal(result.headers.get('x-page-limit'), '1');
    assert.equal((await fetch(`${srv.baseUrl}/api/coord/auditoria`, { headers: { Cookie: estoque } })).status, 403);
    const rows = srv.db.prepare('SELECT * FROM audit_logs ORDER BY id').all() as { evento: string; status: number }[];
    assert.ok(rows.some(r => r.evento === 'AUTH_LOGIN' && r.status === 200));
    assert.ok(rows.some(r => r.evento === 'ACCESS_REJECTED' && r.status === 403));
    const content = JSON.stringify(rows);
    assert.ok(!content.includes('Coord@2026')); assert.ok(!content.includes('Estoque@2026'));
    assert.ok(!content.includes(coord.split('=')[1])); assert.ok(!content.includes('127.0.0.1'));
  } finally { await srv.close(); }
});

test('Schemas completos e paginação: rejeita coerção insegura, campos extras e filtros inválidos', async () => {
  const srv = await startTestServer();
  try {
    const coord = await loginAs(srv.baseUrl, 'coordenador', 'Coord@2026');
    const headers = { Cookie: coord, 'Content-Type': 'application/json', 'X-Requested-With': 'Brasilink' };
    assert.equal((await fetch(`${srv.baseUrl}/api/coord/itens/1`, { method: 'PATCH', headers, body: JSON.stringify({ estoqueAtual: true }) })).status, 400);
    assert.equal((await fetch(`${srv.baseUrl}/api/coord/itens/1`, { method: 'PATCH', headers, body: JSON.stringify({ estoqueAtual: 2147483648 }) })).status, 400);
    assert.equal((await fetch(`${srv.baseUrl}/api/coord/usuarios/1`, { method: 'PATCH', headers, body: JSON.stringify({ senha_hash: 'injetado' }) })).status, 400);
    for (const query of ['limit=501', 'offset=-1', 'status=INVENTADO', 'competencia=2026-13', 'extra=1']) {
      assert.equal((await fetch(`${srv.baseUrl}/api/coord/separacoes?${query}`, { headers })).status, 400);
    }
    const first = await fetch(`${srv.baseUrl}/api/coord/tecnicos?limit=1&offset=0`, { headers });
    const second = await fetch(`${srv.baseUrl}/api/coord/tecnicos?limit=1&offset=1`, { headers });
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    const a = await first.json(); const b = await second.json();
    assert.equal(a.length, 1); assert.equal(b.length, 1); assert.notEqual(a[0].id, b[0].id);
  } finally { await srv.close(); }
});


test('Proteção da auditoria: limite geral da API rejeita excesso sem gravar mais linhas', async () => {
  const srv = await startTestServer();
  try {
    for (let i = 0; i < 120; i++) assert.equal((await fetch(`${srv.baseUrl}/api/auth/me`)).status, 401);
    const before = (srv.db.prepare('SELECT COUNT(*) AS count FROM audit_logs').get() as { count: number }).count;
    const blocked = await fetch(`${srv.baseUrl}/api/auth/me`);
    assert.equal(blocked.status, 429); assert.equal((await blocked.json()).code, 'API_RATE_LIMITED');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.equal((srv.db.prepare('SELECT COUNT(*) AS count FROM audit_logs').get() as { count: number }).count, before);
  } finally { await srv.close(); }
});
