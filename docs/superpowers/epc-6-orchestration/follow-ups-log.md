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
