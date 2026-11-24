import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Meta-teste de cobertura de autenticação (inspirado no padrão authCoverage do TalkGo).
// Lê server/app.ts como texto e reprova o CI se:
//  1. alguma rota nova não estiver na tabela COBERTURA;
//  2. alguma rota não-pública não usar requireAuth + requireRole (ou requireAuth, se o tipo exigir);
//  3. a tabela citar rota que não existe mais (verificação inversa).
// Exceção de rota pendente exige motivo preenchido — a exceção fica explícita, nunca implícita.

const appSource = fs.readFileSync(path.join(import.meta.dirname, '..', 'server', 'app.ts'), 'utf8');

const PUBLICA: Record<string, string> = {
  '/api/auth/login': 'login é público por natureza; protegido por rate limit de tentativas',
  '/api/auth/logout': 'limpa o cookie da própria chamada; idempotente, sem efeito sobre dados de terceiros (achado reportado para adicionar requireAuth depois)',
};
const SOLE_AUTH: Record<string, string> = { '/api/auth/me': 'identifica a sessão do próprio usuário; exige login, sem papel específico' };

// Uma entrada por rota registrada: onde a proteção dela é testada.
const COBERTURA: Record<string, string> = {
  '/api/auth/login': 'tests/fluxo-api.test.ts e tests/security-regression.test.ts (rate limit e credenciais)',
  '/api/auth/logout': 'tests/fluxo-api.test.ts',
  '/api/auth/me': 'tests/fluxo-api.test.ts',
  '/api/coord/summary': 'tests/fluxo-api.test.ts',
  '/api/coord/tecnicos': 'tests/fluxo-api.test.ts e tests/tecnicos-filial.test.ts',
  '/api/coord/tecnicos/ixc/buscar': 'tests/tecnicos-filial.test.ts (proteção e indisponibilidade explícita até a API IXC existir)',
  '/api/coord/tecnicos/:id': 'tests/fluxo-api.test.ts',
  '/api/coord/itens': 'tests/fluxo-api.test.ts, tests/security-regression.test.ts e tests/stock-safety.test.ts',
  '/api/coord/itens/ixc/buscar': 'tests/produtos-ixc.test.ts (proteção e indisponibilidade explícita até a API IXC existir)',
  '/api/coord/itens/:id': 'tests/security-regression.test.ts',
  '/api/coord/parametros/:tecnicoId': 'tests/fluxo-api.test.ts',
  '/api/coord/parametros/:tecnicoId/:itemId': 'tests/fluxo-api.test.ts',
  '/api/coord/usuarios': 'tests/fluxo-api.test.ts e tests/security-regression.test.ts',
  '/api/coord/usuarios/:id': 'tests/security-regression.test.ts',
  '/api/coord/usuarios/:id/reset-password': 'tests/security-regression.test.ts',
  '/api/coord/separacoes/calcular': 'tests/fluxo-api.test.ts e tests/regras.test.ts',
  '/api/coord/separacoes': 'tests/fluxo-api.test.ts',
  '/api/coord/separacoes/:id': 'tests/fluxo-api.test.ts',
  '/api/coord/separacoes/:id/itens/:sepItemId': 'tests/fluxo-api.test.ts e tests/stock-safety.test.ts',
  '/api/coord/separacoes/:id/enviar': 'tests/fluxo-api.test.ts',
  '/api/coord/separacoes/:id/csv': 'tests/fluxo-api.test.ts',
  '/api/coord/pendencias': 'tests/fluxo-api.test.ts',
  '/api/coord/auditoria': 'tests/fluxo-api.test.ts e tests/security-regression.test.ts',
  '/api/estoque/fila': 'tests/fluxo-api.test.ts e tests/stock-safety.test.ts',
  '/api/estoque/fila/:id': 'tests/stock-safety.test.ts',
  '/api/estoque/fila/:id/confirmar': 'tests/fluxo-api.test.ts e tests/stock-safety.test.ts',
  '/api/estoque/fila/:id/csv': 'tests/fluxo-api.test.ts',
  '/api/estoque/pendencias': 'tests/fluxo-api.test.ts',
};

const rotasRegistradas = new Map();
for (const linha of appSource.split('\n')) {
  const match = linha.match(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/);
  if (!match) continue;
  const [, metodo, rota] = match;
  const chave = `${metodo.toUpperCase()} ${rota}`;
  rotasRegistradas.set(chave, { metodo, rota, linha });
}

test('Toda rota registrada em server/app.ts está declarada na tabela de cobertura', () => {
  const faltando = [...rotasRegistradas.keys()].filter((chave) => !COBERTURA[chave.split(' ')[1]]);
  assert.deepEqual(faltando, [], 'Rota(s) sem entrada em COBERTURA — declare a autenticação dela antes do merge: ' + faltando.join(', '));
});

test('A tabela de cobertura não cita rotas que não existem mais (verificação inversa)', () => {
  const caminhosNoCodigo = new Set([...rotasRegistradas.values()].map((r) => r.rota));
  const fantasmas = Object.keys(COBERTURA).filter((rota) => !caminhosNoCodigo.has(rota));
  assert.deepEqual(fantasmas, [], 'A tabela cita rota(s) que não existe(m) mais em app.ts: ' + fantasmas.join(', '));
});

test('Toda rota não-pública usa requireAuth com requireRole (ou requireAuth sozinho quando justificado)', () => {
  const violacoes = [];
  for (const { metodo, rota, linha } of rotasRegistradas.values()) {
    if (PUBLICA[rota]) {
      if (linha.includes('requireAuth')) violacoes.push(`${metodo} ${rota} é pública mas usa requireAuth`);
      continue;
    }
    if (!linha.includes('requireAuth')) violacoes.push(`${metodo} ${rota} sem requireAuth`);
    if (!SOLE_AUTH[rota] && rota.startsWith('/api/') && !linha.includes('requireRole')) {
      violacoes.push(`${metodo} ${rota} sem requireRole (use SOLE_AUTH se o acesso for só por login)`);
    }
  }
  assert.deepEqual(violacoes, [], 'Rotas com proteção insuficiente: ' + violacoes.join(' | '));
});

test('Toda rota de escrita fica sob o middleware de escritas atômicas/auditoria', () => {
  // atomicWrites é instalado antes das rotas; auditoria de escritas/autenticação também.
  for (const alvo of [`app.use('/api', atomicWrites`, `app.use('/api', auditRequests(`]) {
    assert.ok(appSource.includes(alvo), `Middleware esperado ausente em /api: ${alvo}`);
  }
});
