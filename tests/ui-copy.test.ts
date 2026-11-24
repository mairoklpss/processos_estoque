import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Meta-teste de cópia de tela (ver estes critérios na issue 01):
// 1. Nenhum texto visível menciona "America/Sao_Paulo" — fuso exibido é "Brasília"
//    (o identificador técnico em código de servidor/período continua válido).
// 2. O formulário de calcular separação não tem mais o campo de observação.
const componentesDir = path.join(import.meta.dirname, '..', 'src', 'components');

function lerComponente(nome: string): string {
  return fs.readFileSync(path.join(componentesDir, nome), 'utf8');
}

function listarComponentes(): string[] {
  return fs.readdirSync(componentesDir).filter((arquivo) => arquivo.endsWith('.tsx'));
}

test('Nenhuma tela exibe o identificador técnico America/Sao_Paulo (texto visível é Brasília)', () => {
  const violacoes = listarComponentes().filter((nome) => lerComponente(nome).includes('America/Sao_Paulo'));
  assert.deepEqual(
    violacoes,
    [],
    'Componente(s) exibindo o identificador IANA na interface: ' + violacoes.join(', ') +
      ' — o texto visível deve ser "Brasília" (o identificador fica só no código técnico).',
  );
});

test('O formulário de calcular separação não tem campo de observação', () => {
  const separar = lerComponente('CoordinatorSepararView.tsx');
  assert.ok(!separar.includes('Observação (opcional)'), 'O campo "Observação (opcional)" ainda existe na aba de separar.');
});

// Issue 04: nenhum texto visível usa "Região" — o termo do projeto é "Filial" (glossário).
test('Nenhuma tela exibe "Região"; filial é o termo visível', () => {
  const violacoes = listarComponentes().filter((nome) => lerComponente(nome).includes('Regi'));
  assert.deepEqual(
    violacoes,
    [],
    'Componente(s) com texto "Região" na interface: ' + violacoes.join(', ') +
      ' — o termo visível deve ser "Filial" (glossário).',
  );
  const cadastros = lerComponente('CoordinatorCadastrosView.tsx');
  assert.ok(cadastros.includes('Filial'), 'A aba de cadastros deve exibir o rótulo "Filial".');
  const separar = lerComponente('CoordinatorSepararView.tsx');
  assert.ok(separar.includes('Sem filial'), 'A lista de técnicos deve usar "Sem filial".');
});
