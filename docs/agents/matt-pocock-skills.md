# Skills Matt Pocock — instalação do projeto

Origem: https://github.com/mattpocock/skills
Commit fixado: abeeaf95660ba9e8b7c753eb38f441ca707a8823. Licença MIT preservada.

## Resultado

27 skills principais, originais em .agents/skills, cópias adaptadas no workspace G4 OS como matt-pocock-<nome>. As 12 experimentais/específicas foram excluídas conforme decisão da usuária. Os 27 arquivos de entrada passaram no validador nativo G4 OS, sem erros/avisos, e já aparecem no catálogo.

AGENTS.md aponta para configurações em docs/agents. Os originais e seus apoios foram verificados contra blobs do commit, com hashes em .agents/matt-pocock.lock.json. Nenhum script ou instalador upstream foi executado; nenhum hook, plugin global ou dependência npm foi instalado. Atualizações são manuais e devem preservar personalizações. Esta instalação por importação versionada não é gerenciada por npx skills update.

## Uso no G4 OS

Leia g4os-skills.md para mapeamento das ferramentas e permissões. Respostas seguem português brasileiro; nomes e conteúdos upstream permanecem preservados.

Exemplos:
- @matt-pocock-diagnosing-bugs para investigar uma falha.
- @matt-pocock-tdd para desenvolver com teste primeiro, após combinar a interface a testar.
- @matt-pocock-code-review para revisar um conjunto definido de alterações.
- @matt-pocock-grill-with-docs para esclarecer um plano e registrar decisões.
- @matt-pocock-to-spec para sintetizar a conversa em uma especificação no tracker escolhido.

Já foram usados setup-matt-pocock-skills e writing-for-agents nesta configuração. Não foi executada implementação, refatoração, TDD ou migração para demonstrar uso.

### 11 skills de uso contextual ou explícito

- matt-pocock-code-review
- matt-pocock-codebase-design
- matt-pocock-diagnosing-bugs
- matt-pocock-domain-modeling
- matt-pocock-pr
- matt-pocock-prototype
- matt-pocock-research
- matt-pocock-tdd
- matt-pocock-wizard
- matt-pocock-grilling
- matt-pocock-writing-for-agents

### 16 skills somente sob solicitação específica

- matt-pocock-ask-matt
- matt-pocock-grill-with-docs
- matt-pocock-implement-spec
- matt-pocock-implement
- matt-pocock-improve-codebase-architecture
- matt-pocock-retro
- matt-pocock-setup-matt-pocock-skills
- matt-pocock-to-spec
- matt-pocock-to-tickets
- matt-pocock-triage
- matt-pocock-wayfinder
- matt-pocock-grill-me
- matt-pocock-handoff
- matt-pocock-teach
- matt-pocock-to-questionnaire
- matt-pocock-wait-what

## GitHub Issues

Conta e leitura validadas em mairoklpss/processos_estoque (privado, Issues habilitadas). A conexão permite ler/criar Issues e comentar. A instalação não criou Issue artificial de teste nem publicou esta configuração via commit/push.

**Limite:** conexão sem ferramentas para labels, edição/fechamento/atribuição de Issues ou dependências nativas. Os cinco estados padrão estão documentados em triage-labels.md; sua existência/criação remota não foi verificada. Fluxos que exigirem operações ausentes devem registrar o bloqueio, não simular sucesso. Consulte Ferramentas e Automações > Conexões para ampliar capacidades, sem enviar credenciais pelo chat.

## Preservação

As skills do workspace que já existiam foram mantidas. Arquivos preexistentes da aplicação não foram alterados por esta instalação. Não houve restart, operação de banco, nova migração, commit, push ou remoção de conteúdo. Cópias de origem foram mantidas no scratch da sessão; relatórios desta tarefa em artifacts.
