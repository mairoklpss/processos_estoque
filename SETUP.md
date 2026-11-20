# Brasilink — Separação de Materiais (MVP Fase A)

> **Aviso de Escopo**: Esta é a **Fase A (Ambiente de demonstração / dados simulados)**. Não há conexão com o IXC Soft nem execução de consultas ou escritas no ERP nesta etapa.
>
> **Estado atual — 20/11/2026:** migração local definitiva para PostgreSQL concluída. A aplicação padrão usa `brasilink_operacao` em `127.0.0.1:55433`; SQLite e PostgreSQL de homologação foram preservados. As seções históricas abaixo não substituem a seção 7, que descreve a operação atual.

---

## 1. Setup e Execução

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Na máquina já configurada, inicie Docker Desktop, confira o banco operacional, gere o build e inicie Express + frontend estático + PostgreSQL:
   ```bash
   npm run pg:operacao:up
   npm run build
   npm start
   ```
   A aplicação responde somente em `http://127.0.0.1:3000`. O processo `npm start` deve permanecer ativo. `npm run dev` usa o mesmo PostgreSQL, mas com frontend de desenvolvimento. Em outra máquina/conta Windows, não basta copiar chaves DPAPI: planeje importação/recuperação e novas credenciais antes de iniciar.
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
| `COORDENADOR` | `coordenador` | Definir localmente antes de publicar | Cadastros (técnicos, produtos, parâmetros, usuários), cálculo/ajuste/envio de separações e histórico com snapshots |
| `ESTOQUE` | `estoque` | Definir localmente antes de publicar | Fila de separações enviadas (`CALCULADA`), conferência/entrega física com baixa atômica e consulta de pendências |

*Nota: Não há perfil nem botão de solicitação para o técnico nesta versão.*

---

## 3. Fluxo Operacional Implementado

1. **Cálculo em Rascunho (`RASCUNHO`)**: O Coordenador seleciona um técnico ativo e clica em **Calcular separação**. O backend gera uma proposta persistida em rascunho. Nenhum item é baixado do estoque e o rascunho permanece invisível para o perfil `ESTOQUE`.
2. **Revisão e Ajuste Manual**: Somente enquanto em `RASCUNHO`, o Coordenador pode alterar quantidades solicitadas informando uma justificativa obrigatória (valor original e valor ajustado ficam registrados).
3. **Envio ao Almoxarifado (`CALCULADA`)**: Ao clicar explicitamente em **Enviar solicitação ao estoque**, o status muda para `CALCULADA` (sem baixar estoque) e a solicitação passa a aparecer na fila do Estoque.
4. **Conferência e Baixa Atômica (`SEPARADA`)**: O Estoque vê apenas técnico, produtos e quantidades a separar (sem médias, limites, consumo ou saldo interno do técnico). Ao confirmar todos os itens, uma transação do adaptador SQLite/PostgreSQL valida a versão do estoque e do saldo técnico, revalida a demanda ainda não suprida, impede dupla confirmação e estoque negativo, dá baixa no almoxarifado e soma a quantidade entregue ao saldo do técnico.
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
- **Apenas Fase A (simulado)**: Fonte de consumo mensal e saldo inicial dos técnicos (dados locais agora no PostgreSQL operacional; SQLite histórico preservado).
- **Reservado para Fase B**: Integração somente leitura com o IXC Soft mediante consultas reais da TI, regras de lote/embalagem fechada (rolos de 2.000 m / caixas de 305 m) após validação dos parâmetros da planilha, e fluxo específico de encerramento/baixa de pendências antigas.


## Segurança — revisão de 19/11/2026

