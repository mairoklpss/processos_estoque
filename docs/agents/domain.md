# Domain docs

Este projeto tem contexto único, não uma estrutura monorepo multi-contexto.

Antes de explorar uma área do código, leia `GLOSSARY.md`, se existir, e os ADRs relevantes em `docs/adr/`. Se não existirem, prossiga sem pedir sua criação por princípio. As skills de modelagem podem criá-los quando termos ou decisões forem efetivamente resolvidos com a pessoa.

## Estrutura

- `GLOSSARY.md`: vocabulário do domínio na raiz do projeto.
- `docs/adr/NNNN-<decisao>.md`: decisões arquiteturais relevantes, com contexto e consequências.
- Documentação e artefatos que devem integrar o código ficam no projeto; entregáveis independentes produzidos no G4 OS ficam em artifacts, conforme a ponte `g4os-skills.md`.

Use termos do glossário em hipóteses, testes, issues e propostas. Evite sinônimos que a pessoa rejeitou. Ao contradizer um ADR, explicite qual decisão está sendo reaberta e por quê; não a substitua silenciosamente.

Não invente regras de negócio durante modelagem. Neste sistema, a regra provisória 3,1428 permanece inalterada até validação explícita; instalação de skills não valida nem modifica esse parâmetro.
