import assert from 'node:assert/strict';
import test from 'node:test';
import { calcularPropostaItem } from '../server/calculo.ts';
import { getClosedPreviousMonth } from '../server/periodo.ts';

test('Período fechado em America/Sao_Paulo: 31/10 às 22h locais (01/11 UTC) retorna Setembro', () => {
  // 2026-10-31T22:00:00-03:00 === 2026-11-01T01:00:00Z
  const date = new Date('2026-11-01T01:00:00.000Z');
  const res = getClosedPreviousMonth(date);
  assert.equal(res.competencia, '2026-09');
  assert.equal(res.label, 'Setembro/2026');
});

test('Período fechado em America/Sao_Paulo: virada de ano (01/01 retorna Dezembro do ano anterior)', () => {
  const date = new Date('2026-01-01T03:00:00.000Z'); // 00:00 em SP no dia 01/01/2026
  const res = getClosedPreviousMonth(date);
  assert.equal(res.competencia, '2025-12');
  assert.equal(res.label, 'Dezembro/2025');
});

test('Período fechado em America/Sao_Paulo: Março retorna Fevereiro', () => {
  const date = new Date('2026-03-10T15:00:00.000Z');
  const res = getClosedPreviousMonth(date);
  assert.equal(res.competencia, '2026-02');
  assert.equal(res.label, 'Fevereiro/2026');
});

test('Fórmula semanal provisória: teto, mínimo derivado, máximo global, saldo do técnico e falta de estoque', () => {
  // Uso = 38 => 38 / 3.1428 = 12.0911 => teto = 13
  // Sem mínimo manual => minimoEfetivo = 13 (DERIVADO)
  // Máximo = 40 => alvoKit = min(40, max(13, 13)) = 13
  // Saldo técnico = 3 => solicitada = 10
  // Estoque = 6 => disponivel = 6, faltante = 4
  const r = calcularPropostaItem({
    usoMesAnterior: 38,
    minimoManual: null,
    limiteMaximo: 40,
    saldoTecnico: 3,
    estoqueAtual: 6,
  });

  assert.equal(r.alvoBase, 13);
  assert.equal(r.minimoOrigem, 'DERIVADO');
  assert.equal(r.minimoEfetivo, 13);
  assert.equal(r.alvoKit, 13);
  assert.equal(r.quantidadeSolicitada, 10);
  assert.equal(r.quantidadeDisponivel, 6);
  assert.equal(r.faltante, 4);
  assert.equal(r.semConsumo, false);
  assert.equal(r.semSaldoAlmoxarifado, false);
});

test('Mínimo manual por técnico e teto pelo máximo global do produto', () => {
  // Uso = 10 => alvoBase = ceil(10 / 3.1428) = 4
  // Mínimo manual = 25, Máximo = 20 => alvoKit = min(20, max(4, 25)) = 20
  // Sinaliza alerta de mínimo manual > máximo
  const r = calcularPropostaItem({
    usoMesAnterior: 10,
    minimoManual: 25,
    limiteMaximo: 20,
    saldoTecnico: 5,
    estoqueAtual: 100,
  });

  assert.equal(r.alvoBase, 4);
  assert.equal(r.minimoOrigem, 'MANUAL');
  assert.equal(r.minimoEfetivo, 25);
  assert.equal(r.alvoKit, 20);
  assert.equal(r.quantidadeSolicitada, 15);
  assert.equal(r.alertaMinimoMaiorMaximo, true);
  assert.equal(r.comparacaoLimites, 'ABAIXO_MINIMO'); // 10 < 25
});

test('Consumo zero resulta em quantidade solicitada zero com aviso Sem consumo', () => {
  const r = calcularPropostaItem({
    usoMesAnterior: 0,
    minimoManual: 10,
    limiteMaximo: 50,
    saldoTecnico: 0,
    estoqueAtual: 100,
  });

  assert.equal(r.semConsumo, true);
  assert.equal(r.quantidadeSolicitada, 0);
  assert.equal(r.quantidadeDisponivel, 0);
  assert.equal(r.faltante, 0);
});

test('Demanda diária = uso / 22 somente informativa e nunca altera o cálculo', () => {
  // Uso = 22 => demandaDiaria = 1.00; 22 / 3.1428 = 7.0001... => teto = 8
  const r = calcularPropostaItem({
    usoMesAnterior: 22,
    minimoManual: null,
    limiteMaximo: 50,
    saldoTecnico: 2,
    estoqueAtual: 50,
  });

  assert.equal(r.demandaDiariaInformativa, 1);
  assert.equal(r.alvoBase, 8);
  assert.equal(r.alvoKit, 8);
  assert.equal(r.quantidadeSolicitada, 6);
});

test('Alertas de régua (abaixo, dentro, acima) e consumo atípico apenas acima do máximo global', () => {
  const abaixo = calcularPropostaItem({
    usoMesAnterior: 8,
    minimoManual: 12,
    limiteMaximo: 30,
    saldoTecnico: 0,
    estoqueAtual: 20,
  });
  assert.equal(abaixo.comparacaoLimites, 'ABAIXO_MINIMO');
  assert.equal(abaixo.consumoAtipico, false);

  const dentro = calcularPropostaItem({
    usoMesAnterior: 30,
    minimoManual: 10,
    limiteMaximo: 30,
    saldoTecnico: 0,
    estoqueAtual: 20,
  });
  assert.equal(dentro.comparacaoLimites, 'DENTRO_LIMITES');
  assert.equal(dentro.consumoAtipico, false);

  const acima = calcularPropostaItem({
    usoMesAnterior: 31,
    minimoManual: 10,
    limiteMaximo: 30,
    saldoTecnico: 0,
    estoqueAtual: 0,
  });
  assert.equal(acima.comparacaoLimites, 'ACIMA_MAXIMO');
  assert.equal(acima.consumoAtipico, true);
  assert.equal(acima.semSaldoAlmoxarifado, true);
});


import { gerarCsvSeparacaoSimples } from '../server/services.ts';
test('Segurança: CSV neutraliza fórmulas com espaços e caracteres de controle', () => {
  for (const nome of ['=1+1', '  =1+1', String.fromCharCode(9) + '=1+1', String.fromCharCode(13) + '=1+1', '+CMD', '@SUM(1)']) {
    const csv = gerarCsvSeparacaoSimples([{ codigo: 'MAT', nome, unidade: 'un', quantidadeASeparar: 1 }]);
    assert.ok(csv.includes(`'${nome}`));
    if (nome.includes(String.fromCharCode(13))) assert.ok(csv.includes(`"'${nome}"`));
  }
});
