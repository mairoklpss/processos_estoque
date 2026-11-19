# Brasilink — Separação de Materiais (MVP Fase A)

> **Aviso de Escopo**: Esta é a **Fase A (Ambiente de demonstração / dados simulados)**. Não há conexão com o IXC Soft nem execução de consultas ou escritas no ERP nesta etapa.

---

## 1. Setup e Execução

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Inicie o servidor full-stack (Express + Vite + SQLite persistente em `data/brasilink_separacao.sqlite`):
   ```bash
   npm run dev
   ```
   A aplicação responde na porta `3000`.
3. Execute a suíte de testes automatizados (regras de cálculo, fuso `America/Sao_Paulo` e fluxo completo da API):
   ```bash
   npm test
   ```
4. Verifique tipagem e build de produção:
   ```bash
   npm run lint && npm run build
   ```

---

## 2. Perfis de Acesso e Credenciais de Demonstração

Não existe auto-cadastro público. O acesso é feito por usuário e senha com hash `scrypt` e sessões `HttpOnly` no servidor. Apenas o **Coordenador** cria, edita, ativa/desativa e redefine senhas de usuários.

| Perfil | Usuário | Senha Inicial | Escopo |
| :--- | :--- | :--- | :--- |
| `COORDENADOR` | `coordenador` | `Coord@2026` | Cadastros (técnicos, produtos, parâmetros, usuários), cálculo/ajuste/envio de separações e histórico com snapshots |
| `ESTOQUE` | `estoque` | `Estoque@2026` | Fila de separações enviadas (`CALCULADA`), conferência/entrega física com baixa atômica e consulta de pendências |

*Nota: Não há perfil nem botão de solicitação para o técnico nesta versão.*

---

## 3. Fluxo Operacional Implementado

1. **Cálculo em Rascunho (`RASCUNHO`)**: O Coordenador seleciona um técnico ativo e clica em **Calcular separação**. O backend gera uma proposta persistida em rascunho. Nenhum item é baixado do estoque e o rascunho permanece invisível para o perfil `ESTOQUE`.
2. **Revisão e Ajuste Manual**: Somente enquanto em `RASCUNHO`, o Coordenador pode alterar quantidades solicitadas informando uma justificativa obrigatória (valor original e valor ajustado ficam registrados).
3. **Envio ao Almoxarifado (`CALCULADA`)**: Ao clicar explicitamente em **Enviar solicitação ao estoque**, o status muda para `CALCULADA` (sem baixar estoque) e a solicitação passa a aparecer na fila do Estoque.
4. **Conferência e Baixa Atômica (`SEPARADA`)**: O Estoque vê apenas técnico, produtos e quantidades a separar (sem médias, limites, consumo ou saldo interno do técnico). Ao confirmar todos os itens, uma transação SQLite `BEGIN IMMEDIATE` valida a versão do estoque, impede dupla confirmação, impede estoque negativo, dá baixa no almoxarifado e soma a quantidade entregue ao saldo do técnico.
5. **Pendências**: Faltas de estoque ou entregas parciais registram a diferença em **Pendências**, mantendo o saldo pendente visível até ação futura registrada.

---

## 4. Fórmulas e Regras de Negócio (Regra Semanal Provisória v1)

Para cada técnico ativo × produto ativo, considerando o consumo total do **mês anterior fechado** no fuso **`America/Sao_Paulo`**:

- `demandaSemanalExata = usoMesAnterior / 3,1428`
- `alvoBase = teto(demandaSemanalExata)` (`0` se `usoMesAnterior === 0`)
- `minimoEfetivo = minimoManual` (se configurado para técnico × produto) ou `alvoBase` (derivado)
- `alvoKit = min(limiteMaximoGlobal, max(alvoBase, minimoEfetivo))`
- `quantidadeSolicitada = 0` se `usoMesAnterior === 0` (aviso *Sem consumo no período*); caso contrário `max(alvoKit - saldoTecnico, 0)`
- `quantidadeDisponivel = min(quantidadeSolicitada, estoqueAtualAlmoxarifado)`
- `faltante = quantidadeSolicitada - quantidadeDisponivel`
- **Demanda diária informativa**: `usoMesAnterior / 22` — exibida apenas ao Coordenador como referência e nunca utilizada no cálculo do kit ou da separação.
- **Alertas informativos (não alteram o cálculo)**:
  - Comparação do consumo do mês anterior com `[minimoEfetivo, limiteMaximoGlobal]`: *Uso abaixo do mínimo*, *Uso dentro dos limites* ou *Uso acima do máximo*.
  - *Consumo atípico*: exibido quando o consumo do mês anterior ultrapassa o máximo global do produto.
  - *Sem consumo no período*, *Sem saldo no almoxarifado* e *Mínimo manual supera máximo do produto*.

---

## 5. Dados Simulados da Fase A e Reconciliação Futura com IXC (Fase B)

- **Dados simulados**: 3 técnicos ativos (`TEC-01` a `TEC-03`), 6 produtos de operação FTTH (`MAT-001` a `MAT-006`) com estoques variados (incluindo falta parcial e estoque zerado), consumos simulados do mês fechado e saldos iniciais dos técnicos. A estrutura suporta expansão para 11+ técnicos sem mudança de arquitetura.
- **Reconciliação futura com IXC Soft (Fase B — somente leitura)**:
  - Na Fase A, o saldo do técnico (`saldos_tecnicos`) é incrementado atomicamente a cada confirmação de entrega do estoque para que cálculos subsequentes não ignorem entregas já realizadas.
  - Na Fase B, o conector somente leitura consultará as views/endpoints oficiais fornecidos pela TI no IXC Soft para obter consumo fechado e saldo atual em poder do técnico, conciliando eventuais separações locais recém-confirmadas (`SEPARADA` ainda não refletidas no ERP) antes de propor novas quantidades.

---

## 6. Escopo Entregue vs. Fase B

- **Implementado de forma funcional**: Autenticação segura (`scrypt` + sessão `HttpOnly`), RBAC estrito na API, DTO isolado para o Estoque, CRUD completo de técnicos/produtos/parâmetros/usuários, motor de cálculo em `America/Sao_Paulo`, fluxo `RASCUNHO -> CALCULADA -> SEPARADA` com snapshot imutável, ajustes justificados, baixa atômica com proteção contra concorrência, atualização de saldo do técnico, pendências persistidas, CSV, impressão simples e suíte de testes automatizados.
- **Apenas Fase A (simulado)**: Fonte de consumo mensal e saldo inicial dos técnicos (dados locais em SQLite).
- **Reservado para Fase B**: Integração somente leitura com o IXC Soft mediante consultas reais da TI, regras de lote/embalagem fechada (rolos de 2.000 m / caixas de 305 m) após validação dos parâmetros da planilha, e fluxo específico de encerramento/baixa de pendências antigas.
