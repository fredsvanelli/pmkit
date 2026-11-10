# Registro dos follow-ups da EPC-6

Escopo: as 66 issues abertas de PMK-176 a PMK-242 (PMK-201 já em `done`). Bugs primeiro (os de prioridade alta na frente), depois features. Rodadas de 3 issues, workers Claude do Orca, merge pelo orquestrador depois da aprovação. Mesmo processo da EPC-6 (`epc-6-orchestrator-prompt.md`), briefs `brief-base.md` e `review-base.md`, lições em `lessons.md`.

Modelos: implementador haiku para estimativa 1 e mudança mecânica (PMK-191, PMK-227, PMK-231), sonnet para 1 a 3, opus para 5. Revisor sonnet para estimativa até 2, opus para 3 ou mais.

Dependências: PMK-233 espera PMK-213, PMK-236 espera PMK-225, PMK-237 espera PMK-216.

| Rodada | Issues |
|---|---|
| 1 | PMK-198, PMK-192, PMK-179 |
| 2 | PMK-178, PMK-176, PMK-177 |
| 3 | PMK-180, PMK-181, PMK-182 |
| 4 | PMK-183, PMK-184, PMK-185 |
| 5 | PMK-186, PMK-187, PMK-188 |
| 6 | PMK-189, PMK-190, PMK-191 |
| 7 | PMK-193, PMK-194, PMK-195 |
| 8 | PMK-196, PMK-197, PMK-199 |
| 9 | PMK-200, PMK-202, PMK-203 |
| 10 | PMK-204, PMK-205, PMK-206 |
| 11 | PMK-207, PMK-209, PMK-214 |
| 12 | PMK-218, PMK-225, PMK-229 |
| 13 | PMK-234, PMK-208, PMK-210 |
| 14 | PMK-211, PMK-212, PMK-213 |
| 15 | PMK-215, PMK-216, PMK-217 |
| 16 | PMK-219, PMK-220, PMK-221 |
| 17 | PMK-222, PMK-223, PMK-224 |
| 18 | PMK-226, PMK-227, PMK-228 |
| 19 | PMK-230, PMK-232, PMK-233 |
| 20 | PMK-231, PMK-235, PMK-236 |
| 21 | PMK-237, PMK-239, PMK-241 |
| 22 | PMK-238, PMK-240, PMK-242 |

## Rodada 1

Início: 2026-11-08. `develop` em f864fa7, `npm test` com 3884 testes, 3803 pass, 0 fail, 81 skipped, saída 0.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-198 | 1 | sonnet | #125 | ciclo 1 (sonnet): mudanças pedidas (AC1); ciclo 2 (sonnet): APROVADO; rebase a0cf569 | mergeado (cffd88d) |
| PMK-192 | 1 | sonnet | #127 | ciclo 1 (sonnet): mudanças pedidas; ciclo 2 (sonnet): APROVADO | mergeado (ddaa2a1) |
| PMK-179 | 2 | sonnet | #126 | ciclo 1 (sonnet): APROVADO | mergeado (3d6c513) |

- PMK-198 mexe em todos os arquivos de comando; vai na primeira rodada para que as rodadas seguintes partam dela.
- Run Orca `run_b008a1671d3d`. Dispatches: PMK-198 `ctx_cc2eced133fa`, PMK-192 `ctx_3fe8978bbfb0`, PMK-179 `ctx_2583d4c23d34`. Workspaces em `~/orca/workspaces/pmkit/pmk-<n>-impl`, base `origin/develop`.

