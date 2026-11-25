# Processos de Estoque — Brasilink

Sistema local de gestão de estoque de materiais para técnicos de campo: o Coordenador calcula separações a partir do consumo fechado do mês e o Estoque confirma as entregas.

## Language

**Competência (semana)**:
A semana do cálculo que identifica a separação, de domingo a sábado, avaliada no horário de Brasília (ex.: separação feita na quarta 25/11/2026 → "22 a 28 de Novembro"; valor interno `AAAA-MM-DD` do domingo). Registros antigos podem exibir rótulo mensal. O consumo usado no cálculo continua sendo o do mês fechado anterior (mês de competência mensal, ex.: Outubro/2026 durante novembro).
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
Teto de unidades de um produto para um técnico, único campo de produto editável pelo Coordenador; demais dados de produto (incluindo estoque) virão do IXC e não são editáveis. É o alvo da reposição: a solicitação semanal preenche até ele (ex.: saldo 15, máximo 60 → solicita 45).
_Avoid_: limite, teto global

**Reposição até o máximo (regra vigente)**:
Quantidade solicitada = máximo(0, máximo global − saldo do técnico), para técnicos com consumo no mês anterior; quem não consumiu não solicita. Cada técnico solicita 1 vez por semana e o máximo cobre o uso da semana. Versão registrada nos snapshots: `REPOSICAO_ATE_MAXIMO_V2`.
_Avoid_: alvo kit, regra semanal provisória

**Mínimo (alerta)**:
Valor derivado do consumo semanal (uso do mês ÷ 3,1428, teto) ou override manual por técnico; serve como alerta de nível baixo e régua de leitura — não define mais a quantidade solicitada.
_Avoid_: alvo de reposição, mínimo obrigatório
