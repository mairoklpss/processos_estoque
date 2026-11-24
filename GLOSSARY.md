# Processos de Estoque — Brasilink

Sistema local de gestão de estoque de materiais para técnicos de campo: o Coordenador calcula separações a partir do consumo fechado do mês e o Estoque confirma as entregas.

## Language

**Competência**:
O mês fechado de consumo usado como base do cálculo de separação, avaliado no horário de Brasília (a competência de outubro contém o consumo de 01/10 a 31/10).
_Avoid_: período, mês de referência, ciclo

**Brasília (fuso exibido)**:
Fuso horário da operação para todo texto visível na interface. Nas telas, escrever "Brasília"; nunca exibir o identificador técnico `America/Sao_Paulo` — ele só existe em código (API, cálculo de período e testes), pois é o identificador IANA do horário de Brasília.
_Avoid_: America/Sao_Paulo (em texto de tela), horário de São Paulo

**Filial**:
Unidade/cidade à qual um técnico está vinculado (ex.: Tianguá). Valor futuro do IXC (`id_filial` → cidade); enquanto a integração não existe, é digitado manualmente.
_Avoid_: região

**ID IXC**:
Identificador do técnico no IXC, exibido no lugar da matrícula; a busca/adição de técnicos por ID ou nome acontece somente via integração IXC (hoje desligada e sinalizada na interface).
_Avoid_: matrícula

**Máximo global**:
Teto de unidades de um produto para um técnico, único campo de produto editável pelo Coordenador; demais dados de produto (incluindo estoque) virão do IXC e não são editáveis.
_Avoid_: limite, teto global