- Desenvolvimento escuta em `127.0.0.1` por padrão; `HOST` permite configuração explícita.
- Autenticação exclusivamente por cookie HttpOnly e SameSite=Lax; tokens Bearer não são mais aceitos. API de escrita exige `X-Requested-With: Brasilink` e rejeita origens externas. Não suporta incorporação cross-site/iframe.
- Login limitado por processo: 5 tentativas por usuário e 20 por IP em 15 minutos. Multi-instância exige limitador compartilhado (Redis/gateway).
- Senhas novas/reset devem conter 12 a 128 caracteres. Trocar as credenciais demo no cadastro de usuários antes de publicar. Reset e troca de perfil revogam sessões.
- Produção exige `NODE_ENV=production`, `PUBLIC_ORIGIN=https://seu-dominio` e HTTPS real. `TRUST_PROXY_HOPS` é zero por padrão; use `1` somente com um proxy confiável e sem acesso direto externo ao Express.
- Inicialização em produção não semeia dados demo e bloqueia banco vazio ou credenciais conhecidas de demonstração. Inicializar e trocar senhas previamente em ambiente local controlado.
- Adaptadores assíncronos SQLite/PostgreSQL implementados. Após o corte registrado, seleção SQLite é bloqueada sem `ALLOW_SQLITE_ROLLBACK=true` e `SQLITE_PATH` existente, ambos explícitos. Esse retorno só pode ser usado após aprovação e reconciliação dos movimentos posteriores ao corte.
- O frontend de produção deve ser servido pelo Express com `npm start` após `npm run build`; `vite preview` não inicia a API.
- `.gitignore` não retira do Git arquivos que já foram rastreados. Revisar o WAL rastreado com autorização antes de remover do índice/histórico.


## Histórico — pendências locais e homologação PostgreSQL (19/11/2026)

Os itens desta seção registram o estado daquela data. A operação atual está na seção 7.

- Serviços separados em server/services; fachada pública preservada. Backend agora usa adaptadores assíncronos SQLite/PostgreSQL via DATABASE_CLIENT, com SQLite como padrão.
- API com validação Zod por endpoint e paginação limit/offset (100 por padrão, máximo 500). As telas atuais não incluem navegação de páginas; clientes/API podem solicitar outras páginas.
- Auditoria persistente de escritas/autenticação/bloqueios, sem senhas/tokens/IP bruto. Coordenador pode consultar GET /api/coord/auditoria; perfil Estoque não tem acesso.
- Purga de sessões expiradas no início e a cada hora, transacional e auditada. Não elimina sessões válidas, históricos ou backups.
- Login/reset são transacionais; alterações concorrentes não deixam sessão criada com senha antiga após reset. O último coordenador ativo não pode ser desativado/rebaixado.
- Backup cifrado: npm run backup:create. Windows DPAPI e ACL protegem a chave em .local/backups; planejar recuperação dessa chave antes de backups externos/produção.
- WAL retirado do índice do Git, preservando o arquivo local. Histórico Git não foi reescrito.
- Credenciais demo removidas desta documentação. Credenciais atuais não foram trocadas automaticamente; redefini-las pelo cadastro antes de produção.
- PostgreSQL/Docker preparado em infra/docker-compose.homologacao.yml, porta 55432 somente loopback. Não utiliza nem altera o PostgreSQL nativo existente.
- Após instalar/iniciar Docker Desktop: npm run pg:up, pg:migrate, pg:verify, pg:test e pg:dev, nessa ordem. Migração só aceita banco vazio; não repetir sobre destino preenchido.
- Fonte padrão: .local/backups/homologacao-source.sqlite, uma cópia restaurada do backup consistente. Fonte operacional é recusada, inclusive caminhos equivalentes detectáveis. Sessões não são copiadas.
- Pg homologa em processo separado na porta 3100, com APP_INSTANCE=homologacao e cookie próprio. Não muda a operação SQLite. O verificador compara a cópia congelada; usar antes de tráfego que altere dados/sessões.
- Migração e testes reais estão pendentes de Docker; mocks e compilação não substituem homologação PostgreSQL.
- Backend PostgreSQL do MVP serializa mutações com advisory lock comum e locks de linha em estoque/separações. É conservador para evitar dupla entrega; avaliar granularidade/performance na Fase B.
- Reiniciar a instância SQLite quando for apropriado para ativar o novo backend e a manutenção; o servidor operacional existente não foi encerrado nesta execução.

- Limite geral da API: 120 requests/IP/minuto, além do limite de login. Rejeições por excesso não geram uma linha de auditoria por request.


## Histórico — homologação antes do corte (20/11/2026)

Este checkpoint antecede o corte definitivo descrito na seção 7.

Docker instalado/ativo. A cópia consistente em .local/backups/homologacao-source.sqlite foi importada em brasilink_homologacao (PostgreSQL 18.7), no contêiner brasilink-homologacao-postgres-1, porta 127.0.0.1:55432 e volume próprio. As 10 tabelas passaram por contagem e SHA-256 de todas as linhas/colunas. Sessões não copiadas.

