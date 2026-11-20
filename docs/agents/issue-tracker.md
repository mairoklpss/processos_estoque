# Issue tracker: GitHub

## Destino e estado

Specs e tarefas deste projeto devem ser GitHub Issues em **mairoklpss/processos_estoque**: https://github.com/mairoklpss/processos_estoque.

Destino obtido de `git remote -v` e confirmado pela conexão GitHub do G4 OS em 20/11/2026: conta **mairoklpss**, repositório privado, Issues habilitadas, permissões administrativas/de triagem retornadas pela API e listagem de Issues concluída. Nenhuma Issue de teste foi criada para forçar uma gravação.

A conexão está ativa nesta conversa. Limite atual: não oferece ferramentas para administrar labels, editar/fechar Issues, atribuir responsável ou dependências nativas. O setup remoto de labels permanece parcial por falta dessas ferramentas, não por falta de conta. Revise ferramentas em Ferramentas e Automações > Conexões; credenciais sempre na interface, nunca no chat.

## Operações no G4 OS

Use exclusivamente as ferramentas da conexão GitHub, descobertas em `source_tool_catalog` e invocadas com `source_tool_call`. Se ausentes, interrompa apenas a etapa que depende do tracker e indique a conexão necessária; não use `gh`, curl autenticado, navegador ou credenciais de arquivo como substitutos.

Em cada nova sessão de gravação, valide o repositório e as permissões antes da primeira ação. Sempre informe owner/repo de forma explícita. Nunca publique tarefas em `mattpocock/skills`: ele é fornecedor das skills, não o tracker deste projeto.

- Criar: uma issue por spec ou ticket, com título e corpo aprovados conforme o modo de permissão.
- Ler/listar: obter corpo, estado, labels e comentários necessários; usar paginação da ferramenta.
- Comentar: acrescentar evidência, decisão ou resultado sem sobrescrever histórico.
- Fechar: registrar a explicação e então fechar, respeitando a autorização da tarefa.
- Labels: aplicar/remover os estados de `triage-labels.md`. Criar os ausentes apenas após validar a conexão e a operação autorizada; preservar labels existentes.
- Dependências: usar sub-issues/dependências nativas quando a ferramenta permitir. Caso contrário, registrar `Part of #N` e `Blocked by: #N` no corpo, sem alegar links nativos. Um ticket só está livre quando seus bloqueadores estão encerrados.

Quando uma skill disser "publish to the issue tracker", isso significa criar uma GitHub Issue. Se o GitHub estiver indisponível, um rascunho pode ser entregue em artifacts, claramente não publicado; isso não muda o tracker escolhido.

## Capacidades verificadas nesta instalação

- Disponíveis: `get_me`, `list_repositories`, `list_issues`, `get_issue`, `create_issue`, `add_issue_comment`, leitura de arquivos e leitura/busca de PRs.
- Ausentes: listar/criar/aplicar/remover labels, editar/fechar Issues, atribuir responsáveis, atualizar mapas e criar sub-issues/dependências nativas.
- Publicação de spec/ticket e comentários poderá usar ferramentas existentes quando solicitada. Rascunhar um corpo de PR não publica PR.
- Nas operações ausentes, registrar o bloqueio; não usar a CLI ou o navegador para contornar a falta de ferramenta da conexão. Para relações de tickets, use texto explícito no corpo somente quando esse fallback for compatível com o fluxo, com números reais de Issues.

## Pull requests as a triage surface

**PRs as a request surface: no.** PRs externos não entram automaticamente na fila de pedidos. Elaborar um corpo de PR não autoriza commit, push ou publicação remota.

## Wayfinding

O mapa é uma issue pai e cada decisão uma issue filha. Labels de wayfinding são propostas quando esse fluxo for solicitado, não criadas nesta instalação. Registre responsáveis e bloqueadores; só marque uma decisão resolvida com resposta/evidência e referência no mapa. Claim/resolve são gravações no tracker, não ações implícitas de instalação.
