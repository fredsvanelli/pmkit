---
id: PMK-347
title: Gravar a descrição do épico no epic create e preenchê-la no from-prd e no import
type: feature
status: in_review
priority: medium
estimate: 5
parent: EPC-6
branch: pmk-347-epic-description
created: 2026-11-18T01:40:58.620Z
updated: 2026-11-18T03:35:31Z
---

## Description

### Context

O `/pmkit:spec:from-prd` e o `/pmkit:spec:import` criam o épico só com o título. Quem abre o épico depois não sabe o propósito dele, o que fica fora da v1 nem onde está o PRD refinado. Os três trackers (local, Linear e GitHub) já guardam uma descrição de épico, mas o comando `epic create` não oferece um jeito de passá-la, então os procedimentos não têm como preenchê-la.

### Scope (in)

- `epic create` aceita uma descrição vinda de arquivo, também no dry-run, nos trackers local, Linear e GitHub
- O Stage 4 do `/pmkit:spec:from-prd` monta a descrição do épico a partir do PRD refinado e a mostra na aprovação do épico
- O `/pmkit:spec:import` monta a descrição do épico a partir da spec e a mostra na aprovação da árvore
- A descrição cita o caminho do PRD refinado ou da spec gravada, e as ADRs do fluxo
- Runbooks e testes E2E dos dois fluxos cobrem a descrição

### Out of scope

- Editar a descrição de um épico que já existe (issue separada, `epic update`)
- Mudar a descrição de um épico existente passado como `epic-id`

### Tasks

- [ ] Aceitar a descrição do épico na criação pelo CLI, nos três trackers
- [ ] Gerar e mostrar a descrição do épico no Stage 4 do from-prd
- [ ] Gerar e mostrar a descrição do épico no import
- [ ] Atualizar os runbooks e os testes E2E do from-prd e do import
- [ ] Registrar a mudança no CHANGELOG e na ajuda do CLI

## Acceptance criteria

- [x] `pmkit epic create --title-file t --description-file d` grava a descrição, e `pmkit epic get <id>` a mostra, no tracker local
- [x] O dry-run de `epic create` com `--description-file` mostra a descrição que seria gravada
- [x] No Linear e no GitHub, `epic create --description-file` envia a descrição ao tracker
- [x] Um épico novo criado pelo /pmkit:spec:from-prd tem uma descrição com o propósito, o que fica fora da v1 e o caminho do PRD refinado
- [x] A aprovação do épico no Stage 4 do from-prd mostra a descrição antes de gravar
- [x] Um épico novo criado pelo /pmkit:spec:import tem uma descrição tirada da spec, mostrada na aprovação da árvore
- [x] Com um epic-id existente, nenhum dos dois fluxos altera a descrição do épico
- [x] Os runbooks spec-from-prd e spec-import passam com a descrição do épico conferida
