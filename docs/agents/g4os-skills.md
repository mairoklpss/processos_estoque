# Ponte das skills para G4 OS

## Escopo e precedência

As cópias `matt-pocock-*` deste workspace são destinadas ao projeto **C:/Users/brasilink/Documents/PROJETOS/processos_estoque**. Em outro projeto, peça autorização para configurar o escopo; não transfira suas convenções automaticamente.

Os originais em `.agents/skills` estão preservados. As cópias no workspace mantêm o corpo original e acrescentam metadados/preâmbulo de integração. Instruções do sistema, do G4 OS, da pessoa e as permissões vigentes prevalecem sobre exemplos do fornecedor. Importação não concede permissões adicionais.

## Invocação

- No G4 OS, use o slug `matt-pocock-<nome>`; exemplo: `@matt-pocock-tdd`. Se a lista ainda não atualizar nesta conversa, abra o SKILL.md correspondente pelo caminho do workspace; uma nova conversa pode recarregar o catálogo.
- Referências a `/tdd`, `/grilling` e outras skills significam ler a cópia do workspace `skills/matt-pocock-<nome>/SKILL.md` e seus apoios, não inventar uma ferramenta `Skill`.
- `disable-model-invocation: true` exige solicitação específica da pessoa. Routers podem recomendar esses fluxos, não iniciá-los por conta própria. Esse limite é obrigatório mesmo se o frontend não interpretar a flag.
- As skills de referência sem essa flag podem ser usadas automaticamente quando houver correspondência real com a tarefa; confirme decisões próprias da pessoa com `request_user_input`.

## Ferramentas e limites

- `Skill`: leitura seletiva de arquivos; não há ferramenta fictícia a chamar.
- `Task` / agentes paralelos: descobrir `subagent_run` em `session_tool_catalog`; passar um escopo delimitado, auditar o retorno e usar a continuação do mesmo agente quando necessário. Delegar não contorna permissões.
- `AskUserQuestion`: `request_user_input`, com opções concretas; encerrar o turno depois da chamada.
- Pesquisa pública: `web_search`/`web_fetch`, citando fontes. Aplicações e APIs autenticadas: somente ferramentas de fontes conectadas. GitHub segue `issue-tracker.md`; ausência de fonte bloqueia essa etapa, não permite fallback CLI/navegador.
- Comparações/diffs e comandos locais: ferramentas de arquivo e shell disponíveis. Shell é Git Bash no Windows; executar PowerShell com script protegido de expansão Bash.
- Scripts `.sh`, `openai.yaml` e modelos importados são referências auxiliares. A instalação não os executa, não ativa hooks, não instala CLIs, dependências ou extensões de outros agentes.

## Gravações e entregáveis

Respeite o modo Perguntar/Executar/Explorar e as aprovações exibidas pelo G4 OS. Excluir conteúdo exige consulta prévia. Commit, push, publicação, criação de issues/labels, reinício de serviços, mudanças em credenciais e operações de banco não decorrem da instalação de uma skill.

No G4 OS, relatórios, pesquisas, handoffs, questionários, HTML e outros arquivos entregues à pessoa devem ficar na pasta artifacts **da sessão que estiver executando a tarefa**, não no TEMP ou em caminhos Unix dos exemplos. Arquivos integrantes do projeto (código, AGENTS.md e configurações de skills) são alterados no projeto pedido. Não publicar sites sem acertar os detalhes exigidos pelo G4 OS.

Metas operacionais: preserve dados e personalizações. Uma skill não autoriza limpeza dos bancos, repetição de migração no destino preenchido, alteração de 3,1428, troca de senha ou reescrita do histórico Git. Consulte o estado atual do sistema antes de executar algo operacional.

## Loops, revisão e conclusão

- Em TDD, combine primeiro a interface pública a testar; então uma fatia red → green por vez. Não apresente checagem de instalação como teste de negócio ou TDD já executado.
- Em code-review, escolha um ponto de comparação e identifique alterações preexistentes. Para trabalho não commitado, inclua `git diff`, `git diff --cached` e arquivos não rastreados pertinentes; `git diff <base>...HEAD` sozinho não cobre essas mudanças. A instalação não autoriza refatorar todos os achados nem comprometer mudanças de outra etapa.
- Intervenções humanas de credentials/dashboard usam browser handoff ou interface da conexão. G4 OS não digita senhas, tokens ou códigos, e não copia credenciais para logs.
- Atualize as etapas em tarefas com várias fases. Só diga concluído após verificar os arquivos/resultados. Se uma ferramenta, conexão ou recurso requerido estiver ausente, registre o bloqueio e mantenha a etapa dependente pendente.

## Adaptações específicas

- `wizard`: use handoff/interface de conexão para etapas que só a pessoa pode cumprir. O template upstream é referência e pode gravar plaintext em .env ou através de symlinks; ele não deve ser executado para coletar credenciais no G4 OS. Entrada oculta ou chmod 0600 não substitui a política de credenciais e ACL Windows.
- `implement-spec` e protótipos: criação/merge/reset de branches, worktrees e commits dependem de escopo próprio. Preserve a árvore de trabalho existente; não fazer reset ou limpeza automática.
- Relatórios HTML: escape conteúdos do código, prefira assets locais e Mermaid com configuração restrita/sandbox; não reproduza securityLevel loose sem revisão. Para apenas visualizar um diagrama no chat, use Mermaid nativo.
- `teach`: quando solicitado, defina uma pasta própria do curso em artifacts da sessão. Mantenha missão, recursos, aulas, assets e learning records relativos a essa base, separados da raiz e do glossário operacional do estoque. Verifique links e dependências; não confunda HTML empacotado com arquivo autossuficiente.
- `wait-what`: explique em português brasileiro simples, salvo solicitação de outro idioma; não alegue conformidade com padrão de inglês técnico em um texto português.
- `/clear`, `/compact` e janela aproximada mencionada por `ask-matt` não são ferramentas/limites garantidos do G4 OS. Use `session_recall` para recuperar trechos anteriores e faça handoff somente quando solicitado.
- `triage`: comentários devem deixar explícita a participação da IA. Um comentário ou estado escrito no corpo não significa que uma label, fechamento ou claim nativo foi aplicado.
- `diagnosing-bugs`: o script hitl-loop.template.sh é interativo e não serve a execução não assistida; login em localhost fica exclusivamente com a pessoa. Limpeza de protótipos descartáveis e qualquer uso de banco seguem pergunta prévia e ambiente isolado.
- `codebase-design`/DEEPENING: substituir testes antigos exige decisão explícita da pessoa; conselho arquitetural não é autorização de remoção de testes ou arquivos.
- `wayfinder`: sem ferramenta de atribuição/atualização/fechamento, reporte essas etapas bloqueadas. Relações textuais não garantem exclusividade entre sessões nem equivalem a dependências nativas.
