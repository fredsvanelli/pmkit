---
id: PMK-338
title: "Adicionar o comando /pmkit:spec:from-prd, do PRD de uma página ao backlog ligado"
type: feature
status: done
priority: medium
estimate: 8
parent: EPC-6
branch: pmk-338-spec-from-prd
created: 2026-11-17T20:29:33.736Z
updated: 2026-11-17T22:32:32Z
---

## Description

### Context

Um PM com um PRD de uma página não tem um comando do pmkit que transforme esse PRD em backlog. Hoje o caminho é uma entrevista com skills externas (`grilling` ou `brainstorming`), depois `/pmkit:spec:record-decision` uma vez por decisão, depois `/pmkit:spec:import` e por fim `issues:update`, `issues:breakdown` e `issues:link` para fechar as lacunas. O `spec:import` não inventa critérios de aceite, então um PRD vago vira uma árvore de issues marcadas "needs criteria". O usuário precisa conhecer a sequência, e etapas ficam pela metade.

O design aprovado está em `docs/specs/2026-11-17-pmk-338-spec-from-prd-design.md`.

### Scope (in)

- Um comando novo, `/pmkit:spec:from-prd`, que recebe um PRD (arquivo ou texto colado) e um épico opcional
- Uma entrevista de produto própria do pmkit, uma pergunta por vez, sobre escopo, casos de uso e critérios de aceite, sem perguntas técnicas
- O PRD refinado guardado nos docs do tracker, ou no repositório quando o tracker não cria documentos
- Uma ADR por decisão de produto difícil de reverter, com aprovação de cada uma; uma ADR recusada vira decisão "só PRD" e o fluxo continua
- Épico, milestones e issues com descrição completa, critérios e estimativa, com uma aprovação por etapa
- Ligações de bloqueio entre as issues e uma checagem final de que cada requisito virou issue
- Subagents para leitura, rascunho e checagem, com o mesmo fluxo em sequência quando não há subagents
- Retomada a partir de um PRD refinado já guardado

### Out of scope

- Desenho técnico das issues
- Planejamento de sprint e atribuição
- Mudanças no CLI
- Dependência de skills fora do pmkit

### Tasks

- [ ] Escrever o comando com a entrevista, as aprovações por etapa e a retomada
- [ ] Listar o comando na tabela do skill de roteamento, no README e no CHANGELOG
- [ ] Escrever o runbook do fluxo e o teste E2E dele
- [ ] Fixar as regras do comando em testes estáticos do texto

## Acceptance criteria

- [x] /pmkit:spec:from-prd aparece no README e na tabela de comandos do skill pmkit
- [x] Com um PRD de uma página, a entrevista faz uma pergunta por mensagem e nenhuma pergunta sobre tecnologia, arquitetura ou banco de dados
- [x] A entrevista não pergunta o que o PRD ou o código já respondem
- [x] O PM aprova separadamente o PRD refinado, cada ADR, o épico com os milestones e a árvore de issues antes de cada gravação
- [x] Recusar uma ADR transforma a decisão em "só PRD" e o fluxo segue para a próxima etapa
- [x] Cada issue criada tem descrição completa, critérios de aceite vindos do PRD refinado e uma estimativa da escala do tracker
- [x] As issues criadas têm as ligações de bloqueio aprovadas pelo PM, e /pmkit:issues:dependencies mostra o caminho crítico do épico
- [x] A checagem final lista todo requisito do PRD refinado que ficou sem issue
- [x] Quando o PM recusa uma etapa, o comando lista o que já gravou e diz qual comando retoma o fluxo
- [x] O fluxo funciona do começo ao fim sem subagents
- [x] npm test passa, incluindo o E2E do runbook do fluxo
