import assert from 'node:assert/strict';
import test from 'node:test';
import { competenciaAtualBrasilia, formatCompetenciaBR } from '../src/shared/competencia.ts';

// Issue 07: o histórico abre no mês de competência corrente no fuso de Brasília.
// O mês muda às 03:00 UTC (meia-noite de Brasília), não à meia-noite UTC.

test('Competência corrente acompanha a virada do dia em Brasília, não a UTC', () => {
    // 31/10 às 23:59 em Brasília (02:59 UTC de 01/11) ainda é OUTUBRO
    assert.equal(competenciaAtualBrasilia(new Date('2026-11-01T02:59:59Z')), '2026-10');
    // 01/11 à meia-noite em Brasília (03:00 UTC) já é NOVEMBRO
    assert.equal(competenciaAtualBrasilia(new Date('2026-11-01T03:00:00Z')), '2026-11');
});

test('Competência corrente trata a virada de ano em Brasília', () => {
    // 31/12/2026 23:59 em Brasília (02:59 UTC de 01/01/2027) ainda é DEZEMBRO de 2026
    assert.equal(competenciaAtualBrasilia(new Date('2027-01-01T02:59:59Z')), '2026-12');
    assert.equal(competenciaAtualBrasilia(new Date('2027-01-01T03:00:00Z')), '2027-01');
});

// Exibição da competência em formato numérico DD/MM/AAAA (primeiro dia do mês),
// no lugar do nome por extenso (ex.: "Novembro/2026" → "01/11/2026").
test('Competência exibida como DD/MM/AAAA (primeiro dia do mês), com fallback seguro', () => {
    assert.equal(formatCompetenciaBR('2026-11'), '01/11/2026');
    assert.equal(formatCompetenciaBR('2027-01'), '01/01/2027');
    assert.equal(formatCompetenciaBR('2025-02'), '01/02/2025');
    // valores inesperados não quebram a tela: volta como vieram
    assert.equal(formatCompetenciaBR('formato-estranho'), 'formato-estranho');
    assert.equal(formatCompetenciaBR(''), '');
});
