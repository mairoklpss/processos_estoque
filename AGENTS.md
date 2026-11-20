# Instruções para agentes — Brasilink

## Segurança operacional

Trabalhe sobre as alterações existentes sem desfazê-las. A instalação de skills não autoriza commit, push, troca de senhas, migração, restauração ou remoção de dados. Peça autorização antes de excluir conteúdo. A operação já usa PostgreSQL; preserve o SQLite histórico, a homologação antiga e seus volumes. Para comandos e estado do aplicativo, consulte `package.json` e a seção atual de `SETUP.md`, não os checkpoints históricos.

## Agent skills

Use as 27 skills principais de Matt Pocock instaladas em `.agents/skills/<nome>/SKILL.md`. Leia somente a skill aplicável e seus arquivos de apoio. Para escrita de instruções use `writing-for-agents`; para diagnóstico `diagnosing-bugs`; para implementação orientada a testes `tdd`; para revisar alterações `code-review`; para interfaces de módulos `codebase-design`.

Respeite `disable-model-invocation: true`: esses fluxos exigem solicitação específica da pessoa, não encadeamento automático. TDD exige combinar a interface a testar antes de escrever testes. A ponte para ferramentas, permissões, caminhos e invocação no G4 OS está em `docs/agents/g4os-skills.md`; leia-a antes de executar qualquer skill neste ambiente.

### Issue tracker

GitHub Issues de `mairoklpss/processos_estoque`, conforme `docs/agents/issue-tracker.md`. Conta e acesso às Issues validados; labels dos cinco estados reportadas como criadas pela pessoa em 20/11/2026. Ferramentas e limites registrados no documento. Não substitua por tarefas locais nem use outro repositório sem decisão da pessoa.

### Triage labels

Cinco estados padrão: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Mapeamento em `docs/agents/triage-labels.md`; criação remota pendente porque a conexão atual não oferece ferramenta de labels.

### Domain docs

Contexto único: `GLOSSARY.md` e `docs/adr/`, criados sob demanda. Regras de leitura em `docs/agents/domain.md`.

## Instalação e atualização

Origem e hashes em `.agents/matt-pocock.lock.json`. Guia e limites em `docs/agents/matt-pocock-skills.md`. Atualizações são manuais e versionadas: confira alterações e preserve personalizações antes de aplicar. Scripts auxiliares importados são referência, não hooks instalados ou processos em execução.
