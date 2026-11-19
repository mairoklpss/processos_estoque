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
    headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json', Cookie: coordCookie },
      body: JSON.stringify({ tecnicoId: 1 }),
    });
    assert.equal(calcRes.status, 201);
    const sep = (await calcRes.json()) as SeparacaoCoordenadorDTO;
    assert.equal(sep.status, 'RASCUNHO');
    assert.equal(sep.competencia, '2026-10');

    // 2. Rascunho deve ser INVISÍVEL ao estoque
    const filaAntes = await fetch(`${srv.baseUrl}/api/estoque/fila`, {
      headers: { Cookie: estoqueCookie },
    });
    assert.equal(filaAntes.status, 200);
    const filaAntesJson = (await filaAntes.json()) as SeparacaoEstoqueFilaDTO[];
    assert.equal(filaAntesJson.length, 0);

    const detalheDraftRes = await fetch(`${srv.baseUrl}/api/estoque/fila/${sep.id}`, {
      headers: { Cookie: estoqueCookie },
    });
    assert.equal(detalheDraftRes.status, 403);

    // 3. Estoque não pode acessar rotas de Coordenador
    const coordRouteAsEstoque = await fetch(`${srv.baseUrl}/api/coord/separacoes/${sep.id}`, {
      headers: { Cookie: estoqueCookie },
    });
    assert.equal(coordRouteAsEstoque.status, 403);

    // 4. Ajuste no rascunho exige justificativa
    const itemConector = sep.itens.find((i) => i.itemCodigo === 'MAT-001')!;
    const ajusteSemJustRes = await fetch(
      `${srv.baseUrl}/api/coord/separacoes/${sep.id}/itens/${itemConector.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: coordCookie },
        body: JSON.stringify({ quantidadeSolicitada: 20, justificativa: '' }),
      }
    );
    assert.equal(ajusteSemJustRes.status, 400);

    // Ajuste válido no rascunho
    const ajusteOkRes = await fetch(
      `${srv.baseUrl}/api/coord/separacoes/${sep.id}/itens/${itemConector.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: coordCookie },
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
      headers: { Cookie: coordCookie },
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
        headers: { 'Content-Type': 'application/json', Cookie: coordCookie },
        body: JSON.stringify({ quantidadeSolicitada: 25, justificativa: 'Tentativa pós-envio' }),
      }
    );
    assert.equal(ajustePosEnvio.status, 409);

    // 7. Fila do estoque lista a separação e DTO estrito não expõe parâmetros internos
    const filaDepois = await fetch(`${srv.baseUrl}/api/estoque/fila`, {
      headers: { Cookie: estoqueCookie },
    });
    assert.equal(filaDepois.status, 200);
    const filaDepoisJson = (await filaDepois.json()) as SeparacaoEstoqueFilaDTO[];
    assert.equal(filaDepoisJson.length, 1);

    const detalheRes = await fetch(`${srv.baseUrl}/api/estoque/fila/${sep.id}`, {
      headers: { Cookie: estoqueCookie },
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
      headers: { 'Content-Type': 'application/json', Cookie: estoqueCookie },
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
      headers: { 'Content-Type': 'application/json', Cookie: estoqueCookie },
      body: JSON.stringify({ versaoEstoque: detalheJson.versaoEstoque, itens: itensEntrega }),
    });
    assert.equal(duplaRes.status, 409);

    // 10. Pendência remanescente visível (20 - 12 = 8 para MAT-001)
    const pendRes = await fetch(`${srv.baseUrl}/api/estoque/pendencias`, {
      headers: { Cookie: estoqueCookie },
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
      headers: { 'Content-Type': 'application/json', Cookie: coordCookie },
      body: JSON.stringify({ tecnicoId: 1 }),
    });
    assert.equal(calc2Res.status, 201);
    const sep2 = (await calc2Res.json()) as SeparacaoCoordenadorDTO;
    const conectorSep2 = sep2.itens.find((i) => i.itemCodigo === 'MAT-001')!;
    assert.equal(conectorSep2.saldoTecnico, 24, 'Segundo cálculo deve refletir o saldo incrementado pela entrega anterior');

    // 12. Alterações futuras no catálogo não reescrevem o snapshot da primeira separação
    await fetch(`${srv.baseUrl}/api/coord/itens/${itemConector.itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: coordCookie },
      body: JSON.stringify({ limiteMaximo: 99 }),
    });
    const sep1Reloaded = await (
      await fetch(`${srv.baseUrl}/api/coord/separacoes/${sep.id}`, {
        headers: { Cookie: coordCookie },
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
        headers: { 'Content-Type': 'application/json', Cookie: coordCookie },
        body: JSON.stringify({ tecnicoId: 1 }),
      })
    ).json()) as SeparacaoCoordenadorDTO;

    await fetch(`${srv.baseUrl}/api/coord/separacoes/${sep.id}/enviar`, {
      method: 'POST',
      headers: { Cookie: coordCookie },
    });

    const detalhe = (await (
      await fetch(`${srv.baseUrl}/api/estoque/fila/${sep.id}`, {
        headers: { Cookie: estoqueCookie },
      })
    ).json()) as SeparacaoEstoqueDetalheDTO;

    // Simula alteração externa no estoque de um item após o carregamento da tela
    srv.db.prepare("UPDATE itens SET estoque_atual = 1 WHERE codigo = 'MAT-001'").run();

    const confirmarRes = await fetch(`${srv.baseUrl}/api/estoque/fila/${sep.id}/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: estoqueCookie },
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