- PMK-198: PR #125 (sonnet). Revisor ciclo 1 (sonnet) iniciado.
- PMK-179: PR #126 (sonnet). Revisor ciclo 1 (sonnet) iniciado. Decisão do implementador: épico cancelado sai com counted:false e fora das somas de progresso da meta. Follow-ups: comando para status de épico; parseYaml com lista de mapas em epic.md.
- PMK-198 ciclo 1 (sonnet): mudanças pedidas. Decidi resolver o AC1 aqui: flags epic create --title-file, milestone create --name-file, docs next-adr --title-file; limpeza em breakdown.md; regex do teste mais larga.
- PMK-192: PR #127 (sonnet). Revisor ciclo 1 (sonnet) iniciado. Decisões do implementador: validBranch/resolveDefaultBranch compartilhado, valor inválido cai para main com nota; comando novo `pmkit default-branch` usado em pause, progress, review, investigate-bug e work; validate reporta, sem recusar escritas. Follow-ups: guarda para outros valores de config interpolados em shell; NFC em nomes de branch.
- PMK-179 ciclo 1 (sonnet): APROVADO. Mergeado. Não bloqueantes (defeitos, viram issue): tabela de texto de goals overview não marca épico cancelado (pmkit.mjs:2203); goal progress mostra Done/Total do cancelado sem nota (pmkit.mjs:813); removeKey de goal em bloco provavelmente inalcançável (tracker.mjs:1319); CRLF vira LF ao editar epic.md (tracker.mjs:1321); goal minúsculo sem dica de caixa (validate.mjs:379).
- PMK-198 correção fe4a178: --title-file em epic create e docs next-adr, --name-file em milestone create e release create (lineFromFlag compartilhado); regex do plugin test larga. Ficam de follow-up: cycle open --goal, requests --reason, issues list --text. Revisor ciclo 2 (sonnet) iniciado.
- PMK-192 ciclo 1 (sonnet): mudanças pedidas: default-branch dependia de ctx.config(); BRANCH_NAME sem \p{M}. Pedi junto: validBranch como git check-ref-format, nota de fallback só onde a base é usada, notas do next-adr. Follow-up: validar --from/--base.
- PMK-198 ciclo 2 (sonnet): APROVADO. Em conflito com develop; pedi rebase e, no mesmo push, a vírgula dobrada e as aspas do nome posicional em doctor.md. Não bloqueantes restantes: passo 10 de work.md não diz que cada candidato usa o próprio arquivo; CHANGELOG não lista --text/--goal/--reason/issues update --title como follow-up.
- PMK-198: rebase a0cf569 (conflito só no CHANGELOG), doctor.md com id posicional só quando segue a regra de id; conferi o diff pós-aprovação. Mergeado (cffd88d).
- PMK-192 correção: default-branch lê só .pmkit/config.yaml; \p{M} aceito; validBranch como check-ref-format; nota só onde a base é usada; rebase em cffd88d. Revisor ciclo 2 (sonnet) iniciado.
- PMK-192 ciclo 2 (sonnet): APROVADO. Não bloqueante: BRANCH_NAME recusa nomes que o git aceita (release#2, rc+1) e duplica isBranchName de lib/ids.mjs. Mergeado (ddaa2a1).

Fim da rodada 1: PRs #125, #126, #127 mergeados. Os achados não bloqueantes ficam neste registro; pergunto ao usuário no fim se viram issues.

Limpeza da rodada 1: closing PR #128 mergeado (88cda32), workers liberados, 8 worktrees removidos (só `package-lock.json` não rastreado), branches provisórias apagadas.

## Rodada 2

Início: 2026-11-08. `develop` em 88cda32, `npm test` com 3920 testes, 3839 pass, 0 fail, 81 skipped, saída 0. Run Orca `run_56e782bf76bb`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-178 | 2 | sonnet (`ctx_bf27cb239bf5`) | #129 | ciclo 1 (sonnet): APROVADO | mergeado (00ea5d6) |
| PMK-176 | 2 | sonnet (`ctx_5b99c3711bb7`) | #130 | ciclo 1 (sonnet): mudanças pedidas; ciclo 2 (sonnet): APROVADO | mergeado (5d25d56) |
| PMK-177 | 2 | sonnet (`ctx_dbd557316bed`) | #131 | ciclo 1 (sonnet): mudanças pedidas; ciclo 2 (sonnet): APROVADO | mergeado (ae47ec3) |

- PMK-176: PR #130 (sonnet); fallback para comentário em escala condicional/NOT_SUPPORTED, escala por time, escala vazia dá comentário só em dias. Revisor ciclo 1 (sonnet) iniciado.
- PMK-178: PR #129 (sonnet); também marcou resolução de conversas como não avaliada quando as threads não são lidas. Follow-up: reviewDecision APPROVED vs contagem de aprovações. Revisor ciclo 1 (sonnet) iniciado.
- Os primeiros revisores de #129 e #130 (ctx_103ea8616667, ctx_f0ffec500792) receberam spec quebrada (zsh não divide `$p` no `set --`); parei os dois antes de qualquer comentário no PR e reiniciei: PMK-176 `ctx_637b3da6f74b`, PMK-178 `ctx_71786467e643`.
- PMK-177: PR #131 (sonnet); refs do PR por leitura separada de gh pr view; PR mergeado com 406 sem diferença vira incomplete:true; não commitado = só rastreados. Follow-ups: diff de PR rebase-merged pelo merge commit; nota de working tree ciente de --branch. Revisor ciclo 1 (sonnet) iniciado.
- PMK-176 ciclo 1 (sonnet): mudanças pedidas (escala condicional/vazia podia gravar dias como pontos; update sem efeito com confirm none).
- PMK-178 ciclo 1 (sonnet): APROVADO. Não bloqueantes: pr-blockers.mjs:118-119 marca required checks/approvals como não checados mesmo sem essa regra (sem teste); host.mjs:43 nextStep genérico para SAML/escopo e casa só o início da 1a linha do stderr; blockersText ~193 lê unevaluated.length sem ?.
- PMK-178 mergeado (00ea5d6).
- PMK-177 ciclo 1 (sonnet): mudanças pedidas (PR mergeado descartado com branch local à frente/atrás; diff parcial sem incomplete com working tree sujo). Pedi junto os não bloqueantes de robustez.
- PMK-176 correção: passo 7 só no caminho de gravação; proposta igual com confirm none não escreve; achados 3 a 7 corrigidos com 3 testes; rebase. Revisor ciclo 2 (sonnet) iniciado.
- PMK-176 ciclo 2 (sonnet): APROVADO. Não bloqueantes: redação do markdown (horas livres no passo 6, INVALID_INPUT fora da escala, NOT_SUPPORTED depois de already fits, testes por regex); problema parecido de escala em breakdown.md e create.md. Mergeado (5d25d56).
- PMK-177 correção: PR mergeado mantido quando a cabeça é ponta ou ancestral da branch local ou de origin (host.branchHas); incomplete segue o intervalo commitado; working tree ilegível e base não resolvida viram nota+incomplete; untracked por arquivo; investigate-bug.md e review.md tratam incomplete; rebase. Revisor ciclo 2 (sonnet) iniciado.
- PMK-177 ciclo 2 (sonnet): APROVADO. Não bloqueantes: branchHas trata status 128 de is-ancestor como não está na branch (host.mjs:301); prRefs fora de try/catch (pmkit.mjs:1517); fallback casa /base branch/ na mensagem (pmkit.mjs:1556); design ainda cita VIEW_FIELDS. Mergeado (ae47ec3).

Fim da rodada 2: PRs #129, #130, #131 mergeados.

Limpeza da rodada 2: closing PR #132 mergeado (789fc88), 8 worktrees removidos, branches provisórias apagadas.

## Rodada 3

Início: 2026-11-08. `develop` em 789fc88, `npm test` com 3955 testes, 3874 pass, 0 fail, 81 skipped, saída 0. Run Orca `run_6b9a0b657e46`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-180 | 1 | sonnet (`ctx_0bce25776e19`) | #135 | ciclo 1 (sonnet): APROVADO; rebase 80a95bf | mergeado (2a97484) |
| PMK-181 | 1 | sonnet (`ctx_0dbfd7385e10`) | #133 | ciclo 1 (sonnet): APROVADO | mergeado (c02ad41) |
| PMK-182 | 1 | sonnet (`ctx_68666a32c43a`) | #134 | ciclo 1 (sonnet): APROVADO; rebase 92a99d6 | mergeado (6068951) |

- PMK-181: PR #133 (sonnet); parseDelegation já tinha a correção da PMK-58, só testes; texto de identidade reescrito. Follow-ups: passo 7 de delegate.md ambíguo para identidade git/gh; sem --as no git. Revisor ciclo 1 (sonnet) iniciado.
- PMK-182: PR #134 (sonnet); --path ausente dá INVALID_INPUT; comentários de bloco SQL/Lua/Haskell; campo cut no JSON. Follow-ups: níveis --[=[ do Lua, comentários aninhados do Haskell. Revisor ciclo 1 (sonnet) iniciado.
- PMK-181 ciclo 1 (sonnet): APROVADO. Não bloqueantes: texto your own identity ambíguo (delegation.mjs:24); regex frouxa (delegation.test.mjs:49); spec da PMK-57 com texto antigo; lista de eventos em delegate.md:27 sem branch. Mergeado (c02ad41).
- PMK-182 ciclo 1 (sonnet): APROVADO, em conflito com develop; pedi rebase com todos.md:50, teste de cut true e aspas simples no estilo hs. Não bloqueantes restantes: --path existente mas ignorado dá no TODO found (todos.mjs:316); alerts scan sem cut (pmkit.mjs:1345).
- PMK-180: PR #135 (sonnet); views list reporta nomes inválidos e --json passa a {views, problems} (mudança de formato, como customers list); doctor não propõe views save para problema de nome; dica do Linear; filterText com aspas. Revisor ciclo 1 (sonnet) iniciado.
- PMK-182: rebase 92a99d6 (só CHANGELOG), diff pós-aprovação conferido (todos.md, teste de cut, hs com chars). Mergeado (6068951).
- PMK-180 ciclo 1 (sonnet): APROVADO, em conflito com develop; pedi rebase com o texto no views quando só há problemas e o null impresso. Não bloqueantes restantes: dotfiles .yaml viram problema; bullet NOT_FOUND de run-view.md.
- PMK-180: rebase 80a95bf, diff pós-aprovação conferido. Mergeado (2a97484).

Fim da rodada 3: PRs #133, #134, #135 mergeados.

Limpeza da rodada 3: closing PR #136 mergeado (f361005), 6 worktrees removidos, branches provisórias apagadas.

## Rodada 4

Início: 2026-11-08. `develop` em f361005, `npm test` com 3962 testes, 3881 pass, 0 fail, 81 skipped, saída 0. Run Orca `run_e9dab19a2b7a`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-183 | 2 | sonnet (`ctx_70ece43b3872`) | #137 | ciclo 1 (sonnet): mudanças pedidas; ciclo 2 (sonnet): APROVADO; rebase fdc67e5 | mergeado (97718f7) |
| PMK-184 | 1 | sonnet (`ctx_8c5c9163bc2f`) | #138 | ciclo 1 (sonnet): APROVADO; rebase f947019 | mergeado (aa6a444) |
| PMK-185 | 1 | sonnet (`ctx_5e7e0fdfb9b9`) | #139 | ciclo 1 (sonnet): APROVADO | mergeado (5ff271f) |

- PMK-183: PR #137 (sonnet); --sprint current sem sprint, no_availability, razões conditional/would_not_improve/zero_estimate, alvo de time no Linear. Manteve a regra alvo acima da origem. Follow-ups: relaxar essa regra; dias de folga na escolha do alvo; membership no issues assign do Linear. Revisor ciclo 1 (sonnet) iniciado.
- PMK-184: PR #138 (sonnet); AC1 já respondia INVALID_INPUT em develop, só teste de regressão; ci logs --run preenche workflowName/url/conclusion/status e logNote para run sem falha, não terminado, startup_failure ou log vazio. Revisor ciclo 1 (sonnet) iniciado.
- PMK-185: PR #139 (sonnet); advisory escolhida pela severidade do alerta, senão a mais grave; nota do caminho derivado no stderr, 4 goldens regenerados. Follow-ups: nota no --json; stderr na saída JSON inválida do npm. Revisor ciclo 1 (sonnet) iniciado.
- PMK-183 ciclo 1 (sonnet): mudanças pedidas (filtro de sobrecarga bloqueia tirar trabalho de quem tem availability 0; issues sem estimativa somem e null encerra o laço; nota falsa com --sprint current sem sprint).
- PMK-185 ciclo 1 (sonnet): APROVADO (nota só no stderr é o padrão do CLI e nenhum arquivo de comando chama alerts list). Não bloqueantes: comentário falso em pmkit.mjs:1309; corte de 300 caracteres do stderr pode perder npm ERR! (alerts.mjs:15); README:161 sem a nota; shim 9009 com stdout cai em not valid JSON. Mergeado (5ff271f).
- PMK-183 correção: trabalho de availability 0 passa pelo filtro; issues sem estimativa propostas com marcador unsized; null não para o laço; nota falsa removida; razão no_target; teste Linear cycles-off. Revisor ciclo 2 (sonnet) iniciado.
- PMK-184 ciclo 1 (sonnet): APROVADO. Não bloqueantes: --run deixa de buscar log de runs cancelled/action_required/stale/skipped (host.mjs:244, pmkit.mjs:1503); regra de conclusões repetida (pmkit.mjs:1498); teste perdeu asserção do --log-failed para timed_out (github-host.test.mjs:274).
- PMK-184: rebase f947019, --log-failed também para cancelled/skipped etc. com --run, asserção de timed_out de volta; diff pós-aprovação conferido. Mergeado (aa6a444).
- PMK-183 ciclo 2 (sonnet): APROVADO, em conflito com develop; pedi rebase com mensagens sem sobrecarga para doador ausente, sem load null, e JSON/nota certos com --sprint current sem sprint. Follow-up: would_not_improve com alvos recusados por sobrecarga.
- PMK-183: rebase fdc67e5 com os não bloqueantes; diff pós-aprovação conferido. Mergeado (97718f7).

Fim da rodada 4: PRs #137, #138, #139 mergeados.

Limpeza da rodada 4: closing PR #140 mergeado (8ea61f6), 7 worktrees removidos, branches provisórias apagadas.

## Rodada 5

Início: 2026-11-08. `develop` em 8ea61f6, `npm test` com 3989 testes, 3908 pass, 0 fail, 81 skipped, saída 0. Run Orca `run_8e7604a57228`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-186 | 1 | sonnet (`ctx_aedc21031316`) | #142 | ciclo 1 (sonnet): APROVADO | mergeado (09e14cd) |
| PMK-187 | 2 | sonnet (`ctx_b6995a90acf6`) | #141 | ciclo 1 (sonnet): mudanças pedidas; ciclo 2 (sonnet): APROVADO; rebase 7a12a2a | mergeado (25f2a2d) |
| PMK-188 | 1 | sonnet (`ctx_2531075fd490`) | #143 | ciclo 1 (sonnet): APROVADO com regressão do init pedida; revisão curta (sonnet): APROVADO | mergeado (0ae7445) |

- PMK-187: PR #141 (sonnet); Linear com leitura includeArchived separada; Local apaga renomeando para .deleting-<id> e limpa depois (falha vira aviso); menções com barra só quando todas as partes são IDs. Follow-ups: limpeza de .deleting- no doctor/validate; menções em texto do Linear. Revisor ciclo 1 (sonnet) iniciado.
- PMK-186: PR #142 (sonnet); cópias de fixture (makeRepo, prepareCopy) pulam .issues/.cache via copyFixture; .gitignore lista caches de fixture; cabeçalho de scenarios-live.mjs sem contagens, com teste. CLI não mudou. Follow-ups: CLI avisar ou recusar dentro de __fixtures__; cobertura de LIVE_EXPECT_STOPS derivada da lista. Revisor ciclo 1 (sonnet) iniciado.
- PMK-188: PR #143 (sonnet); validate reporta github sem repo fora de pmkitConfigMessages (não recusa escritas, link-repo --repo conserta); branch inferida só quando o repo escrito é o do remote. Follow-ups: inferência compartilhada link-repo/setup; recusar link-repo --team com config github sem repo só quando irreparável. Revisor ciclo 1 (sonnet) iniciado.
- PMK-187 ciclo 1 (sonnet): mudanças pedidas (.deleting- que sobra vira issue inválida no validate e bloqueia migração; filtro de menções descarta token com barra).
- PMK-186 ciclo 1 (sonnet): APROVADO. Não bloqueantes: migrate-live.mjs:247 e :444 ainda usam fs.cpSync puro (trocar por copyFixture); copyFixture compara string em vez de path.relative; teste do cabeçalho não guarda indexOf=-1. Mergeado (09e14cd).
- PMK-188 ciclo 1 (sonnet): APROVADO, mas pedi antes do merge: init grava github sem repo e o novo validate acusa (regressão); comparação de repo sem caixa; doc do --git-host none; recusa de --team/--default-branch. Follow-up: inferência em subdiretório de monorepo.
- PMK-187 correção 28c0a24: validate reporta .deleting- como leftover com passo rm -rf; import da migração ignora; menções cortam URLs primeiro e só descartam tokens de caminho; sufixo pid-timestamp; guarda win32. Follow-ups: includeArchived só no fake; removes.autoCommit pode divergir do commit real. Revisor ciclo 2 (sonnet) iniciado.
- PMK-187 ciclo 2 (sonnet): APROVADO; pedi rebase com a menção em link relativo e migrate-writer/migrations ignorando .deleting-*.
- PMK-187: rebase 7a12a2a com menção em link relativo e .deleting-* fora de migrate-writer e da cópia da migração; diff pós-aprovação conferido. Mergeado (25f2a2d).
- PMK-188 correção d7a136f: init pega o repo do origin ou recusa; comparação sem caixa; doc; --team/--default-branch avisam em vez de recusar; rebase. Revisão curta (sonnet) iniciada.
- PMK-188 revisão curta (sonnet): APROVADO; init sem remote e --git-host none funcionam, recusa só com github pedido. Não bloqueantes: init só olha origin; retorno de withGithubRepo descartado; reescrita com caixa diferente sem nota; init --update --git-host none não limpa repo/default_branch; fixtures antigas com github sem repo. Mergeado (0ae7445).

Fim da rodada 5: PRs #141, #142, #143 mergeados.

Limpeza da rodada 5: closing PR #144 mergeado (9871252), 8 worktrees removidos, branches provisórias apagadas.

## Rodada 6

Início: 2026-11-08. `develop` em 9871252, `npm test` com 4015 testes, 3934 pass, 0 fail, 81 skipped, saída 0. Run Orca `run_dee6073e435d`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-189 | 1 | sonnet (`ctx_e0671cee394b`) | #145 | ciclo 1 (sonnet): APROVADO | mergeado (9d5a040) |
| PMK-190 | 2 | sonnet (`ctx_ad21214fdfb3`) | #147 | ciclo 1 (sonnet): APROVADO; rebase 5c2f659 | mergeado (7a21a3e) |
| PMK-191 | 1 | haiku (`ctx_e2de6d36619e`) | #146 | ciclo 1 (sonnet): APROVADO; rebase 5e36544 | mergeado (74983c5) |

- PMK-189: PR #145 (sonnet); workingDays conta só datas distintas de dia útil dentro do sprint; --days-off ruim já dava INVALID_INPUT, só teste. Follow-ups: aviso para datas repetidas/fim de semana/fora do sprint; validar days_off no validate. Revisor ciclo 1 (sonnet) iniciado.
- PMK-189 ciclo 1 (sonnet): APROVADO. Não bloqueantes: texto mostra a lista de days off guardada junto de Working days que a ignora (pmkit.mjs:2412); teste só de sintaxe ruim (cli-team-capacity.test.mjs:240); entrada fora de YYYY-MM-DD ignorada sem aviso (team-capacity.mjs:26). Mergeado (9d5a040).
- PMK-191: PR #146 (haiku); readThroughIndex com signer injetável, metade ctime do teste determinística; falha original não reproduzida, causa inferida; 20 execuções seguidas passaram. Follow-up: checagem de ctime com relógio real em runStates. Revisor ciclo 1 (sonnet) iniciado.
- PMK-190: PR #147 (sonnet); mais novo primeiro com empate por id decrescente; requests list --customer recusa vazio; accept/decline editam só as linhas de estado via yaml-edit (mantém comentários); golden de requests get com chave problems. Follow-ups: requests/customers no Linear; linha de texto para problems em requests get; proposta do doctor para referência de cliente ilegível. Revisor ciclo 1 (sonnet) iniciado.
- PMK-191 ciclo 1 (sonnet): APROVADO (signer não muda produção; causa plausível, não provada). Em conflito; pedi rebase com o mesmo signer em runStates (query-index.test.mjs:476) e spec/plano alinhados.
- PMK-191: rebase 5e36544, runStates e a matriz do query-index com o signer injetado; 10 execuções seguidas passaram; diff pós-aprovação só de teste e docs. Mergeado (74983c5).
- PMK-190 ciclo 1 (sonnet): APROVADO, em conflito; pedi rebase com as mensagens trocadas (tracker.mjs:1453 e :1539) e problems em accept/decline. Não bloqueantes restantes: nome duplicado com arquivo ilegível (:1450); triage com comentário final ou chave entre aspas (:1583); validate não reporta issue ilegível (validate.mjs:399).
- PMK-190: rebase 5c2f659 com mensagens corrigidas e problems em accept/decline; goldens conferidos. Mergeado (7a21a3e).

Fim da rodada 6: PRs #145, #146, #147 mergeados.

Limpeza da rodada 6: closing PR #148 mergeado (479edab), 6 worktrees removidos, branches provisórias apagadas.

## Rodada 7

Início: 2026-11-09. `develop` em 479edab, `npm test` com 4033 testes, 3952 pass, 0 fail, 81 skipped, saída 0. Run Orca `run_62b503d142a5`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-193 | 1 | sonnet (`ctx_bcdaf2b3fa2e`) | #149 | ciclo 1 (sonnet): APROVADO | mergeado (8612553) |
| PMK-194 | 1 | sonnet (`ctx_c7235a905753`) | #151 | ciclo 1 (sonnet): mudanças pedidas; ciclo 2 (sonnet): mudanças pedidas (regressão da minha instrução); correção conferida pelo orquestrador; rebase f8b4f65 | mergeado (94e1fdc) |
| PMK-195 | 2 | sonnet (`ctx_e94b00e95e97`) | #150 | ciclo 1 (sonnet): mudanças pedidas; ciclo 2 (sonnet): APROVADO | mergeado (86ce331) |

- PMK-193: PR #149 (sonnet); inteiros inseguros dão INVALID_INPUT; entradas longas com dias (1d1h); nota da escrita real diz que já registrou; comentário de correção na PMK-60. Follow-ups: comando para apagar/corrigir time entry; mesma nota no fallback de comentário do Linear. Revisor ciclo 1 (sonnet) iniciado.
- PMK-195: PR #150 (sonnet); itens do corpo com by null e menção nas Notes como description; hora ilegível de evento/comentário é problem no inbox e no validate; mark-read reporta chaves desconhecidas (unknown, saída 0) e marca o resto; prune mantém chaves de itens em outras branches (git ls-tree local e remoto). Follow-ups: autor real de linha de description; validate de hora ruim em outros arquivos; at do item de description. Revisor ciclo 1 (sonnet) iniciado.
- PMK-195: o primeiro start do revisor (ctx_4e114b76115d) ficou com o composer vazio (turn_start_unobserved); pela aprovação permanente do usuário, worker-abandon, task-update ready e worker-start no mesmo terminal: `ctx_bde902fe472f`, rodando.
- PMK-194: PR #151 (sonnet); caminho relativo ao tracker fora do repo; só nomes NNNN- contam; pasta lida uma vez com tracker.path .; slugs Unicode transliterados. Follow-up: nomes 0007a ignorados (número duplicado possível). Revisor ciclo 1 (sonnet) iniciado.
- PMK-193 ciclo 1 (sonnet): APROVADO. Não bloqueantes: README:98 ainda diz no upper limit; tracker.mjs:539,1014,1021 ainda usam Number.isInteger.
- PMK-193 mergeado (8612553). O README:98 desatualizado vai corrigido no closing PR da rodada.
- PMK-195 ciclo 1 (sonnet): mudanças pedidas (poda decide pela pasta e não pelo item; falha da leitura de branches poda tudo).
- PMK-194 ciclo 1 (sonnet): mudanças pedidas (corte do slug deixa surrogate solto; record-decision.md passo 6 não atualizado).
- PMK-195 correção f0a8259: poda por item (comentário, linha de menção ou evento de assign na ponta de cada branch, refs lidas uma vez); falha do git mantém as chaves com nota; unknown sem duplicatas; created vazio não é problema; at inválido reportado. Revisor ciclo 2 (sonnet) iniciado.
- PMK-194 correção b37fe4e: slug por code point; passo 6 de record-decision.md cita o documento do tracker; NNNN- exige 4 dígitos e um não dígito; título só de marcas recusado. Revisor ciclo 2 (sonnet) iniciado.
- PMK-195 ciclo 2 (sonnet): APROVADO. Não bloqueantes: git show em raiz de subpasta; git por chave sem curto-circuito depois de falha; mensagem de erro em timeout; created vazio entre aspas. Mergeado (86ce331).
- PMK-194 ciclo 2 (sonnet): mudanças pedidas: o regex NNNN- da minha instrução do ciclo 1 deixou de contar slug que começa com dígito (0003-2fa); pedi excluir só o formato de data AAAA-MM-DD-.
- PMK-194 fa9fd03: regex conferido pelo orquestrador (0003-2fa conta; 2026-10-31-x não; troca aceita: 0004-10-05-notes não conta). Aprovado sem ciclo 3; pedi rebase final.
- PMK-194 mergeado (94e1fdc).
- README:98 (log-time sem limite superior) corrigido no closing PR da rodada 7.

Fim da rodada 7: PRs #149, #150, #151 mergeados.

Limpeza da rodada 7: closing PR #152 mergeado (ebe6ddc, com a linha de log-time do README), 8 worktrees removidos, branches provisórias apagadas.

## Rodada 8

Início: 2026-11-09. `develop` em ebe6ddc, `npm test` com 4050 testes, 3969 pass, 0 fail, 81 skipped, saída 0. Run Orca `run_dcd377095f49`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-196 | 1 | sonnet (`ctx_f4c4932c0bbe`) | #153 → #156 | ciclos 1 e 2 (sonnet): mudanças pedidas; correção conferida pelo orquestrador; rebase b6a8f86; #153 não sincronizou e foi substituído pelo #156 | mergeado (10bfb3b) |
| PMK-197 | 2 | sonnet (`ctx_fa6e133e7447`), depois opus (`ctx_2fe052060baa`) | #155 | ciclos 1 a 5 (opus): mudanças pedidas (8, 7, 4, 5, 3 bloqueantes); revisão curta (opus): 1 bloqueante (tempo); correção c5c611c conferida pelo orquestrador | mergeado (6faf7ea) |
| PMK-199 | 1 | sonnet (`ctx_7ceef4cf4801`) | #154 | ciclo 1 (sonnet): APROVADO | mergeado (83ba4df) |

- PMK-196: PR #153 (sonnet); trim de label (remove aceita vírgula, add ainda recusa); lote de uma issue relança o código da operação; --text só de espaço; próximo passo da view; doc da falha só do commit. Follow-ups: labels com vírgula no Linear; flag própria no JSON para a falha só do commit. Revisor ciclo 1 (sonnet) iniciado.
- PMK-199: PR #154 (sonnet); comentário quebrado marca a issue como unknown e o comando segue; só leitura de proteção bem-sucedida vai para o cache; texto de incompleto/bloqueado diz o que é desconhecido. Follow-up: cache de 403/404 persistente por base. Revisor ciclo 1 (sonnet) iniciado.
- PMK-197: PR #155 (sonnet); valor depois de chave secreta trocado inteiro; Authorization em JSON e curl -u (tipo curl_user); fechamentos de Markdown mantidos; falsos positivos aceitos listados na spec. Follow-ups: docker login -p; pontuação no fim da senha; password=x&user=y; isenção de PWD/OLDPWD. Revisor ciclo 1 (opus, por ser caminho de segurança) iniciado.
- PMK-196 ciclo 1 (sonnet): mudanças pedidas (bulk.md passo 4 promete INVALID_INPUT para lote de uma issue; CONFLICT cai no passo 7 e repete o dry run). JSON distingue a falha só do commit (applied sem failed).
- PMK-199 ciclo 1 (sonnet): APROVADO. Não bloqueantes: Output de track-agents.md:31 ainda diz when nothing is assigned; só FrontmatterError tratado (pmkit.mjs:2200); causa not ready imprecisa (~2232); 403/404 da proteção não é mais cacheado (2188); spec promete aviso no texto de lista não vazia. Mergeado (83ba4df).
- PMK-196 correção ac826d5: bulk.md passo 4 com NOT_FOUND/CONFLICT para lote de uma issue; CONFLICT do passo 7 só em execução real com --expect; label em branco recusado; remove casa label guardado com espaço. Revisor ciclo 2 (sonnet) iniciado.
- PMK-196 ciclo 2 (sonnet): mudanças pedidas (nextStep de view sem critério sugere views save sem --overwrite e a CLI recusa; critério 4). Não bloqueantes: parent NOT_FOUND no doc; change.value cru.
- PMK-197 ciclo 1 (opus): mudanças pedidas, 8 bloqueantes em redact.mjs (aspa escapada/sem fechamento, NBSP, startsWith(MARK) regressão, bloco YAML, tempo quadrático, segunda passada não idempotente, fechamentos | __ ~~, falso positivo file:line:col). Follow-ups: pontuação no fim, password=x&user=y, docker login -p, curl_user continuado, sort -u/docker run -u.
- PMK-196 d61a12f: nextStep views save com --sort e --overwrite, testado rodando o comando; label-add apara. Conferido pelo orquestrador, aprovado sem ciclo 3; pedi rebase final.
- PMK-197 correção 76d1d59: os 8 bloqueantes com teste que falha antes; spec lista os falsos positivos aceitos; cenário confere o rascunho redigido inteiro; rebase. Decisão do implementador: token=123456 (numérico) sem redação. Revisor ciclo 2 (opus) iniciado.
- PMK-196: rebase b6a8f86. O GitHub não atualizou o head do PR #153 depois do force-push (ficou em d61a12f, CONFLICTING); fechei para resincronizar e ele recusou reabrir. Abri o PR #156 com a mesma branch, com nota nos dois PRs. Mergeado (10bfb3b).
- PMK-197 ciclo 2 (opus): mudanças pedidas, 7 bloqueantes (A YAML em diff/log; B valor na linha de baixo; C | no meio, regressão; D => := ==; E isenção numérica perde segredos; F abertura de crase/** comida, regressão; G bloco YAML em item de lista apaga irmãs). Dois ciclos com bloqueantes: subi o implementador para opus (worker novo na mesma branch), com pedido de rever o desenho de redact.mjs.
- PMK-197 correção (opus) 10e3ae6: redactPairs reescrito sem casos por caractere (valor até o fim da linha; aspas; blocos e linha de baixo por recuo; => := == ===; número só quando a chave não termina na palavra secreta); custo: o resto da linha depois da chave é trocado, listado na spec. Revisor ciclo 3 (opus) iniciado.
- PMK-197 ciclo 3 (opus): mudanças pedidas, 4 bloqueantes (prefixo de diff na coluna; caminho:linha redigido, regressão; marca anterior faz pular a chave e AKIA/ghp_/xoxb vazam; filhos de mapeamento secreto visíveis). Três ciclos sem aprovação: perguntei ao usuário, que aprovou um quarto ciclo. Mandei ao implementador opus.
- PMK-197 ciclo 4 (opus) 09261cb: os 4 bloqueantes do ciclo 3 fechados com sondas; vários não bloqueantes baratos; goldens de text-redact e o cenário do investigate-bug atualizados. Revisor ciclo 4 (opus) iniciado.
- PMK-197 ciclo 4 (opus): mudanças pedidas, 5 bloqueantes (abertura de bloco { [ ( \ vaza o de baixo; arquivo:linha em crase/intervalo apagado, regressão; isenção numérica com furos; fechamento de Markdown dentro do segredo, regressão; vazamentos raros). Perguntei ao usuário: corrigir os 5 e revisar de novo. Mandei ao implementador opus (ciclo 5).
- PMK-197 ciclo 5 (opus) 76bdcd7: os 5 bloqueantes do ciclo 4 fechados; diff sobre 386 entradas sem regressão contra develop e idempotente. Revisor ciclo 5 (opus) iniciado.
- PMK-197 ciclo 5 (opus): mudanças pedidas, 3 bloqueantes (índice da chave esconde a palavra-segredo; fechamento seguido de pontuação, regressão; Markdown em volta da chave). Usuário aprovou corrigir os 3 com revisão curta só deles e da comparação contra develop. Ciclo 6 mandado ao implementador opus.
- PMK-197 ciclo 6 (opus) 9b4d8dd: os 3 corrigidos; comparação sobre 1168 entradas sem regressão contra develop nem contra 76bdcd7, idempotente; corrigiu lentidão quadrática que tinha introduzido. Revisão curta (opus) iniciada.
- PMK-197 revisão curta (opus): os 3 fechados, sem regressão nem saída não idempotente; um bloqueante: tempo quadrático em linha de tabela (redact.mjs:164). Mandei a correção local ao implementador; os 7 não bloqueantes (Markdown em dois níveis, índice aninhado, isenção pela chave de fora, ***, falso positivo em *=) viram follow-up.
- PMK-197 c5c611c: tempo linear em linha de tabela (conferido pelo orquestrador: 14 a 48 ms em 320k); saída idêntica à do 9b4d8dd em 1478 entradas. Mergeado (6faf7ea). Follow-ups: flags de linha de comando (docker login -p, mysql -p, wget --http-password, --password x, curl -u continuado); MYSQL_PASS/SSH_PASSPHRASE; Markdown em dois níveis; índice aninhado; isenção pela chave de fora; ***; falso positivo em *=; os tetos listados na spec.

Fim da rodada 8: PRs #154, #155, #156 mergeados (#153 substituído pelo #156).

Limpeza da rodada 8: closing PR #157 mergeado (647b950), 15 worktrees removidos. O implementador opus da PMK-197 deixou sem commit um rascunho de follow-up (PMK-246: flags de linha de comando, curl continuado, Authorization como argumento, chaves com espaço, ?= e +=, par do Kubernetes); guardei no scratchpad para a lista de follow-ups do fim.

## Rodada 9

Início: 2026-11-09. `develop` em 647b950, `npm test` com 4235 testes, 4154 pass, 0 fail, 81 skipped, saída 0. Run Orca `run_e58257261342`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-200 | 1 | sonnet (`ctx_9c92f481e982`) | #159 | ciclo 1 (sonnet): APROVADO; rebase dba5b3e | mergeado (deab7e0) |
| PMK-202 | 3 | sonnet (`ctx_8cd216e48960`) | #160 | ciclo 1 (opus): mudanças pedidas; ciclo 2 (opus): APROVADO; rebase c8553ba | mergeado (58adc21) |
| PMK-203 | 2 | sonnet (`ctx_c36bf5954c88`) | #158 | ciclo 1 (sonnet): APROVADO | mergeado (25ed51c) |

- PMK-203: PR #158 (sonnet); épico quebrado só conta no caminho das metas; arquivo solto em goals/ é nota; pai arquivado ou ilegível dá aviso em vez de virar linha de topo; arquivo de comando diz needs an epic só com complete. Follow-ups: aviso de arquivo solto no goals overview; teste do Linear para pai arquivado. Revisor ciclo 1 (sonnet) iniciado.
- PMK-203 ciclo 1 (sonnet): APROVADO. Não bloqueantes: goal com id mal formado vira arquivo solto com complete true; archived:true do Linear pode estourar o teto de 1000 issues; filtro duplicado em pmkit.mjs:2287; sem teste de goals com arquivo solto. Mergeado (25ed51c).
- PMK-200: PR #159 (sonnet); os três INVALID_INPUT de views run ganham details.reason estável (invalid_view_name, view_out_of_date, view_file_broken), saem em error.reason no --json e o passo 4 de run-view.md lê o reason. Revisor ciclo 1 (sonnet) iniciado.
- PMK-202: PR #160 (sonnet); caminhos degradados e de erro do roadmap review; goldens de risks e roadmap-review regenerados. Follow-ups: parar em RATE_LIMITED também nas leituras de épicos e milestones; teste do fake do Linear com dois milestones num épico pela CLI. Revisor ciclo 1 (opus) iniciado.
- PMK-200 ciclo 1 (sonnet): APROVADO, em conflito; pedi rebase com reason nos problems de views list e asserção no cenário do Linear. Não bloqueantes restantes: view_out_of_date vale para qualquer INVALID_INPUT de search (tracker.mjs:1937); Object.assign em vez do 4o argumento de PmkitError; doctor.md:37 ainda decide pelo texto.
- PMK-202 ciclo 1 (opus): mudanças pedidas (milestones [] quando listMilestones falha no Linear; Last update none ao lado de not checked). Pedi junto os não bloqueantes do mesmo tipo. Follow-ups: runRisks sem parada no rate limit; hasMore descartado nos adapters do Linear.
- PMK-200: rebase dba5b3e com reason nos problems de views list e asserção no cenário do Linear; conferi que o CHANGELOG não tem marcadores de conflito (um commit intermediário tinha). Mergeado (deab7e0).
- PMK-202 correção c28c57b: milestones null/unknown quando a lista falha no Linear; last update not checked (campo updatesRead); milestone sem data diz no due date; épicos/delay null quando a lista de épicos falha; RATE_LIMITED na leitura de seção para as leituras por épico; aviso de skip cita o último épico. Revisor ciclo 2 (opus) iniciado.
- PMK-202 ciclo 2 (opus): APROVADO. Pedi rebase final, com listMilestones depois de RATE_LIMITED e o catch que engole TypeError se forem pequenos. Não bloqueantes restantes: aviso de leitura pulada para épico cuja leitura rodou e falhou (pmkit.mjs:1967); unknown com NOT_SUPPORTED de milestones; duplicação de estilo; runRisks sem parada no rate limit; hasMore descartado nos adapters do Linear.
- PMK-202: rebase c8553ba com listMilestones pulado depois de RATE_LIMITED e TypeError relançado; diff pós-aprovação conferido. Mergeado (58adc21).

Fim da rodada 9: PRs #158, #159, #160 mergeados.

Limpeza da rodada 9: closing PR #161 mergeado (ad84993), 7 worktrees removidos, branches provisórias apagadas.

## Rodada 10

Início: 2026-11-09. `develop` em ad84993, `npm test` com 4266 testes, 4185 pass, 0 fail, 81 skipped, saída 0. Run Orca `run_0bb8d5b027ba`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-204 | 3 | sonnet (`ctx_bbf4e8109edf`) | #162 | ciclo 1 (opus): mudanças pedidas; ciclo 2 (opus): APROVADO; rebase 907ba8f | mergeado (6db471e) |
| PMK-205 | 3 | sonnet (`ctx_ac0c95c56e2d`) | #164 | ciclo 1 (opus): mudanças pedidas; ciclo 2 (opus): APROVADO; rebase f5f168d | mergeado (6051adf) |
| PMK-206 | 2 | sonnet (`ctx_3531374e5fd6`) | #163 | ciclo 1 (sonnet): mudanças pedidas; ciclo 2 (sonnet): APROVADO | mergeado (342cd4b) |

- PMK-204: PR #162 (sonnet); faixas só sobre score>0; problems da lista de demanda com campo about, só problemas de arquivo de request ou de candidato bloqueiam escritas; comentário próprio = do assignee ou Delegated to agent: (sem marcador, heurística); regra de menção compartilhada com issues delete em scripts/lib/mentions.mjs (diferencia maiúsculas). Follow-ups: marcador nos comentários do pmkit; leitura de menções por token inteiro na CLI (PMK-241); lista de demanda no Linear (PMK-242). Revisor ciclo 1 (opus) iniciado.
- PMK-206: PR #163 (sonnet); pr blockers separa reviews.requested (usuários) de reviews.requestedTeams; digest lê toda issue aberta e os PRs do autor; para em RATE_LIMITED; since= no Linear; cenário com mark-read de inbox completa e rate limit. Follow-ups: UPSTREAM transitório no passo 5.1 só marca uma issue; suíte live não confere o texto do digest. Revisor ciclo 1 (sonnet) iniciado.
- PMK-205: PR #164 (sonnet); seletores pulam leituras sem uso; leitura transitória ou stub deixa o relatório incompleto; base vazia dá ready null; deploys de tag achados além dos 20 mais novos e por refs/tags/. Follow-ups: listReleases real no Linear; aviso quando a lista de deploys bate em 100. Revisor ciclo 1 (opus) iniciado.
- PMK-204 ciclo 1 (opus): mudanças pedidas (critério 1 quebrado: issues sem demanda ficam acima da de menor score; nenhum cenário distingue a regra nova). Heurística do assignee aceita com contagem de ignorados e autores agent:*; regra de menção com maiúsculas aceita com uma linha no passo 4. Follow-ups: menções do Linear como URL; 30 leituras --text.
- PMK-206 ciclo 1 (sonnet): mudanças pedidas (unblock.md lê só reviews.requested, review pedido a time some; sem PR marcado como not verified deixa o digest sempre incompleto).
- PMK-205 ciclo 1 (opus): mudanças pedidas (empty sem olhar truncated/problems, regra da rodada 7; release só com canceladas sai ready true). Pedi junto: leitura não usada não deixa incompleto; tolerant só para transitórios; CHANGELOG fiel; próximo passo de --sprint current. Follow-ups: ~200 chamadas gh na busca de deploys por ref; testes de --release com falha e Linear com releases.
- PMK-206 correção cbc9f1a: unblock.md lê requestedTeams; sem PR é fato no passo 5.2; menores baratos. Follow-ups: isTeam trata entrada só com nome como usuário; cenário de rateLimited depende do snapshot; pr blockers por branch sem cache de proteção. Revisor ciclo 2 (sonnet) iniciado.
- PMK-204 correção fee5252: issue sem demanda acima da menor prioridade proposta a uma com demanda é limitada a esse piso; contagem de comentários ignorados; agent:* ignorados; linha de maiúsculas; cenário .6. Revisor ciclo 2 (opus) iniciado.
- PMK-206 ciclo 2 (sonnet): APROVADO. Não bloqueantes: aviso de login ausente no passo 5.4; since só com a data; teste por regex no cenário complete; custo de pr blockers por issue. Mergeado (342cd4b).
- PMK-205 correção 0cafaf3: empty só depois de leitura completa; só canceladas é base vazia; leituras preguiçosas na escolha automática; tolerant só RATE_LIMITED/UPSTREAM; próximo passo de --sprint current segue as releases. O primeiro npm test do implementador teve uma falha de tempo em scripts/redact-probes.test.mjs (sonda de tempo da PMK-197 instável sob carga): follow-up. Revisor ciclo 2 (opus) iniciado.
- PMK-204 ciclo 2 (opus): APROVADO, em conflito; pedi rebase. Não bloqueantes: piso vira low quando há tantas issues com demanda quanto prioridades e rebaixa o backlog; piso não recalculado depois de aceite parcial ou edição; about:issue de issue ilegível vira só aviso; caminho de comentários não aplica o critério 1; oráculo do .1 lê o frontmatter.
- PMK-204: rebase 907ba8f (só CHANGELOG), cabeçalho do cenário cita o .6. Mergeado (6db471e).
- PMK-205 ciclo 2 (opus): APROVADO, em conflito; pedi rebase com empty+ready false de cancelada com PR aberto e o CHANGELOG do --release no Linear. Não bloqueantes restantes: escada de escolha duplicada (pmkit.mjs:2068/2074); legibilidade de tolerant; cycles_absent sem tradução no arquivo de comando.
- PMK-205: rebase f5f168d com empty falso enquanto há trabalho aberto e CHANGELOG sem --release no Linear; diff pós-aprovação conferido. Mergeado (6051adf).

Fim da rodada 10: PRs #162, #163, #164 mergeados.

Limpeza da rodada 10: closing PR #165 mergeado (18f1c33), 9 worktrees removidos, branches provisórias apagadas.

## Rodada 11

Início: 2026-11-09. `develop` em 18f1c33, `npm test` com 4293 testes, 4212 pass, 0 fail, 81 skipped, saída 0. Run Orca `run_69df1f7e2548`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-207 | 2 | sonnet (`ctx_72ccb1e75fd6`) | #166 | ciclo 1 (sonnet): APROVADO; duas correções antes do merge | mergeado (be7d8d7) |
| PMK-209 | 3 | sonnet (`ctx_489feffc0f97`) | #167 | ciclo 1 (opus): mudanças pedidas; ciclo 2 (opus): APROVADO; docs antes do merge | mergeado (2f4e6eb) |
| PMK-214 | 5 | opus (`ctx_8b19b322b473`) | #168 | ciclo 1 (opus): mudanças pedidas; ciclo 2 (opus): APROVADO; três correções antes do merge | mergeado (9a40228) |

- PMK-207: PR #166 (sonnet); passo 5.1 do request-queue descarta só o request cujo dry run de create falhou e diz o motivo; passo 4 mantém o ID do cliente sem arquivo; dois cenários novos (Linear até a sugestão de triage; create falho com cliente desconhecido). Follow-up: checagem de que a regra de 5.1 existe no md. Revisor ciclo 1 (sonnet) iniciado.
- PMK-207 ciclo 1 (sonnet): APROVADO; pedi antes do merge: 5.1 só para erro do próprio request (erro global para), frase de nada mudaria quando tudo caiu no dry run, cenário sem depender de empate. Não bloqueantes restantes: 5.3 sem regra de falha (pré-existente); cenário não prova a frase do passo 4; CHANGELOG ambíguo.
- PMK-207: eea09aa com 5.1 só para erro do próprio request, mensagem sem nada mudaria quando tudo caiu, cenário sem empate; diff conferido. Mergeado (be7d8d7). Último bug da lista: os 31 bugs estão mergeados.
- PMK-209: PR #167 (sonnet); status de deploy numa chamada GraphQL com fallback para unknown; check que falha liga a ci logs --run; createdAt/headSha/newerRun em ci logs; tail a partir do fim do log. Follow-ups: stream de gh run view --log-failed; filtro de ref no GraphQL. Revisor ciclo 1 (opus) iniciado.
- PMK-209 ciclo 1 (opus): mudanças pedidas, 4 bloqueantes (argv do gh api sem -f, gh real recusa e tudo vira unknown; fakes com o mesmo argv errado; resposta GraphQL parcial descartada; run cancelled conta como talvez corrigido; state null em branco no release-readiness). Follow-ups: dica de cancel diferente entre pr status e pr blockers; lógica de risks duplicada.
- PMK-214: PR #168 (opus); delegação nativa no Linear com agent:<id do usuário Linear> (comentário primeiro, depois delegateId, checagens antes de qualquer escrita, erro lista o que foi escrito); delegate atômico no Local; agent:claude no fixture team; /pmkit:issues:work --as <agent>; suíte de contrato com a família agents no fake do Linear. delegateId conferido só no schema público. Follow-ups: track-agents no Linear lendo delegate; filtrar agentes por User.isAssignable; checagem live de delegateId; Local com issue.md escrito e append de events falho. Revisor ciclo 1 (opus) iniciado.
- PMK-209 correção 37a7e96: -f antes de cada ids[] (conferido no gh real), fake de gh recusa posicional sobrando; resposta parcial mantém os status que vieram; só run mais nova com sucesso marca superseded; release-readiness mostra unknown e avisa; url só logUrl; frase velha do investigate-bug.md removida. Revisor ciclo 2 (opus) iniciado.
- PMK-214 ciclo 1 (opus): mudanças pedidas, 3 bloqueantes (falha do append de events deixa issue atribuída sem registro e erro UNEXPECTED; issueUpdate sem confirmação vira missing sem reler e o retry duplica o comentário; work.md manda --as no Linear, que recusa). Schema do Linear conferido pelo revisor. Follow-ups: redelegar ao mesmo agente sem confirmar reinício de sessão; código de comentário duplicado.
- PMK-209 ciclo 2 (opus): APROVADO (forma da resposta parcial conferida no gh real); pedi antes do merge os docs com a regra nova de run mais nova (README:172, investigate-bug.md:24, CHANGELOG:5). Não bloqueantes restantes: erro de campo em latestStatus vira pending; RATE_LIMITED do GraphQL derruba a lista; dica de pr status só para fail; fake de gh sem -X/--jq.
- PMK-209: df78a26 com docs da regra nova e um helper para o aviso de unknown; diff conferido. Mergeado (2f4e6eb).
- PMK-209 mergeado acima. PMK-214 correção 9c57824: Local desfaz issue.md e o comentário quando o append falha (CONFLICT nothing was changed); Linear relê o issueUpdate sem confirmação e nomeia o comentário postado; work.md sem --as no Linear (mantém a ADR-0005); não bloqueantes baratos. Revisor ciclo 2 (opus) iniciado.
- PMK-214 ciclo 2 (opus): APROVADO; pedi antes do merge: leitura falha depois de update confirmado não vira missing delegate (history-ops.mjs:189); mensagem de events intacto falsa com eventos de drift (tracker.mjs:536); rmSync dentro do try (:547).
- PMK-214: 9c69536 com update confirmado como sucesso, rollback que devolve também events.jsonl e passos de rollback independentes; diff conferido. Mergeado (9a40228).

Fim da rodada 11: PRs #166, #167, #168 mergeados.

Limpeza da rodada 11: closing PR #169 mergeado (a1371fb), 8 worktrees removidos, branches provisórias apagadas.

## Rodada 12

Início: 2026-11-09. `develop` em a1371fb, `npm test` com 4330 testes, 4250 pass, 0 fail, 80 skipped, saída 0. Run Orca `run_8337d34b0804`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-218 | 5 | opus (`ctx_56f4257a5d35`) | #172 | ciclo 1 (opus): mudanças pedidas; ciclo 2 (opus): APROVADO | mergeado (2ed1da2) |
| PMK-225 | 5 | opus (`ctx_9a3a7a758719`) | #171 | ciclo 1 (opus): mudanças pedidas; ciclo 2 (opus): APROVADO; rebase 60a2555 | mergeado (8ed6acd) |
| PMK-229 | 3 | sonnet (`ctx_0a6d123cbd20`) | #170 | ciclos 1 e 2 (opus): mudanças pedidas (injeção de shell no ciclo 2); ciclo 3 (opus): APROVADO; duas correções antes do merge | mergeado (970ddad) |

- PMK-229: PR #170 (sonnet); issues comment --redact (redação na CLI, linha de contagem, redacted no JSON); passo 7 do investigate-bug lê o código na branch da issue e o passo 10 usa --redact; cenários sem branch e git_host none. Follow-ups: --redact em outras escritas de texto livre; cenário do Linear; fallback do passo 7 só com origin/<branch>. Revisor ciclo 1 (opus) iniciado.
- PMK-229 ciclo 1 (opus): mudanças pedidas (git grep com a ref no lugar do padrão). --redact conferido sem vazamento. Pedi junto: ref completa; validar o nome da branch (validBranch da PMK-192) antes do shell nos passos 3, 4, 6 e 7; cenário noHost; preâmbulo. Follow-up: ref local defasada do headSha do CI.
- PMK-229 correção 3b107c7: git grep <padrão> <ref>; refs completas; passo 2 valida a branch pela regra de validBranch (inválida = sem branch), aspas nos passos 3, 4, 6 e 7, cenário com x$(id); noHost corrigido; testes de --redact no Linear e só segredo. Revisor ciclo 2 (opus) iniciado.
- PMK-225: PR #171 (opus); inbox indexado pelo remote do git; escritas no store do usuário com trava e merge; inbox list com mudanças de status e --reviews/--login (uma chamada gh, null e not verified na falha); colunas Text e Seen; Linear serve user_inbox por Notification; corte de 14 dias por tipo. Follow-ups: conferir os documentos de Notification ao vivo; recusar --login sem --reviews; texto do mark-read no Linear; inbox-digest usar status e --reviews (PMK-236). Revisor ciclo 1 (opus) iniciado.
- PMK-229 ciclo 2 (opus): mudanças pedidas, 2 bloqueantes de injeção de shell no passo 7 (git grep sem -e executa -O<cmd>; aspas duplas expandem $(...) em padrão e caminho vindos do log). Validação do nome da branch só no texto, não na CLI: issues update --branch aceita x$(id) (follow-up). Pedi regra de citação em conventions.md e teste no plugin.test.mjs.
- PMK-225 ciclo 1 (opus): mudanças pedidas, 2 bloqueantes (migração para o arquivo por remote perde as chaves vistas de outros worktrees; mark-read --key em entrada antiga marca kinds sem pendência e solta as mudanças de status antigas). Documentos GraphQL conferidos no schema público. Pedi junto: --reviews sem --login no Linear; mensagem da trava; mark-read --key com mais de 1000 notificações; null: UPSTREAM.
- PMK-229 correção e9e8c4d: texto de busca por arquivo com git grep -F -f; caminhos entre aspas simples com escape; regra Text from data in a command em conventions.md; teste no plugin.test.mjs; diff local também em NOT_CONFIGURED/AUTH. Follow-ups: recusar x$(id) em issues update --branch e no branchName do Linear; citar --environment no passo 5. Revisor ciclo 3 (opus) iniciado.
- PMK-218: PR #172 (opus); pr blockers lê rulesets (rules/branches, paginado) junto da proteção clássica; prThreads pagina por endCursor sem corpos; reviews e merge state numa leitura de gh pr view; pr status devolve blockers; /pmkit:issues:mine mostra o veredito. Follow-ups: avaliar outros tipos de regra de ruleset; opt-out das 3 leituras a mais por PR; base com barra contra o GitHub real; require_code_owner_review e require_last_push_approval. Revisor ciclo 1 (opus) iniciado.
- PMK-225 correção fbcebe3: migração junta os arquivos por caminho de todos os worktrees do remote (registrado em migrated); entrada sem kinds conta como vistas as mudanças até o último check (decisão do implementador, aceita); --reviews no Linear sem --login dá not verified; mensagem da trava; mark-read --key no Linear marca por id; guard de toplevel do monorepo. Revisor ciclo 2 (opus) iniciado.
- PMK-229 ciclo 3 (opus): APROVADO (reproduções de injeção refeitas, nenhuma executou). Pedi antes do merge: /\s+$/ quadrático em pmkit.mjs:619 (14 s em 50k espaços) e o cenário noHost com nomes curtos. Follow-ups: --environment sem aspas no passo 5; teste de guarda só pega aspas duplas; entrada do gh ausente sem receita do diff local.
- PMK-218 ciclo 1 (opus): mudanças pedidas (pr status com 5+ leituras por PR: falha transitória numa leitura de bloqueio derruba o comando e mine/standup/investigate-bug não tratam). Base com barra conferida na API real. Pedi junto: read:org ausente, policies duplicado, ruleText com deletion/non_fast_forward, 404 de rulesets em GHES, inbox-digest.md:35.
- PMK-229: 2cddf9f com trimEnd no lugar de /\s+$/ e o cenário noHost alinhado; diff conferido. Mergeado (970ddad).
- PMK-225 ciclo 2 (opus): APROVADO (migração conferida com dois clones), em conflito; pedi rebase com a entrada válida de outro membro preservada e --login sem --reviews recusado. Follow-ups: mudar a URL do origin abandona o arquivo por remote; itens status no digest (PMK-236).
- PMK-225: rebase 60a2555 com a entrada válida de outro membro preservada e --login sem --reviews recusado. Mergeado (8ed6acd).
- PMK-218 correção 4960886: falha transitória de leitura de bloqueio mantém PR e checks com blockers not verified; mine/standup/investigate-bug param pr status depois de RATE_LIMITED; 403 na leitura de detalhe tenta sem reviewRequests; ruleText sem creation/deletion/non_fast_forward; 404 de rules com proteção lida = sem rulesets; track-agents cacheia recusa por base; rebase sobre 8ed6acd. Revisor ciclo 2 (opus) iniciado.
- PMK-218 ciclo 2 (opus): APROVADO. Não bloqueantes: blocked null por reviewRequests ilegíveis mesmo com policiesKnown (pr-blockers.mjs:99/202); texto contraditório entre blocking e policies com a proteção recusada (:166/222); contagem de aprovações sem dizer que é mínima com a proteção não lida (:135); retry em qualquer 403 culpando read:org (host.mjs:120); custo das leituras de blockers em standup/investigate-bug (pmkit.mjs:1497). Mergeado (2ed1da2).

Fim da rodada 12: PRs #170, #171, #172 mergeados.

Limpeza da rodada 12: closing PR #173 mergeado (fd7ca15), 10 worktrees removidos, branches provisórias apagadas.

## Rodada 13

Início: 2026-11-09. `develop` em fd7ca15, `npm test` com 4392 testes, 4312 pass, 0 fail, 80 skipped, saída 0. Run Orca `run_d46957912cdf`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-234 | 2 | sonnet (`ctx_d36700614aba`) | #174 | ciclo 1 (sonnet): APROVADO | mergeado (6122933) |
| PMK-208 | 5 | opus (`ctx_b073a0e75ad6`) | #176 | ciclo 1 (opus): mudanças pedidas; ciclo 2 (opus): APROVADO; uma correção antes do merge | mergeado (e365d50) |
| PMK-210 | 3 | sonnet (`ctx_15a533c6e6df`) | #175 | ciclo 1 (opus): mudanças pedidas; ciclo 2 (opus): APROVADO; rebase d9942e9 | mergeado (e02ab0c) |

- PMK-234: PR #174 (sonnet); passo 8 do prioritize-by-demand refaz os dry runs do passo 6 e não escreve nada se um before mudou ou um recheck falhou (volta ao passo 2); palavra rank-only mostra o ranking e para; cenários .7 e .8; sem mudança na CLI. Follow-ups: compare-and-set (--expect-updated) em issues update; filtro por ID em issues bulk para usar --expect. Revisor ciclo 1 (sonnet) iniciado.
- PMK-210: PR #175 (sonnet); Linear serve listDocuments (documentos de projetos do time como {path,title}, ordenados, UPSTREAM no teto de páginas em vez de lista parcial); manifesto, suíte de contrato, tabela da spec de design, CHANGELOG e README. Follow-ups: documentos de iniciativas/times/issues no Linear; rodar a sonda live com chave; listMilestones/listDeliverables ignoram hasMore no teto. Revisor ciclo 1 (opus) iniciado.
- PMK-210 ciclo 1 (opus): mudanças pedidas (DOCUMENTS_QUERY sem filtro: teto vale para o workspace inteiro; próximo passo inútil). Query válida no schema público; UPSTREAM no teto aceito. Pedi filtro no servidor por projeto do time e os não bloqueantes baratos. Conferência ao vivo pendente (sem chave).
- PMK-234 ciclo 1 (sonnet): APROVADO. Não bloqueantes (texto do arquivo de comando): regra rank-only no fim do passo 5; rank-only com todos os scores 0 pode não mostrar a tabela; reinício cita só priority/status mas compara updated; sem cenário para a reconferência que falha. Mergeado (6122933).
- PMK-210 correção b8437e2: filtro no servidor por accessibleTeams do projeto (sem leitura de projetos separada); erro no teto aponta para pmkit epic get; texto path e title; teste de nomes de operação; fake com documento sem projeto. Conferência ao vivo pendente. Revisor ciclo 2 (opus) iniciado.
- PMK-208: PR #176 (opus); alerts list e alerts scan leem yarn audit (classic), pnpm audit, pip-audit (requirements.txt) e cargo audit além do npm audit; --report scanner=arquivo offline; severidade nova unknown com prioridade null; scanner detectado sem relatório com --report é pulado com aviso, sem deixar incompleto (decisão a julgar). Follow-ups: Yarn Berry; pip-audit em pyproject.toml; CVSS 4; unknown do npm como unknown; cenário do create do security-alerts com --report (PMK-230). Revisor ciclo 1 (opus) iniciado.
- PMK-210 ciclo 2 (opus): APROVADO (filtro conferido no schema público). Pedi rebase com a spec atualizada, campo não usado removido e o caso de lista da suíte de contrato. Follow-ups: sem scope.team o filtro lista todos os times (como listDeliverables e listMilestones); teto permanente sai como UPSTREAM e epic get mostra só 50 documentos; conferência ao vivo com client-live.mjs.
- PMK-208 ciclo 1 (opus): mudanças pedidas (scanner detectado sem relatório com --report vira no alerts, regra da rodada 7; unknown abaixo de low no grupo rebaixa e pula a pergunta de prioridade). Consumidores do unknown, parsers contra formatos documentados e .cmd no Windows conferidos.
- PMK-210: rebase d9942e9 com spec atualizada, campo não usado removido e caso de lista da suíte de contrato com documentos semeados. Mergeado (e02ab0c).
- PMK-208 correção 240d65c: scanner detectado não lido com --report deixa alerts list e alerts scan incompletos; unknown no grupo deixa o pacote unknown salvo quando outra advisory é critical; pip-audit e cargo audit com 5 min; dedup por id; stderr do yarn; relatório vazio dá INVALID_INPUT; rebase em e02ab0c. Revisor ciclo 2 (opus) iniciado.
- PMK-208 ciclo 2 (opus): APROVADO; pedi antes do merge cvssScore sem chaves do protótipo (NaN vira low). Follow-ups: qualquer skip_reason do pip-audit deixa o scan inteiro incompleto; high+unknown vira unknown e ordena depois de low; UTF-16 BE; refactor de parseNpmAudit.
- PMK-208: b24907b com cvssScore por Map e Object.hasOwn, score não finito dá unknown. Mergeado (e365d50).

Fim da rodada 13: PRs #174, #175, #176 mergeados.

Limpeza da rodada 13: closing PR #177 mergeado (6b9bb8e), 8 worktrees removidos, branches provisórias apagadas.

## Rodada 14

Início: 2026-11-10. `develop` em 6b9bb8e, `npm test` com 4449 testes, 4363 pass, 0 fail, 86 skipped, saída 0. Run Orca `run_1603bd212b66`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-211 | 3 | sonnet (`ctx_ce87634a2ec5`) | #178 | ciclos 1 e 2 (opus): mudanças pedidas; textos e eventInstant conferidos pelo orquestrador | mergeado (d44c4fe) |
| PMK-212 | 5 | opus (`ctx_f599f6914c18`) | #179 | ciclo 1 (opus): mudanças pedidas; ciclo 2 (opus): APROVADO; duas correções antes do merge | mergeado (c94edc3) |
| PMK-213 | 5 | opus (`ctx_af8f93dcb293`) | #180 | ciclos 1 e 2 (opus): mudanças pedidas; ciclo 3 (opus): APROVADO, rebase com 17 conflitos conferido | mergeado (6828ca7) |

- PMK-211: PR #178 (sonnet); isPositiveMinutes compartilhado; checagem de ignorados na suíte de contrato; tempo legível 1h30; totais por pessoa e por sprint (sprint pela data UTC dentro de start..end, senão no sprint; sprints ilegíveis dão sprintsUnread e nota); progress.md lê time-entries. Follow-ups: filtro por sprint; relatório de tempo do sprint; log-time em texto ainda só em minutos. Revisor ciclo 1 (opus) iniciado.
- PMK-211 ciclo 1 (opus): mudanças pedidas, 2 bloqueantes em sprintOf (at numérico derruba com UNEXPECTED; at com fuso cai no dia local). Pedi junto: sprint ruim não descarta todos; sem leitura de sprints sem entradas.
- PMK-211 correção e69faa5: sprintOf com eventInstant e data UTC (at numérico vai para no sprint); sprint ruim só marca sprintsUnread; sprints lidos só com entradas. Revisor ciclo 2 (opus) iniciado.
- PMK-211 ciclo 2 (opus): mudanças pedidas, texto da nota de sprintsUnread e de progress.md contradiz o comportamento novo. Não bloqueantes: catch que engole EACCES/ENOTDIR; cópia de readSprints; by ausente; ordem de bySprint. Vou conferir a correção sem ciclo 3.
- PMK-211 c2fe4ac: notas conferidas. eventInstant novo dá NaN para data com espaço e fuso (2026-01-01 10:00+05:00 e ...Z), que antes funcionava; pedi a correção de uma linha.
- PMK-212: PR #179 (opus); views delete/rename no Local; validate checa views (checked.views); views run com --limit/--sort; custom views do Linear servidas por views list/run (save/delete/rename NOT_SUPPORTED); issues bulk --view recusa view do Linear; lista cortada do Linear dá NOT_FOUND view_list_incomplete. Follow-ups: escrever views do Linear; checagem live de custom_views; auto_commit com arquivo de view não rastreado. Revisor ciclo 1 (opus) iniciado.
- PMK-212: o primeiro start do revisor (ctx_91963b64b57a) ficou com o composer vazio; worker-abandon, task-update ready e worker-start no mesmo terminal (aprovação permanente): `ctx_3a0d030e0f7f`, rodando.
- PMK-213: PR #180 (opus); goal_prefix; goal status (5 status de initiative do Linear; sem status = active; owner fora); goal update/close/delete (delete recusa com épico ligado ou épico ilegível); leituras de initiatives no Linear Business/Enterprise; goal progress com avisos e complete; validate checked.goals. Follow-ups: owner da meta; escritas de metas no Linear; goals overview ler initiatives uma vez e tratar completed/canceled (PMK-233); provar PmkitInitiatives ao vivo. Revisor ciclo 1 (opus) iniciado.
- Follow-up prioritário: scripts/redact-probes.test.mjs:297 e :310 limitam cada entrada a 1000 ms; sob carga já deu 1009 ms duas vezes (PMK-205, PMK-213). Subir o limite deixaria passar o quadrático antigo (1,7 s em 320k); o certo é comparar o tempo de n e 2n (razão).
- PMK-211: 4792245 com eventInstant que só põe Z sem fuso (conferido: espaço com e sem fuso, T, só data; número dá NaN como em develop). Mergeado (d44c4fe).
- PMK-212 ciclo 1 (opus): mudanças pedidas, 3 bloqueantes (delete/rename de view não rastreada com auto_commit sai 2; rename só de caixa no macOS sem commit; CUSTOM_VIEW_ISSUES_QUERY sem sort corta as issues erradas). CustomView conferido no schema. O npm test do revisor saiu 1 com 3 falhas que ele diz existirem também em develop (sandbox.test:748, degraded-live.test:12, tracker-delete.test:193): vou conferir em develop.
- Conferi develop (d44c4fe) no tree principal: npm test 4456 testes, 0 fail, saída 0. As 3 falhas do revisor da PMK-212 não reproduzem; carga ~40 no momento. Se voltarem, vira follow-up de testes sensíveis a carga.
- PMK-213 ciclo 1 (opus): mudanças pedidas, 3 bloqueantes (épico com outro prefixo pulado sem problem: goal delete apaga meta ligada; projeto antigo com prefixo GOAL quebra no validate e em toda escrita; goals overview descarta avisos e sai complete no Linear). Initiatives conferidas no schema. Pedi junto: REQ/CUS recusados como goal_prefix; checked.goals sem README.md.
- PMK-212 correção 09d8b19: auto_commit só commita caminhos removidos que o git rastreia (git rm --cached) e add nos presentes; rename só de caixa recusado com o rename em dois passos como próximo passo; CustomView.issues com sort createdAt Ascending e fake que respeita o sort; nome achado uma vez numa lista cortada pede o id; bulk --view recusa antes de ler; rebase. Revisor ciclo 2 (opus) iniciado, com atenção ao commitTracker compartilhado.
- PMK-213 correção 036bbef: pasta de épico com nome que não é id vira problem (goal delete recusa); goal_prefix fora de DEFAULTS e só checado quando definido; goals overview carrega os avisos de cada meta; checked.goals sem README.md; epicsMore fora do JSON; rebase. Revisor ciclo 2 (opus) iniciado.
- PMK-212 ciclo 2 (opus): APROVADO (auto_commit dos outros comandos conferido); pedi antes do merge: view do Linear depois do corte rodar pelo id; --limit passado ao Linear. Follow-ups: validate só pega filter {}; eficiência do onDisk; duplicação runView/searchIssues; scope.team ausente; views de workspace.
- PMK-212: 00ba610 com leitura direta de view do Linear pelo id (PmkitCustomView, mesmos campos conferidos) e --limit passado ao Linear; diff conferido. Mergeado (c94edc3).
- PMK-213 ciclo 2 (opus): mudanças pedidas (com goal_prefix definido, metas GOAL antigas viram problems e goals overview cai no fallback com complete true). O PR conflita em 17 arquivos com develop depois da PMK-212; pedi a correção e o rebase juntos. Follow-ups: isId sem escape com prefixo como G( (já em develop com epic_prefix); recordOf deduplica pelo texto; RESERVED_PREFIXES é cópia.
- PMK-213 correção fc895ed: meta com nome de id de outro prefixo vira problem kind goal (overview incompleto e avisa); goal delete sem does not parse; goal get com complete e warnings; rebase sobre c94edc3 com 17 conflitos resolvidos mantendo os dois lados. Revisor ciclo 3 (opus) iniciado, com atenção à resolução dos conflitos.
- PMK-213 ciclo 3 (opus): APROVADO; rebase não perdeu nada da PMK-212. Não bloqueantes: ID_SHAPE aceita minúsculas (my-notes.md em goals/ vira meta ilegível); goal get mostra INCOMPLETE_LINE sobre números que não exibe e faz listGoals extra; goal-ops.mjs:82 copia o status de toEpic. Mergeado (6828ca7).

Fim da rodada 14: PRs #178, #179, #180 mergeados.

Limpeza da rodada 14: closing PR #181 mergeado (c7715af), 10 worktrees removidos, branches provisórias apagadas.

## Rodada 15

Início: 2026-11-10. `develop` em c7715af, `npm test` com 4535 testes, 4448 pass, 0 fail, 87 skipped, saída 0. Run Orca `run_0790a1f2c1eb`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-215 | 2 | sonnet (`ctx_ab1de30d5356`) | #182 | ciclo 1 (sonnet): mudanças pedidas; ciclo 2 (sonnet): APROVADO | mergeado (3ff9e0e) |
| PMK-216 | 3 | sonnet (`ctx_be20ed87f690`) | #184 | ciclos 1 e 2 (opus): mudanças pedidas; saída conferida pelo orquestrador | mergeado (574df52) |
| PMK-217 | 5 | opus (`ctx_2168c85b8df8`) | #183 | ciclo 1 (opus): mudanças pedidas; ciclo 2 (opus): APROVADO | mergeado (a59ca40) |

- PMK-215: PR #182 (sonnet); track-agents no Linear lista PRs abertos de autores bot (casados por branch, fonte pull_requests) e filtro --agent; sem git host ou sem agente fica NOT_SUPPORTED. Follow-ups: mapa de agente do Linear para login do GitHub; ler delegates do Linear; golden de --agent. Revisor ciclo 1 (sonnet) iniciado, com pergunta sobre o delegate da PMK-214.
- PMK-215 ciclo 1 (sonnet): mudanças pedidas (dependabot/renovate contam como agentes e gastam até 200 leituras; holder nulo dá stale). Autor bot aceito como caminho esperado; ler o delegate fica de follow-up.
- PMK-215 correção 2afc1c2: bots de dependência excluídos; detalhe só de PRs que casam por branch; delegate ausente dá unknown; hasMore no corte; --agent agent:<id> no Linear dá INVALID_INPUT. Follow-ups: done/canceled contam como sem match; branches duplicadas; laço de leitura duplicado. Revisor ciclo 2 (sonnet) iniciado.
- PMK-215 ciclo 2 (sonnet): APROVADO. Não bloqueantes: issue done/canceled aparece como sem issue; --agent app/claude ou claude[bot] não casa; incomplete por comentários com startsWith frágil; lista fixa de bots. Mergeado (3ff9e0e).
- PMK-215 mergeado acima. PMK-217: PR #183 (opus); pr review (review só de comentários com comentários inline checados contra o diff antes da escrita); pr diff files/--file para ler diff cortado por arquivo; review.md lê pr status e ci logs e trata check falhando como lacuna. Follow-ups: caminhos não ASCII citados pelo git; pr review --redact; validBranch no review.md; harness de cenário mostra confirm recusado como confirmado. Revisor ciclo 1 (opus) iniciado.
- PMK-216: PR #184 (sonnet); leitura nova issues similar (TF-IDF em scripts/lib/similar.mjs, complete/hasMore); estimate.md passo 5 usa; cenário do Linear sem campo de estimativa. Follow-ups: PMK-237 usar rankSimilar; ajuste de stemming e stop-list; issues similar no Linear limitado a 1000; runner de cenários do Linear ignora input. Revisor ciclo 1 (opus) iniciado.
- PMK-217 ciclo 1 (opus): mudanças pedidas (sectionPath mantém TAB e citação do git em caminhos com espaço/não ASCII; review.md com branch e caminho sem validação nem aspas). Pedi junto S1-S4.
- PMK-216 ciclo 1 (opus): mudanças pedidas (alvo sem tokens dá similar vazio com complete true; stdout incompleto sem not verified). Custo linear conferido (1000 issues em 49 ms).
- PMK-216 correção bfd7ae1: alvo sem tokens dá no_comparable_text e complete false; stdout incompleto diz not verified; --category vazio dá INVALID_INPUT; hits sem estimativa em lista separada; desempate com compareIds; rebase. Revisor ciclo 2 (opus) iniciado.
- PMK-217 correção f408c34: caminhos sem TAB final e sem citação do git; review.md valida a branch e a põe entre aspas duplas; pr diff mantém o PR com diff grande; cancel é lacuna; commit_id no review; pr review --redact; rebase. Follow-up de segurança: inbox-digest, mine, unblock, work e standup ainda põem <branch> sem aspas em comandos (exceções no plugin test). Revisor ciclo 2 (opus) iniciado.
- PMK-216 ciclo 2 (opus): mudanças pedidas (stdout incompleto com tabela sem not verified). Pedi junto o texto de no_comparable_text, teste em fixture completo e README sobre unestimated. Follow-ups: stop words antes do stem; score arredondado pode dar 0; Linear lê as 1000 mais antigas; avisos duplicados; escopo de time e arquivadas. Vou conferir sem ciclo 3.
- PMK-217 ciclo 2 (opus): APROVADO (validBranch recusa $, crase, aspas e barra invertida; caminho com aspas simples). Não bloqueantes: commit_id fixa o head lido pelo pr review e não o do diff do passo 3 (review.md:39 afirma demais); comentário invertido em pmkit.mjs:1622; diff local depende de diff.mnemonicPrefix/noprefix; frase de validBranch solta no passo 2. Mergeado (a59ca40).
- PMK-216: 5f69d04 conferido rodando issues similar ISS-4M2S numa cópia do fixture team: tabela e linha not verified, complete false. Mergeado (574df52).

Fim da rodada 15: PRs #182, #183, #184 mergeados.
