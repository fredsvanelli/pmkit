---
id: PMK-348
title: Adicionar epic update para editar o título e a descrição de um épico existente
type: feature
status: in_progress
priority: low
estimate: 8
assignee: fred
parent: EPC-6
branch: pmk-348-adicionar-epic-update-para-editar-o
created: 2026-11-18T01:40:58.684Z
updated: 2026-11-22T02:39:46Z
---

## Description

### Context

Os épicos criados antes da descrição no `epic create` (como o EPC-10) ficaram sem propósito escrito, e hoje o CLI não tem como editar um épico existente. O contrato do tracker só cria épicos, então a única saída seria editar `.issues/` à mão, o que a convenção proíbe.

### Scope (in)

- Comando `epic update <id>` que muda o título e a descrição, com dry-run
- Edição de épico nos trackers local, Linear e GitHub, com o mesmo antes e depois das outras escritas
- Registro da edição no histórico do épico local
- Runbook e teste E2E do fluxo

### Out of scope

- Mudar status, datas, milestone ou meta do épico (já há comandos próprios ou ficam para outra issue)
- Preencher em lote os épicos antigos

### Tasks

- [ ] Adicionar a edição de épico ao contrato do tracker
- [ ] Implementar a edição de título e descrição nos três trackers
- [ ] Expor o comando `epic update` no CLI e na ajuda
- [ ] Escrever o runbook e o teste E2E
- [ ] Registrar a mudança no CHANGELOG

## Acceptance criteria

- [ ] `pmkit epic update <id> --description-file d` troca a descrição, e `pmkit epic get <id>` mostra o texto novo
- [ ] `pmkit epic update <id> --title-file t` troca o título e mantém a descrição
- [ ] O dry-run mostra o antes e o depois e não grava nada
- [ ] No tracker local, o histórico do épico registra a edição com autor e data
- [ ] No Linear e no GitHub, a edição chega ao tracker remoto
- [ ] Um ID de épico inexistente responde NOT_FOUND
- [ ] O comando sem nenhuma mudança responde INVALID_INPUT