pg:test: 9 aprovados, zero falhas/ignorados; suíte completa com URL PostgreSQL temporária: 46 aprovados, 1 opt-in de banco vazio ignorado, zero falhas. Lint/build passaram. O contêiner foi reiniciado e os dados reconciliados novamente. Role brasilink_app autenticada e conferida sem privilégios administrativos, sem CREATE no schema, sem UPDATE/DELETE da auditoria; DML e rollback do adaptador testados com essa role.

Aplicação de homologação iniciada em http://127.0.0.1:3100 com APP_INSTANCE=homologacao, cookie próprio e role brasilink_app. Tela pública de login renderizada no navegador. Não foi iniciada/reiniciada a operação SQLite. O PostgreSQL nativo permaneceu Running e não foi usado.

NÃO repetir pg:migrate no destino preenchido. Depois de navegar/logar, auditoria e sessões podem divergir do snapshot: pg:verify completo é para a comparação imediatamente após importar, antes de tráfego. A cópia é de 19/11 e não sincroniza movimentos posteriores do SQLite.

Validação visual pela usuária e aprovação de corte ainda necessárias. Nenhuma troca definitiva foi feita. Não apagar volumes/bancos nem usar down -v sem autorização e plano de preservação.


## 7. Operação PostgreSQL local — corte definitivo de 20/11/2026

- Fonte: SQLite com os dois usuários já sem credenciais demo; todos os registros são simulados, conforme confirmação da usuária.
- Destino: `brasilink_operacao`, contêiner `brasilink-operacao-postgres-1`, volume `brasilink-operacao_postgres_operacao`, porta **127.0.0.1:55433**.
- Aplicação: **http://127.0.0.1:3000**, frontend estático de build, sem Vite/HMR no modo padrão. Continua sendo uso HTTP exclusivamente local, não publicação de produção na rede.
- `npm start` e `npm run dev` agora passam pelo inicializador `scripts/local-operacao.ps1`; ele exige PostgreSQL e não faz fallback SQLite. Credenciais do banco ficam em DPAPI/ACL, não no `.env` nem no Git. O processo de aplicação recebe apenas a URL da role de aplicação, sem as variáveis administrativas de migração.
- Fonte SQLite e seus backups foram preservados. O PostgreSQL antigo em 55432 permaneceu como teste e não foi sobrescrito. O serviço PostgreSQL nativo não foi alterado.
- Dez tabelas reconciliadas por contagem/SHA-256 antes do tráfego; 81 registros nas nove tabelas de negócio. Sequences preservadas, incluindo IDs já removidos. Sessões não foram copiadas; os dois perfis fizeram login novamente após o corte.
- Verificação corrente: `npm run pg:operacao:check`. Compara somente dados de negócio com o snapshot de corte e informa diferenças; novos lançamentos legítimos farão essa comparação divergir. Auditoria e sessões são excluídas porque mudam com uso normal.
- Verificação integral `pg:operacao:verify -Source ...` é para antes do tráfego. Após login/auditoria/sessões, diferença integral é esperada. Não repetir migração/teste opt-in de destino vazio no banco preenchido.
- Backup operacional PostgreSQL cifrado: `npm run backup:create`. Arquivos novos em `.local/operacao/backups`. A chave é a DPAPI existente em `.local/backups/key.dpapi.xml`; planejar recuperação externa dessa chave/conta.
- Para descriptografar um backup em **arquivo novo**, sem restaurar sobre uma base: `npm run backup:decode -- -InputPath CAMINHO_DO_BACKUP`. Isso produz um arquivo pg_dump custom, não altera o banco. Restaurar exige destino vazio separado e aprovação; o ensaio dessa restauração foi executado e as cópias de teste foram preservadas.
- `npm run backup:sqlite` fica apenas para cópia do SQLite histórico, não dos novos dados operacionais.
- Backups externos/recuperação em outra máquina e agendamento automático ainda não foram configurados. Não confiar apenas no mesmo disco ou em copiar um XML DPAPI para outro usuário/PC.
- Após novos lançamentos no PostgreSQL, não voltar simplesmente ao SQLite antigo: suspender escritas e preservar/reconciliar os movimentos, com plano aprovado. Não apagar volumes nem executar `down -v`.

Documentação/evidências do corte estão no relatório MIGRACAO-DEFINITIVA-POSTGRES-2026-11-20.md desta execução. A regra provisória 3,1428 permanece sem alteração.
