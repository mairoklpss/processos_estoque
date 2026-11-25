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

// Issue 14: Qtd. solicitada em destaque azul; issue 13: coluna "Qtd. disponível no estoque"
// mostrando o estoque total do snapshot (não mais o valor limitado ao pedido).
test('Fila do estoque: solicitada em azul e coluna de estoque total', () => {
  const fila = lerComponente('EstoqueFilaView.tsx');
  assert.ok(fila.includes('Qtd. disponível no estoque'), 'Rótulo "Qtd. disponível no estoque" ausente.');
  assert.ok(!fila.includes('p/ separar'), 'Rótulo antigo "p/ separar" ainda presente.');
  assert.ok(
    /<td className="[^"\n]*text-\[#0F4C81\][^"\n]*"[^>]*>\s*\{item\.quantidadeSolicitada\}/.test(fila),
    'A célula da Qtd. solicitada não está em destaque azul.',
  );
  assert.ok(fila.includes('item.estoqueDisponivel'), 'A coluna deve mostrar o estoque total do snapshot (item.estoqueDisponivel).');
});

// Issue 05 (ampliada): técnicos chegam do IXC — sem cadastro livre na interface; busca por ID ou nome
// com adição por confirmação fica preparada (desligada até a API IXC existir); coluna mostra "ID IXC".
test('Técnicos: sem formulário livre, busca IXC preparada (ID ou nome) e coluna ID IXC', () => {
  const cadastros = lerComponente('CoordinatorCadastrosView.tsx');
  const proibidos = ['Cadastrar novo técnico', 'Editar técnico', 'Técnico atualizado.', 'Técnico cadastrado.', "'Adicionar técnico'"];
  const encontrados = proibidos.filter((texto) => cadastros.includes(texto));
  assert.deepEqual(
    encontrados,
    [],
    'Formulário de cadastro/edição de técnico ainda presente: ' + encontrados.join(', '),
  );
  assert.ok(cadastros.includes('Adicionar técnico do IXC'), 'Botão "Adicionar técnico do IXC" ausente.');
  assert.ok(cadastros.includes('Sincronizar com IXC'), 'Botão "Sincronizar com IXC" ausente.');
  assert.ok(cadastros.includes('Buscar por ID') && cadastros.includes('Buscar por nome'), 'As duas opções de busca (ID e nome) precisam estar preparadas.');
  assert.ok(cadastros.includes('Disponível quando a integração IXC for ativada'), 'Aviso de que a busca só funciona com a API IXC ausente.');
  assert.ok(cadastros.includes('handleToggleTecnico'), 'Ativar/Desativar técnico deve continuar funcionando.');
  assert.ok(!/Matr[íi]cula/.test(cadastros.split('ABA TÉCNICOS')[1]?.split('ABA PRODUTOS')[0] ?? ''), 'A lista de técnicos não deve usar o rótulo "Matrícula"; use "ID IXC".');
  assert.ok(/ID IXC/.test(cadastros), 'Coluna "ID IXC" ausente na lista de técnicos.');
});

// Issue 06: produtos vindos do IXC — sem cadastro livre; estoque/descrição não editáveis;
// Máx. global continua editável na lista; busca por ID ou nome preparada (desligada até a API IXC).
test('Produtos: sem formulário livre, busca IXC preparada e Máx. global editável', () => {
  const cadastros = lerComponente('CoordinatorCadastrosView.tsx');
  const proibidos = ['Cadastrar novo produto', 'Editar produto', "'Adicionar produto'", 'Produto cadastrado.', 'Produto atualizado.', 'id="prod-est"'];
  const encontrados = proibidos.filter((texto) => cadastros.includes(texto));
  assert.deepEqual(
    encontrados,
    [],
    'Formulário de cadastro/edição de produto ainda presente: ' + encontrados.join(', '),
  );
  assert.ok(cadastros.includes('Produtos vindos do IXC'), 'Painel "Produtos vindos do IXC" ausente.');
  assert.ok(cadastros.includes('Buscar por ID') , 'Opção de busca por ID ausente.');
  assert.ok(cadastros.includes('Buscar por nome'), 'Opção de busca por nome ausente.');
  assert.ok(cadastros.includes('Disponível quando a integração IXC for ativada'), 'Aviso da integração IXC ausente.');
  assert.ok(cadastros.includes('Máx. global'), 'Edição de Máx. global deve continuar existindo.');
  assert.ok(cadastros.includes('handleSalvarMaximo'), 'Ação de salvar Máx. global ausente.');
});

// Issue 16: na régua do Coordenador, falta de estoque aparece como aviso vermelho;
// a palavra "Snapshots" não aparece em nenhum texto visível.
test('Régua do Coordenador: aviso de estoque insuficiente; sem a palavra snapshots', () => {
  const separar = lerComponente('CoordinatorSepararView.tsx');
  assert.ok(separar.includes('Estoque insuficiente'), 'Aviso "Estoque insuficiente" ausente na régua.');
  const historicoCoord = lerComponente('CoordinatorHistoricoView.tsx');
  const historicoEstoque = lerComponente('EstoqueHistoricoView.tsx');
  for (const [nome, texto] of [['CoordinatorHistoricoView', historicoCoord], ['EstoqueHistoricoView', historicoEstoque]] as const) {
    assert.ok(!/snapshot/i.test(texto), `A palavra "snapshot" apareceu em texto visível em ${nome}.`);
  }
});
