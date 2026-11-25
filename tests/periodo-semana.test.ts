import assert from 'node:assert/strict';
import test from 'node:test';
import { getSemanaAtual } from '../server/periodo.ts';

// Issue 17: a identificação da separação passa a ser a semana do cálculo (domingo a sábado),
// com rótulo "22 a 28 de Novembro". O cálculo em si não muda (consumo do mês fechado anterior).

test('Semana atual: quarta 25/11/2026 cai na semana 22 a 28 de Novembro', () => {
    const s = getSemanaAtual(new Date('2026-11-25T14:00:00Z'));
    assert.equal(s.competencia, '2026-11-22');
    assert.equal(s.label, '22 a 28 de Novembro');
});

test('Semana atual: domingo e sábado pertencem à mesma semana', () => {
    const domingo = getSemanaAtual(new Date('2026-11-22T14:00:00Z'));
    assert.equal(domingo.competencia, '2026-11-22');
    const sabado = getSemanaAtual(new Date('2026-11-28T14:00:00Z'));
    assert.equal(sabado.competencia, '2026-11-22');
});

test('Semana atual: fuso de Brasília decide o dia (sábado 23h em Brasília ainda é a semana anterior)', () => {
    // 2026-11-22T02:00Z = sábado 21/11 às 23:00 em Brasília
    const s = getSemanaAtual(new Date('2026-11-22T02:00:00Z'));
    assert.equal(s.competencia, '2026-11-15');
    assert.equal(s.label, '15 a 21 de Novembro');
});

test('Semana atual: virada de mês no rótulo (29/11 a 05/12)', () => {
    // segunda 30/11/2026 pertence à semana que começa domingo 29/11
    const s = getSemanaAtual(new Date('2026-11-30T14:00:00Z'));
    assert.equal(s.competencia, '2026-11-29');
    assert.equal(s.label, '29 de Novembro a 5 de Dezembro');
});

test('Semana atual: virada de ano no rótulo (28/12 a 03/01)', () => {
    const s = getSemanaAtual(new Date('2026-12-30T14:00:00Z'));
    assert.equal(s.competencia, '2026-12-27');
    assert.equal(s.label, '27 de Dezembro a 2 de Janeiro');
});
