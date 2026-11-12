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
| 19 | PMK-248, PMK-249, PMK-250 (follow-ups da rodada 18, a pedido do usuário) |
| 20 | PMK-247, PMK-246 |
| 21 | PMK-251, PMK-252 |
| 22 | PMK-230, PMK-232, PMK-233 |
| 23 | PMK-231, PMK-235, PMK-236 |

As rodadas 19 a 21 levam os follow-ups da rodada 18 (PMK-246 a PMK-252) e separam as issues de ADR (PMK-247, PMK-248, PMK-251) e as do adapter Linear (PMK-246, PMK-249, PMK-252), que mexem nos mesmos arquivos. As antigas rodadas 19 e 20 viraram 22 e 23.
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

Limpeza da rodada 15: closing PR #185 mergeado (632e339), 9 worktrees removidos, branches provisórias apagadas.

## Rodada 16

Início: 2026-11-10. `develop` em 632e339, `npm test` com 4605 testes, 4518 pass, 0 fail, 87 skipped, saída 0. Run Orca `run_ce1d17032828`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-219 | 5 | opus (`ctx_3bf076636880`) | #186 | ciclos 1 e 2 (opus): mudanças pedidas; correção conferida pelo orquestrador com todos scan | mergeado (1327c3d) |
| PMK-220 | 3 | sonnet (`ctx_4d8f3057deb6`) | #188 | ciclo 1 (opus): mudanças pedidas; correção conferida pelo orquestrador | mergeado (44c198a) |
| PMK-221 | 5 | opus (`ctx_f4e90820ab49`) | #187 | ciclos 1 e 2 (opus): mudanças pedidas; B6 conferido pelo orquestrador | mergeado (7c64a20) |

- PMK-219: PR #186 (opus); tags HACK, XXX e @todo; <script>/<style>; docstrings Python; comentário depois de aspa solta; tipos sem comentário fora do aviso (até 10 tipos); XXX/FIXME = bug, TODO/HACK = task; json como C-like; O(n²) em markupLines corrigido na auto-revisão. Follow-ups: cenário com # TODO em .mjs; duas apóstrofes na linha; script text/x-template; docstrings de outras linguagens. O worker parou num prompt de segurança do rm no próprio scratchpad, que bloqueou sozinho. Revisor ciclo 1 (opus) iniciado.
- PMK-221: PR #187 (opus); customers update e requests update (updateCustomer, updateRequest); requests accept --create (CONFLICT em request aceito; accept que falha depois do create nomeia os dois IDs); customers show --customer; no Linear com customers ligado, demand_signals nativo e customers list/show/create/update, requests create e demand list; leituras cortadas como INCOMPLETE. Follow-ups: Asks do Linear; requests update no Linear; request-queue usar --create; provar customerCreate/customerNeeds ao vivo. Revisor ciclo 1 (opus) iniciado.
- PMK-221: primeiro start do revisor (ctx_5ebe114a3b1f) com composer vazio; abandon, ready e worker-start no mesmo terminal (aprovação permanente).
- PMK-220: PR #188 (sonnet); defaults.overload_factor (1 ou mais); colunas Delivered e Blocked; bloqueadas nunca propostas como move; uma leitura em team load e team capacity; Delivered com issue ilegível = ?. O worker rodou um git stash sem querer e diz ter devolvido e apagado só a própria entrada: conferi, stash vazio e tree principal limpo. Follow-ups: fator no Linear sem chave de config; leitura de bloqueadores em lote; ISS-3Q6T do fixture team esconde Delivered nos goldens. Revisor ciclo 1 (opus) iniciado.
- PMK-221 ciclo 1 (opus): mudanças pedidas, 5 bloqueantes (erro errno no accept depois do create perde os dois IDs; retry de accept --create cria segunda issue; Customer.needs sem argumentos no schema e o fake esconde; requests update --body-file diz no change; find do Linear não passa dos 250). O npm test do revisor saiu 1 com 3 falhas que ele diz existirem em develop; o baseline da rodada em develop deu 0: são os testes sensíveis a carga já registrados (follow-up).
- PMK-220 ciclo 1 (opus): mudanças pedidas (done arquivada some do Delivered). Pontos de atenção passaram. Pedi junto: team capacity sem avisos de bloqueador; releitura do manifesto; teste de overload_factor 1. Vou conferir sem ciclo 2.
- PMK-220: 2c1dc76 com archived: true nas done do sprint, team capacity sem leitura de bloqueadores, manifesto reusado, teste de fator 1; diff conferido. Mergeado (44c198a).
- PMK-219 ciclo 1 (opus): mudanças pedidas, 3 bloqueantes (closesOnLine quadrático: 512 KiB em 225 s; docstring copia a linha a cada aspa tripla; ELEMENT toma <script/> autofechado e <script> em comentário e é quadrático sem fecho). Pedi testes de tempo por razão n/2n.
- PMK-221 correção 6f25e48: erro do accept mantém os dois ids e o commit parcial; retry recusa por issue com Request: <id> e busca incompleta recusa; customerNeeds filtrado por cliente e fake recusa needs(first:); requests update diz changed; customer(id) além dos 250; size Int; aspas em linear/customers.md; rebase. Revisor ciclo 2 (opus) iniciado, com pergunta sobre a recusa ampla do B2.
- PMK-219 correção da42bc1: quoteEnd com cache (512 KiB em 54 ms); docstring sem cópia (256 KiB em 29 ms); markupLines numa passada, pula <script/> autofechado, comentário HTML e elemento sem fecho; testes de tempo n contra 4n; strings em CSS; docstrings r/u/b/f; script com type não JS é marcação; # só no começo em .gitignore; cenário com //; rebase. Revisor ciclo 2 (opus) iniciado.
- PMK-221 ciclo 2 (opus): mudanças pedidas, B6 (qualquer issue ilegível recusa accept --create, até na primeira tentativa). customerNeeds filtrado conferido no schema. Pedi marca de tentativa no pedido e busca estrita só no retry. Follow-ups: M4/M7 mensagens do updateCustomer no Linear; M9 eficiência.
- PMK-219 ciclo 2 (opus): mudanças pedidas, 1 bloqueante (.xml lê <style>/<script> como CSS/JS e perde TODOs de styles.xml do Android e de scripts do Ant). Tempos conferidos: 21 ms, 10 ms, 8-9 ms. Pedi junto teste de tempo com 128 KiB, <style-guide>, docstring com aspas escapadas, CMakeLists.txt/requirements.txt. Vou conferir sem ciclo 3.
- PMK-219: 24f7ec6 conferido com todos scan num repo temporário: TODO do styles.xml do Android, FIXME do script do Ant, TODO do CMakeLists.txt e nota dentro de <style-guide>, todos achados. Mergeado (1327c3d).
- PMK-221: 225427f com issue ilegível como aviso (leitura cortada ainda recusa; o retry acha a issue que o pmkit escreveu); M6 e M8; diff conferido. Mergeado (7c64a20).

Fim da rodada 16: PRs #186, #187, #188 mergeados.

Limpeza da rodada 16: closing PR #189 mergeado (4781f3b), 8 worktrees removidos, branches provisórias apagadas.

## Rodada 17

Início: 2026-11-10. `develop` em 4781f3b, `npm test` com 4683 testes, 4596 pass, 0 fail, 87 skipped, saída 0. Run Orca `run_91f320f7ec8d`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-222 | 5 | opus (`ctx_1bbbf79d6503`) | #192 | ciclo 1 (opus): mudanças pedidas; ciclo 2 (opus): APROVADO; duas correções antes do merge; critério 4 (live) desmarcado por decisão do usuário | mergeado (1a05940) |
| PMK-223 | 3 | sonnet (`ctx_57bb4b8ce982`) | #191 | ciclos 1 e 2 (opus): mudanças pedidas; ciclo 3 (opus): APROVADO | mergeado (03924f8) |
| PMK-224 | 3 | sonnet (`ctx_addd0c5b5bcc`) | #190 | ciclos 1 a 3 (opus): mudanças pedidas; correção final conferida pelo orquestrador (decisão do usuário) | mergeado (58604e4) |

- PMK-224: PR #190 (sonnet); capacidade recalculada quando os days-off mudam; cycle capacity current e checagem de time no Linear; sem proposta de move no caminho de escrita do team capacity. A sonda de tempo de redact-probes falhou de novo sob carga (terceira vez). Follow-ups: deriva de arredondamento depois de várias edições; opção de recalcular em cycle capacity --days-off; teste da checagem de time no Linear. Revisor ciclo 1 (opus) iniciado.
- PMK-223: PR #191 (sonnet); remotes de GitHub Enterprise e alias com --git-host github; hostOnly no JSON e --yes no arquivo de comando para pular a confirmação de mudança só de host; --recheck-team no Linear. Follow-ups: GH_HOST ou git_host.host para Enterprise sem remote; reconhecer Enterprise sem --git-host github; --recheck-team no setup. Revisor ciclo 1 (opus) iniciado.
- PMK-223: primeiro start do revisor (ctx_f64271e13db3) com composer vazio; abandon, ready e worker-start no mesmo terminal (aprovação permanente).
- PMK-223 ciclo 1 (opus): mudanças pedidas, 4 bloqueantes (texto diz que recusa broken com --recheck-team e a CLI não; --git-host github troca repo existente por remote de outro host e --yes escreve; host e repo do remote sem validação, a$(id)b.com chega à nota; --recheck-team conclui de leitura cortada). O revisor mandou o veredito pelo dispatch abandonado; parei o dispatch reiniciado para fechar.
- PMK-224 ciclo 1 (opus): mudanças pedidas, 2 bloqueantes (escrita só de days-off manda o mapa inteiro e falha com chave velha; arredondamento a partir do valor guardado deriva e 1 vira 0 para sempre). Pedi base que não muda com os days-off. Follow-ups: capacidade decimal; teams(first: 50) sem paginação; helpers duplicados. O revisor parou num prompt de segurança do rm e seguiu sozinho.
- PMK-222: PR #192 (opus); preview do delete com git grep no repo (files com path e lines, scan falho fica em unchecked); issues restore (issueUnarchive no Linear, NOT_SUPPORTED no Local com os comandos git); issues link --remove com vários alvos e parada como bulk; testes de ../, id de épico e issueDelete success:false. Critério 4 (sandbox live do Linear) aberto, sem chave. Follow-ups: rodar o live e registrar em API-VERIFICATION.md; restore do Local a partir do git; delete nomear id de épico; link com vários alvos sem --remove. Revisor ciclo 1 (opus) iniciado.
- PMK-223 correção a3dd9a2: texto alinhado à CLI; repo existente nunca trocado por remote (aviso) e hostOnly falso quando repo, branch ou host mudam; host (DNS) e owner/repo validados antes de gravar ou citar; discover cortado deixa o time não verificado; conventions.md registra a exceção do --yes; --git-host none sempre pergunta. Revisor ciclo 2 (opus) iniciado.
- PMK-223 ciclo 2: primeiro start do revisor (ctx_96523049de2d) com composer vazio; abandon, ready e worker-start no mesmo terminal (aprovação permanente).
- Decisão do usuário (PMK-222): mergear o PR #192 com o critério 4 desmarcado quando a revisão aprovar; a execução no sandbox live do Linear vira follow-up (registrar em API-VERIFICATION.md).
- PMK-223 ciclo 2 (opus): mudanças pedidas (corte de users ou labels no discover recusa --team com UPSTREAM Retry, regressão). Mandei a correção; o próximo é o ciclo 3.
- PMK-222 ciclo 1 (opus): mudanças pedidas, 2 bloqueantes (.issues inteira fora do git grep perde ADR em .issues/docs; color.ui=always faz o grep voltar vazio). Pontos de atenção OK.
- PMK-224 correção 5d546b0: capacityPatch escreve só os membros que mudam (Local e Linear); recálculo sem arredondar (9 casas), ida e volta exata; capacidade decimal como efeito. Revisor ciclo 2 (opus) iniciado, com atenção aos consumidores de capacidade decimal.
- PMK-223 correção de3a238: só corte de times ou estados deixa o time não verificado; hostOnly falso com aviso; recusa de remote inválido com a nota; yes só para link-repo.md. Revisor ciclo 3 (opus) iniciado.
- PMK-224 ciclo 2 (opus): mudanças pedidas, 2 bloqueantes (ida e volta com 9 casas falha em 398 de 3600 casos e gera over_capacity falso; cycle:plan e a suíte de contrato ainda usam os membros do workspace inteiro). Pedi guardar a base e derivar a efetiva na leitura. Linear nunca recebe a capacidade (só capacity.yaml).
- PMK-222 correção 0bef129: scan exclui só <issuesDir>/issues (lê .issues/docs, epics, sprints); git grep com --no-color e saída ilegível em unchecked; dry run do link --remove diz que nada foi escrito; from entre os alvos recusado antes; restore no Local de issue viva é INVALID_INPUT. Revisor ciclo 2 (opus) iniciado.
- PMK-223 ciclo 3 (opus): APROVADO (regressão corrigida, reprodução contra develop). Não bloqueantes: corte de labels ainda pode gerar broken falso em mappings.types (igual a develop, mas o comentário/spec/CHANGELOG dizem que não importa); --yes nunca pula a pergunta num link Enterprise (aviso deixa hostOnly false); corte só de states pula a checagem do time. Mergeado (03924f8).
- PMK-222 ciclo 2 (opus): APROVADO; pedi antes do merge o golden sem o texto do fatal do git (muda com a versão) e o restore do Linear depois de releitura falha. Follow-ups: id que nunca existiu recebe NOT_SUPPORTED; --kind inválido culpa o primeiro alvo; scan repetido no delete real; execução live (critério 4).
- PMK-224 correção 4329787: capacidade escalada derivada de capacity_base guardada (sprint e capacity.yaml); ida e volta exata em 3600 casos; carga igual não é over_capacity; cycle:plan, suíte de contrato e teamMembers só com o time; rebase. Revisor ciclo 3 (opus) iniciado, com atenção ao campo novo capacity_base no validate e na migração.
- PMK-222: 07271d6 com golden sem o fatal do git e restore do Linear com aviso depois de releitura falha; diff conferido. Mergeado (1a05940) com o critério 4 desmarcado (decisão do usuário). Follow-up: os goldens de link-repo da PMK-223 também guardam texto do fatal do git.
- PMK-224 ciclo 3 (opus): mudanças pedidas, 1 bloqueante (shown() com .toFixed numa capacidade não numérica grava e sai com exit 2). Varredura de 3600 e 36000 casos exata; capacity_base no validate, schema e migração. Três ciclos sem aprovação: o usuário escolheu corrigir e eu conferir, sem ciclo 4.
- PMK-224: a8cb7c2 conferido numa cópia do fixture team: com capacity fred: 8h, team capacity --set ana=9 sai 0, grava ana: 9 e mantém fred: 8h. Mergeado (58604e4).

Fim da rodada 17: PRs #190, #191, #192 mergeados.

Limpeza da rodada 17: closing PR #193 mergeado (9bf0239), 11 worktrees removidos, branches provisórias apagadas.

## Rodada 18

Início: 2026-11-10. `develop` em 9bf0239, `npm test` com 4775 testes, 4684 pass, 0 fail, 91 skipped, saída 0. Run Orca `run_4c99b0d03c38`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-226 | 3 | sonnet (`ctx_1f0f7b428e28`) | #195 | ciclo 1 (opus): APROVADO | mergeado (36526d5), done |
| PMK-227 | 1 | haiku (`ctx_614c28a7021b`) | #194 | ciclo 1 (sonnet): APROVADO | mergeado (034439d), done |
| PMK-228 | 5 | opus (`ctx_1ad2fe7758c2`) | #196 | ciclo 1 (opus): MUDANÇAS PEDIDAS; ciclo 2 (opus): APROVADO | mergeado (c620923), done |

- PMK-226: PERGUNTA sobre o critério 2 (milestone e release no Linear no issues bulk). Respondi opção A: milestone no Linear sim; release no Linear continua NOT_SUPPORTED (o adapter não mapeia releases), critério 2 fica desmarcado e vira follow-up mapear releases do Linear. Decisão reversível, consistente com a PMK-205.
- PMK-227: PR #194 (haiku); cenário do Linear para o caminho de comentário do log-time, sem mudar o texto do comando. Critério 2 condicional à regra 5 dos cenários, que não foi relaxada: fica desmarcado. Revisor ciclo 1 (sonnet) iniciado.
- PMK-227 ciclo 1 (sonnet): APROVADO; pedi antes do merge que o cenário confira o comentário postado e o corpo, no lugar do newEvents vazio.
- PMK-226 parou num prompt de segurança do rm no próprio scratchpad (quarta vez nos follow-ups); acrescentei a lição em lessons.md, que entra no closing PR.
- PMK-226: PR #195 (sonnet); issues bulk com due, type e archive (Local e Linear) e milestone do Linear (projectMilestoneId, valida o projeto; vale também para issues update --milestone). Critério 2 desmarcado (release no Linear). Follow-ups: mapear releases do Linear; issues create --milestone no Linear; unarchive no Local. Revisor ciclo 1 (opus) iniciado.
- PMK-227: e138907 com o cenário lendo o comentário postado no fake do Linear (falha com texto errado). Mergeado (034439d).
- PMK-226 ciclo 1 (opus): APROVADO, em conflito com develop; pedi rebase com os não bloqueantes baratos.
- PMK-226: rebase d95e689 com resolveMilestone em cache, valueError, bulk.md, teste do type e um código só; diff conferido. Mergeado (36526d5) com o critério 2 desmarcado.
- PMK-228: PR #196 (opus); validate reporta números de ADR repetidos; campo opcional docs nas issues gravado pelo record-decision; docs adr-status e /pmkit:spec:adr-status; origin/HEAD para default_branch não definido. Follow-ups: rótulo de ADR fora do repo no validate; linha Supersedes no ADR novo; docs no Linear. Revisor ciclo 1 (opus) iniciado.
- PMK-228 ciclo 1 (opus): MUDANÇAS PEDIDAS, três bloqueantes conferidos à mão: adr-status deixava dois status num ADR com `## Status` ou `**Status:**`; validate não conferia os valores de docs (`""` virava `['']`, `[{a: 1}]` virava `'[object Object]'`); `--add-doc` sem valor dava UNEXPECTED. Mandei os três ao implementador.
- PMK-228: dcc1656 e 76cf24e corrigem os três com teste, mais os não bloqueantes 4, 7, 8 e 9; 4737 pass, 0 fail. Ficaram de fora o 5 (`tracker.path: .` grava sem `auto_commit`, coerente com o next-adr da PMK-65) e o 6 (rótulo `docs/adr` repetido com o tracker fora do repo). 76cf24e devolve o relatório da PMK-8 em `.superpowers` que dcc1656 apagou.
- PMK-228 ciclo 2 (opus): APROVADO; aceitou os itens 5 e 6 e anotou dois casos de borda do adr-status (`## Status` sem linhas em branco reescrito sem mudança de status; front matter e `## Status` juntos, só o front matter muda). Mergeado (c620923).
- Moves para done: PMK-226 e PMK-227 pelo PR #197 (303c8c7), PMK-228 pelo PR #198 (fa96f79). PMK-226 e PMK-227 ficam com um critério desmarcado cada, pelas decisões acima.
- Follow-ups abertos pelo PR #199 (6011ff3): PMK-246 (mapear releases do Linear, da PMK-226), PMK-247 (pasta de ADR com o tracker no repo ou fora dele, itens 5 e 6 da PMK-228), PMK-248 (casos de borda do adr-status).

Fim da rodada 18: PRs #194, #195, #196 mergeados.

Antes da rodada 19: PMK-246 a PMK-252 criadas (PRs #199 e #201, com as epics EPC-5 e EPC-6) e atribuídas a fred (PR #202). Limpeza da rodada 18: 6 worktrees removidos, branches provisórias, de issue e de chore apagadas.

## Rodada 19

Início: 2026-11-10. `develop` em e3efad5, `npm test` com 4828 testes, 4737 pass, 0 fail, 91 skipped, saída 0. Run Orca `run_4c99b0d03c38`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-248 | 1 | sonnet (`ctx_5b4765fa1e36`) | #203 | ciclo 1 (sonnet): APROVADO | mergeado (c9089d6), done |
| PMK-249 | 1 | sonnet (`ctx_5618feb51334`) | #204 | ciclo 1 (sonnet): APROVADO; correções baratas antes do merge conferidas pelo orquestrador; rebase | mergeado (a219c83), done |
| PMK-250 | 2 | sonnet (`ctx_cf6a2a13582b`) | #205 | ciclo 1 (sonnet): MUDANÇAS PEDIDAS; ciclo 2 (sonnet): APROVADO | mergeado (5062e03), done |

- PMK-248: PR #203; setAdrStatus deixa intacto um ADR com o mesmo status (linhas em branco e caixa do `## Status`) e muda front matter e seção juntos. O worker parou de novo no prompt de segurança do rm (`"$S"/*.md` também dispara), que bloqueou sozinho; revisor iniciado antes do worker_done porque o código já estava no PR.
- PMK-248 ciclo 1 (sonnet): APROVADO. Não bloqueantes: before/after incoerente no caso unchanged, comentário YAML reescrito, terceira forma de status fora do escopo. Mergeado (c9089d6).
- PMK-249: PR #204; `issues create --milestone` no Linear com `--parent <epic>`, milestone conferido contra o projeto da epic antes da escrita, dry-run mostra. Follow-up: o ISSUE_KEYS do sandbox do Linear (`scripts/lib/linear/sandbox.mjs`) não lista `projectMilestoneId`, então o sandbox recusa milestone em update e create.
- PMK-249 ciclo 1 (sonnet): APROVADO. Pedi antes do merge as correções baratas: docs do create e do spec:import sem a exigência de `--parent <epic>`, mensagem enganosa com pai issue, código morto `LATER.milestone`. fa0302e conferido no diff; o merge deu conflito no CHANGELOG depois do #203; rebase 90d7eab (só CHANGELOG mudou no range-diff). Mergeado (a219c83).
- PMK-250: PR #205; `issues unarchive` e `issues bulk unarchive` no Local (dry-run, evento unarchive, replay); Linear responde NOT_SUPPORTED. Follow-ups: unarchive no Linear (issueUnarchive para arquivadas fora da lixeira); bulk unarchive sem critério que estreite.
- PMK-250 ciclo 1 (sonnet): MUDANÇAS PEDIDAS; bloqueante: `commands/issues/bulk.md:18` dizia que `--archived` não existe e que view com archived é recusada. Mandei corrigir com os apontamentos de issue-fields.mjs e update.md, os menores baratos e o rebase.
- PMK-250: 6dcd301 corrige os cinco pontos e faz o rebase; 4761 pass. Deixou de fora só a duplicação de archive em tracker.mjs e nos BUILDERS de bulk.mjs (estilo).
- PMK-250 ciclo 2 (sonnet): APROVADO; aceitou o item de estilo. Não bloqueantes: histórico em dobro num merge que duplique A U A U, nextStep de `--view` sem archived, ordem da checagem do Linear, hasMore antes do filtro em memória. Mergeado (5062e03).
- `pr sync` moveu PMK-248, PMK-249 e PMK-250 para done, com todos os critérios marcados.

Fim da rodada 19: PRs #203, #204, #205 mergeados.

Limpeza da rodada 19: closing PR #206 mergeado (ef8109b), 7 worktrees removidos, branches provisórias, de issue e de chore apagadas.

## Rodada 20

Início: 2026-11-10. `develop` em ef8109b, `npm test` com 4852 testes, 4761 pass, 0 fail, 91 skipped, saída 0. Run Orca `run_4c99b0d03c38`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-247 | 2 | sonnet (`ctx_7172103597b8`) | #207 | ciclo 1 (sonnet): MUDANÇAS PEDIDAS; ciclo 2 (sonnet): APROVADO | mergeado (44ecb9f), done |
| PMK-246 | 5 | opus (`ctx_5a2ffc0bbccd`) | #208 | ciclo 1 (opus): APROVADO com correções antes do merge; ciclo 2 (opus): MUDANÇAS PEDIDAS; ciclo 3 (opus): APROVADO | mergeado (2cfa32c), done com o critério 5 desmarcado (decisão do usuário) |

- PMK-246: PERGUNTA PMK-246-1 (uma issue do Linear pode estar em várias releases, de pipelines diferentes). Respondi opção A: uma release por issue; com 2 ou mais, issues get mostra releases: [ids] e update/bulk recusam. Aceitei as decisões próprias do worker (UUID como id, só pipelines do time do escopo, canceladas fora, released = completedAt, releases desligadas como na PMK-40). Opção B (uma por pipeline) fica como follow-up.
- PMK-246: PERGUNTA PMK-246-2 (ligar listReleases faria release-readiness e release-notes chamarem o filtro --release, NOT_SUPPORTED no Linear). Respondi opção A: o filtro release e release issues entram no escopo para não haver regressão.
- PMK-247: PR #207; com `tracker.path: .` a pasta de ADR é do tracker (adr-status segue auto_commit, next-adr responde tracker); tracker fora do repo rotulado `tracker:docs/adr`. Revisor ciclo 1 (sonnet) iniciado.
- PMK-247 ciclo 1 (sonnet): MUDANÇAS PEDIDAS; bloqueante: `superseded --by` gravava o rótulo `tracker:docs/adr/...` no texto do ADR. 777cde4 grava o caminho real (campo ref) com testes e corrige record-decision.md e doctor.md.
- PMK-247 ciclo 2 (sonnet): APROVADO. Follow-ups: adr-status com tracker fora do repo e auto_commit falha com UPSTREAM (anterior ao PR); `--by` grava `docs/adr/<nome>` que não existe no repo. Mergeado (44ecb9f).
- PMK-246: PERGUNTA PMK-246-3 (critério 5, conferir num workspace Business real, sem acesso). O usuário decidiu: critério 5 desmarcado e follow-up "Verify Linear releases against a Business workspace"; o que falta conferir está em `scripts/lib/linear/API-VERIFICATION.md`. PR #208 (opus).
- PMK-246 ciclo 1 (opus): o revisor parou quando o computador dormiu; mandei seguir dos achados e ele terminou. APROVADO com 6 não bloqueantes; pedi antes do merge os que tocam corretude: release-notes por release ignorava hasMore, a release sumia de searchIssues e das escritas (release-notes gravava release: null), release de outro time aceita. 5e47d75 corrigiu com rebase, mas cresceu (20 arquivos, goldens do Local), então mandei para revisão.
- PMK-246 ciclo 2 (opus): MUDANÇAS PEDIDAS; bloqueante: `teams(first: 250)` no RELEASE_FIELDS compartilhado levava as consultas de release a ~28.000 e ~1,4M pontos de complexidade (limite 10.000), e uma recusa derrubaria get, list, views e escritas. 31e28c2: teams só no RELEASE_QUERY (lote ~4650 pontos, teste de tamanho), leitura de release com falha vira releaseUnknown com note:.
- PMK-246 ciclo 3 (opus): APROVADO. Follow-ups: texto não mostra releases quando a issue está em duas; scope.team em releases.mjs; fake e API-VERIFICATION com 50 em vez de 20; `.replace` frágil no RELEASE_QUERY; custo de requests (readNode lendo releases sem mostrar, escritas lendo antes e depois, busca lendo antes de finishSearch); erro pós-escrita em mapped; mensagem duplicada de 1000 issues; issues create --release, release create e mark-released no Linear; opção B. Mergeado (2cfa32c).
- `pr sync` moveu PMK-246 e PMK-247 para done; PMK-246 fica com o critério 5 desmarcado.

Fim da rodada 20: PRs #207 e #208 mergeados.

Limpeza da rodada 20: closing PR #209 mergeado (452694a), 7 worktrees removidos, branches provisórias e de issue apagadas, local e no origin.

## Rodada 21

Início: 2026-11-10. `develop` em 452694a, `npm test` com 4898 testes, 4807 pass, 0 fail, 91 skipped, saída 0. Run Orca `run_4c99b0d03c38`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-251 | 2 | sonnet (`ctx_56f919ea6da6`) | #210 | ciclos 1 e 2 (sonnet): MUDANÇAS PEDIDAS; ciclo 3 (sonnet): APROVADO | mergeado (6777f71), done |
| PMK-252 | 3 | sonnet (`ctx_b4b6c6d8bb5d`) | #211 | ciclo 1 (opus): MUDANÇAS PEDIDAS; ciclo 2 (opus): APROVADO | mergeado (035242b), done |

- PMK-252: brief com o aviso do limite de complexidade do Linear e das leituras por issue, por causa da PMK-246.
- PMK-251: PR #210; record-decision pergunta se a decisão substitui um ADR antigo, grava a linha Supersedes e marca o antigo superseded depois de confirmar (passo 7). O ADR antigo é achado com `docs adr-status <antigo> deprecated --dry-run`, porque a CLI não tem consulta de ADR. Follow-ups: `docs adr-get <número>` só de leitura; decisão que substitui vários ADRs.
- PMK-251 ciclo 1 (sonnet): MUDANÇAS PEDIDAS; bloqueante: com tracker fora do repo o adr-status devolvia `tracker:docs/adr/...` sem ref e a linha Supersedes gravava esse rótulo. 5df2629: ref no JSON do adr-status (e do dry-run), passos 2 e 4 usam number e ref, aviso de já superseded, número com zeros.
- PMK-251 ciclo 2 (sonnet): MUDANÇAS PEDIDAS; regressão: a regra de parar numa escrita em lote que falha sumiu dos passos 6 e 8. 98401f0 a restaurou e prendeu em `scripts/plugin.test.mjs`.
- PMK-251 ciclo 3 (sonnet): APROVADO; nenhuma outra regra do arquivo de comando sumiu. Quatro sugestões de prosa como follow-up. Mergeado (6777f71).
- PMK-252: PR #211; docs de uma issue do Linear como attachments com link para o arquivo no GitHub e o caminho no metadata, leitura em lote, desconhecido quando a leitura falha. Só testado contra o fake.
- PMK-252 ciclo 1 (opus): MUDANÇAS PEDIDAS, 4 bloqueios: link ignorava a branch padrão resolvida; --add-doc tomava um attachment feito à mão e --remove-doc o apagava; caminho absoluto, tracker: ou .. aceito; API-VERIFICATION sem seção da PMK-252. Complexidade ~3000 pontos, com teste. 61d5443 corrigiu com rebase sobre o #210 (conflitos em record-decision.md, README e CHANGELOG).
- PMK-252 ciclo 2 (opus): APROVADO; o rebase não perdeu nada da PMK-251. Follow-ups: leituras extras de attachment em toda escrita do Linear; lote de attachReleasesTo; host GitHub Enterprise; docs na migração Linear para Local; upsert e delete na mesma URL quando o pmkitDoc não está normalizado; CONFLICT sem tratamento no passo 6 do record-decision; conferir os attachments ao vivo. Mergeado (035242b).
- `pr sync` moveu PMK-251 e PMK-252 para done, com todos os critérios marcados.

Fim da rodada 21: PRs #210 e #211 mergeados. Os follow-ups PMK-246 a PMK-252 da rodada 18 estão todos em done.

## Rodada 22

Follow-ups das rodadas 19 a 21, a pedido do usuário: PMK-256, PMK-257 e PMK-263. Antes, o PR #213 (abre PMK-253 a PMK-266) foi mergeado (ce54efe). A PMK-263 só começa depois do merge da PMK-257, porque as duas mexem em `docs adr-status` e no record-decision (decisão do usuário).

Início: 2026-11-11. `develop` em ce54efe, `npm test` com 4925 testes, 4834 pass, 0 fail, 91 skipped, saída 0. Run Orca `run_4c99b0d03c38`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-256 | 2 | sonnet (`ctx_644b45e6d497`) | #214 | ciclo 1 (sonnet): APROVADO; rebase 1b31535 | mergeado (efb3924), done |
| PMK-257 | 2 | sonnet (`ctx_7940e6a5e0df`) | #215 | ciclo 1 (sonnet): APROVADO | mergeado (2a3692d), done |
| PMK-263 | 3 | sonnet (`ctx_e957cc8e62b1`) | #216 | ciclo 1 (opus): MUDANÇAS PEDIDAS; ciclo 2 (opus): APROVADO com correções antes do merge (f5b4842) | mergeado (709569f), done |
- PMK-257: PR #215; adr-status com tracker fora do repo faz commit pelo commitTracker compartilhado, tracker fora de qualquer repo grava sem commit com nota; `--by` e ref relativos à raiz; relatório certo sem mudança e com status nos dois lugares; comentário YAML mantido. Follow-ups: auto_commit com tracker fora do repo nos outros comandos de escrita sem testes próprios; caminho do `--by` só vale se o layout do leitor bater com tracker.path. Revisor ciclo 1 (sonnet) iniciado.
- PMK-256: o comando do passo 9 com `rm -f "$S"/*.md` parou no prompt de segurança e foi bloqueado; mandei refazer sem rm. PR #214: eventos sem duplicata depois do merge (events.mjs), mensagem certa para view sem archived (bulk.mjs), Linear recusa com NOT_SUPPORTED antes do erro de view (unarchiveNotSupported compartilhado); limites do bulk já certos no Local, só teste de regressão. Follow-ups: merge que duplica uma sequência feita dentro do mesmo segundo ainda deixa parte das duplicatas; parser genérico recusa flags desconhecidas como --limit antes do NOT_SUPPORTED. Revisor ciclo 1 (sonnet) iniciado.
- PMK-257 ciclo 1 (sonnet): APROVADO. Não bloqueantes: nota "not in a git repository" para qualquer falha do rev-parse; commit interno e externo não independentes; stderr do git na mensagem UPSTREAM pode ter caminho absoluto (só no caminho de falha); `climbsOut` com path.sep (Windows); `--by` relativo ao checkout com os dois ADRs no tracker externo; commit vai para um repo pai quando a pasta do tracker não é repo. Mergeado (2a3692d). PMK-263 iniciada (sonnet).
- PMK-256 ciclo 1 (sonnet): APROVADO; conferiu que hasMore e --max já estavam certos (Local filtra archived antes do limite e não define hasMore; Linear recusa antes de ler). Não bloqueantes: sequência no mesmo segundo ainda duplica; nextStep com placeholder e helper duplicado em bulk.mjs:101; teste de limites é só trava de regressão. Conflito com develop depois do #215; pedi rebase.
- PMK-256: rebase 1b31535 (só o CHANGELOG em conflito, as duas linhas mantidas), npm test saída 0. Mergeado (efb3924).
- PMK-263: PR #216; `docs adr-get`, record-decision com vários ADRs substituídos e perguntas e avisos arrumados, adr-status reescreve toda linha de status. O critério de validate com tracker hospedado já era atendido pela PMK-228 (só marcado). Follow-up: teste de validate na CLI com config do Linear. Revisor ciclo 1 (opus) iniciado.
- PMK-263 ciclo 1 (opus): MUDANÇAS PEDIDAS, 3 bloqueios: adr-status reescreve `status:` dentro de bloco de código quando há front matter ou `## Status` (e adr-get dá nota falsa de dois status); adr-get só expõe o primeiro status, e o aviso de já superseded do passo 2 não dispara com front matter accepted e seção superseded; conflito no CHANGELOG. Pontos de atenção ok: validate hospedado coberto por validate.test.mjs:556, PMK-257 sem regressão, nenhuma regra do record-decision sumiu. Pedi junto: helper comum de leitura de status, título com `#` entre aspas e título vindo de bloco de código, asserção forte do ref em plugin.test.mjs:213, teste de validate na CLI com Linear. Ficam como registro: aviso de número maior quase nunca dispara (next-adr numera acima de todos); rótulo reescrito sempre `Status:`.
- PMK-263: c8e1740 corrige os 3 bloqueios e os itens baratos com rebase (CHANGELOG com os dois lados); parser comum de status ignora blocos de código só no início da linha (indentados não); teste de validate com Linear é de caracterização. npm test 4855 pass, 0 fail, saída 0. Revisor ciclo 2 (opus) iniciado.
- PMK-263 ciclo 2 (opus): APROVADO; os 3 bloqueios e os itens baratos corrigidos, rebase sem perder PMK-256/257, nenhuma regra do record-decision sumiu, blocos indentados não bloqueiam. Pedi antes do merge: aspa escapada `''` no splitYaml (regressão, usar stripComment), cerca de código com crase inline que nunca fecha (regressão), nota do texto do adr-get, números repetidos no record-decision. Ficam como follow-up: `### ` dentro de `## Status` entra no status e some na reescrita (já em develop); limpeza do ramo duplicado em setAdrStatus.
- PMK-263: f5b4842 corrige os quatro pontos pedidos antes do merge (splitYaml com stripComment e `''`, cercas de código pelas regras do CommonMark, nota do adr-get, cada ADR uma vez no record-decision), com teste para cada um; npm test 4857 pass, 0 fail. Conferido no diff (5 arquivos, +46/-13). blankMarkdownCode de todos.mjs ficou com o próprio regex. Mergeado (709569f).
- `pr sync` moveu PMK-256, PMK-257 e PMK-263 para done, com todos os critérios marcados.

Fim da rodada 22: PRs #214, #215 e #216 mergeados.

Limpeza da rodada 22: closing PR #217 mergeado (678161f), 7 worktrees removidos, branches provisórias e de issue apagadas, local e no origin.
- Follow-ups da rodada 22, a pedido do usuário, sob EPC-6: PMK-267 (de PMK-256), PMK-268 (de PMK-257), PMK-269 (de PMK-263).

## Rodada 23

Follow-ups da rodada 22, a pedido do usuário: PMK-267, PMK-268 e PMK-269. Antes, o PR #218 (abre as três) foi mergeado (56c60a4). A PMK-269 só começa depois do merge da PMK-268, porque as duas mexem em `scripts/lib/adr.mjs` (mesmo critério da rodada 22).

Início: 2026-11-11. `develop` em 56c60a4, `npm test` com 4948 testes, 4857 pass, 0 fail, 91 skipped, saída 0. Run Orca `run_4c99b0d03c38`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-267 | 2 | sonnet (`ctx_2646e7bebfc4`) | #219 | ciclo 1 (sonnet): APROVADO | mergeado (2498519), done |
| PMK-268 | 3 | sonnet (`ctx_a9732e2ebfd8`) | #220 | ciclo 1 (opus): APROVADO com correções antes do merge (6a6c1ac) | mergeado (7a798d9), done |
| PMK-269 | 1 | sonnet (`ctx_ed0c038b3e67`) | #221 | ciclo 1 (sonnet): APROVADO | mergeado (40cc56b), done |
- PMK-267: PR #219; parseEvents descarta uma sequência archive/unarchive de um segundo repetida pelo merge (segunda metade igual à primeira); bulk unarchive no Linear responde NOT_SUPPORTED antes do checkUsage. Teto: quatro mudanças reais no mesmo segundo, em duas metades iguais, aparecem como duas (estado final certo). Follow-up: desempate por timestamp abaixo do segundo. Revisor ciclo 1 (sonnet) iniciado.
- PMK-268: PR #220; mensagem UPSTREAM do auto_commit sem caminho absoluto; `--by` com os dois ADRs no tracker externo grava caminho relativo ao ADR que o contém (decisão do implementador, nada no código ou nas docs dava formato); climbsOut em `scripts/lib/paths.mjs` sem depender do separador; testes de issues update, assign e create com commit no tracker externo. Follow-ups: linha Supersedes do record-decision com o mesmo problema; climbsOut num CI Windows. Revisor ciclo 1 (opus) iniciado.
- PMK-267 ciclo 1 (sonnet): APROVADO. O teto só muda a exibição: events.jsonl não é reescrito, replay idempotente, drift e migração iguais; muda `issues get --history` e a contagem do preview de remoção. Nenhuma regra melhor com {at, by, op}. Não bloqueantes: teto sem teste que o fixe; três cópias ou cópia parcial não descartadas; config lida antes do checkUsage (erro de config em vez de uso); sem teste de que o Local ainda recusa --limit. O npm test do revisor saiu 1 uma vez por `redact-probes.test.mjs:303` (1,19 s contra 1 s, máquina carregada), sem relação com o PR; passou isolado e na segunda execução. Mergeado (2498519).
- PMK-268 ciclo 1 (opus): APROVADO. `ref` e `path` do JSON iguais, então record-decision.md não muda; todos os chamadores de climbsOut importam de paths.mjs; mensagem UPSTREAM reproduzida sem caminho absoluto e dizendo o que commitar. Pedi antes do merge: troca da pasta por `.` sem conferir o fim do nome (`/tmp/tracker/x` vira `.racker/x`, pmkit.mjs:4207) e teste fraco com existsSync (adr.test.mjs:797). Follow-ups: linha Supersedes do record-decision com tracker externo (bases diferentes no par de ADRs); regex de caminho absoluto para no espaço e não trata UNC (pmkit.mjs:4208); next genérico com mais de 5 arquivos; `..\` e `C:\` contam como fora no POSIX.
- PMK-268: 6a6c1ac move a limpeza para `relativeTo` em paths.mjs (troca a pasta só antes de separador, aspas, espaço, dois-pontos ou fim) e o teste do `--by` resolve o caminho a partir do dirname do ADR; rebase sobre o #219 (CHANGELOG), npm test 4866 pass, 0 fail, saída 0. Conferido no diff (4 arquivos, +21/-7). Mergeado (7a798d9). PMK-269 iniciada (sonnet).
- PMK-269: PR #221; `locate().end` em adr.mjs termina a seção Status no primeiro heading de qualquer nível fora de bloco de código; parser único mantido. npm test 4867 pass, 0 fail. Follow-up: headings setext (sublinhados com === ou ---) não encerram a seção. Revisor ciclo 1 (sonnet) iniciado.
- PMK-269 ciclo 1 (sonnet): APROVADO; conferiu à mão #tag, bloco de código, CRLF e subsecção ###; PMK-263 e PMK-268 seguem passando. Não bloqueantes: heading com tab, indentado ou vazio e heading setext não encerram a seção; uma asserção fixa o status com texto de bloco de código. Mergeado (40cc56b).
- `pr sync` moveu PMK-267, PMK-268 e PMK-269 para done, com todos os critérios marcados.

Fim da rodada 23: PRs #219, #220 e #221 mergeados.

Limpeza da rodada 23: closing PR #222 mergeado (3a6fafb), 6 worktrees removidos, branches provisórias e de issue apagadas, local e no origin.
- Follow-ups da rodada 23, a pedido do usuário, sob EPC-6: PMK-270 e PMK-271 (de PMK-268), PMK-272 (de PMK-267), PMK-273 (de PMK-269).

## Rodada 24

Follow-ups da rodada 23, a pedido do usuário: PMK-270, PMK-271, PMK-272 e PMK-273. Antes, o PR #223 (abre as quatro) foi mergeado (d1e5139). A PMK-273 só começa depois do merge da PMK-270, porque as duas mexem em `scripts/lib/adr.mjs` (mesmo critério das rodadas 22 e 23).

Início: 2026-11-11. `develop` em d1e5139, `npm test` com 4958 testes, 4867 pass, 0 fail, 91 skipped, saída 0. Run Orca `run_4c99b0d03c38`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-270 | 2 | sonnet (`ctx_7a625229504e`) | #224 | ciclo 1 (sonnet): APROVADO | mergeado (1348a60), done |
| PMK-271 | 2 | sonnet (`ctx_33ba26aed710`) | #225 | ciclo 1 (sonnet): MUDANÇAS PEDIDAS; ciclo 2 (sonnet): APROVADO | mergeado (1a8f251), done |
| PMK-272 | 1 | haiku (`ctx_77007fb44949`) | #226 | ciclo 1 (sonnet): APROVADO; rebase 52b7d30 | mergeado (569bfd0), done |
| PMK-273 | 2 | sonnet (`ctx_5c51dfbc1ad5`) | #227 | ciclo 1 (sonnet): MUDANÇAS PEDIDAS; ciclo 2 (sonnet): APROVADO; rebase 5543766 | mergeado (5547537), done |
- PMK-270: PR #224; adrRef em adr.mjs, compartilhado com o `--by` do adr-status, e `docs adr-get --from` com supersedesRef; o passo 4 do record-decision escreve o Supersedes com ele e o passo 5 relê numa mudança de caminho. npm test 4870 pass, 0 fail, saída 0. Follow-up opcional: notas da migração para o Linear dizerem que `--from` só tem efeito no Local. Revisor ciclo 1 (sonnet) iniciado.
- PMK-271: PR #225; hideAbsolutePaths em paths.mjs esconde caminho com espaço (até a aspa que fecha, ou até o fim da linha) e UNC; o next com mais de 5 arquivos cita a pasta do tracker.path relativo, nunca um absoluto. npm test 4872 pass, 0 fail, saída 0. Follow-ups: mesma regra no stderr do git de outros comandos; rev-parse que falha no fluxo do tracker externo vira "nada commitado" sem erro. Revisor ciclo 1 (sonnet) iniciado.
- PMK-271 ciclo 1 (sonnet): MUDANÇAS PEDIDAS, 1 bloqueio: caminho entre aspas com apóstrofo vaza (`'/Users/O'Brien/x y'` vira `'<path>'Brien/x y'`, paths.mjs:29). Pedi junto: limite depois de `=` e `:` (`key=/x`, `file:///x`), tirar o wrapper `relative` de um uso, rebase sobre o #224. Ficam como registro: sem aspas esconde até o fim da linha (perde `File exists`, lado seguro); tracker.path relativo longo aparece inteiro (letra do critério).
- PMK-270 ciclo 1 (sonnet): APROVADO. Não bloqueantes (follow-up): passo 2 do record-decision ainda manda guardar o `ref` antigo; `--from` sem valor dá `"true"` e grafia `./docs/adr/...` é recusada sem normalizar (pmkit.mjs:361); adrRef repete o `slash` de pmkit.mjs (adr.mjs:94); caso misto (novo no repo, antigo no tracker externo) usa a raiz, como a issue pede, sem teste próprio. Mergeado (1348a60). PMK-273 iniciada (sonnet).
- PMK-272: PR #226; dois testes (quatro mudanças reais no mesmo segundo viram dois eventos com estado final desarquivado; `bulk unarchive --limit` no Local dá INVALID_INPUT) e uma asserção mais forte; a recusa vem do parser de flags. npm test 4869 pass, 0 fail, saída 0. Revisor ciclo 1 (sonnet) iniciado.
- PMK-271: correção com rebase sobre o #224 (só CHANGELOG): aspa fecha só antes de fim de linha, espaço, `:` ou `)` (teste O'Brien); caminho começa também depois de `=` e `:`; wrapper `relative` removido. npm test 4877 pass, 0 fail, saída 0. Efeito: `https://host/x` vira `https:<path>`. Revisor ciclo 2 (sonnet) iniciado.
- PMK-272 ciclo 1 (sonnet): APROVADO; o diff só mexe em testes, CHANGELOG, docs e .issues; a mutação da regra das metades iguais derruba os dois testes novos. Não bloqueantes: teste da CLI lê `issues list` em vez das linhas do events.jsonl (cli-bulk.test.mjs:445); regex presa à mensagem do parser (cli-bulk.test.mjs:482); plano em docs/superpowers desatualizado. Conflito com develop depois do #224; pedi rebase.
- PMK-273: PR #227; locate().end termina a seção em ATX indentado até 3 espaços, com tab e vazio, e em parágrafo setext; `---` depois de linha em branco, ou sob citação ou item de lista, não encerra. adr-get e adr-status usam o mesmo locate. npm test 4873 pass, 0 fail, saída 0. Follow-ups: `## Status` indentado e `#` de fechamento não reconhecidos; os buscadores de título e seção em locate() ainda usam startsWith. Revisor ciclo 1 (sonnet) iniciado.
- PMK-272: rebase 52b7d30 (só CHANGELOG, as duas linhas mantidas), npm test 4872 pass, 0 fail, saída 0. Conferido: mesma lista de arquivos da revisão. Mergeado (569bfd0).
- PMK-273 ciclo 1 (sonnet): MUDANÇAS PEDIDAS, 1 bloqueio: o recuo do parágrafo setext atravessa item de lista, citação e quebra temática (adr.mjs:162-168); `Accepted\n- a\n---` deixa o status null e o adr-status escreve um segundo status. Pedi junto: um só helper de heading em head/title (`startsWith`, adr.mjs:154) e nota no CHANGELOG de que `Accepted` seguido de `---` sem linha em branco agora é heading setext; rebase sobre o #226. Fica como registro: tabela e HTML não interrompem parágrafo.
- PMK-271 ciclo 2 (sonnet): APROVADO; os três pontos do ciclo 1 corrigidos com teste, #224 intacto; `https:<path>` inócuo porque o auto_commit só faz add e commit. O npm test do revisor saiu 1 uma vez por `redact-probes.test.mjs:303` (1009 ms contra 1 s, máquina carregada) e 0 na segunda. Follow-ups: caminho depois de `[ , ; < @` sai inteiro (herdado da PMK-268, paths.mjs:31); texto depois de caminho sem aspas some. Mergeado (1a8f251).
- PMK-273: correção com rebase sobre o #226: o recuo setext para em item de lista, citação e quebra temática (INTERRUPTS_PARAGRAPH, THEMATIC_BREAK), testado em adrInfo, setAdrStatus e na CLI; headingLevel único em head, title e no fim da seção; nota no CHANGELOG. npm test 4877 pass, 0 fail, saída 0. Revisor ciclo 2 (sonnet) iniciado.
- PMK-273 ciclo 2 (sonnet): APROVADO; os três casos do ciclo 1, headingLevel único e a nota do CHANGELOG com teste, nada de PMK-263/268/269/270 perdido. Follow-ups (casos raros): continuação indentada de item de lista antes de `---` termina a seção cedo (adr.mjs:174); `2. foo` e `-` vazio contam como interrupção e linha de tab mantém a seção aberta (adr.mjs:177); `#` vazio vira título vazio (adr.mjs:199); `Accepted\n---` sem asserção em setAdrStatus. Conflito com develop depois do #225; pedi rebase.
- PMK-273: rebase 5543766 (só CHANGELOG, as duas linhas mantidas), npm test 4884 pass, 0 fail, saída 0. Conferido: mesma lista de arquivos da revisão. Mergeado (5547537).
- `pr sync` moveu PMK-270, PMK-271, PMK-272 e PMK-273 para done.

Fim da rodada 24: PRs #224, #225, #226 e #227 mergeados.

Limpeza da rodada 24: closing PR #228 mergeado (1490559), 10 workers liberados, 10 worktrees removidos, branches provisórias e de issue apagadas, local e no origin. `npm test` em develop 1490559: 4975 testes, 4884 pass, 0 fail, 91 skipped, saída 0.
- Follow-ups da rodada 24, a pedido do usuário, sob EPC-6, um por item: PMK-274, PMK-275 e PMK-276 (de PMK-270), PMK-277, PMK-278 e PMK-279 (de PMK-271), PMK-280, PMK-281, PMK-282 e PMK-283 (de PMK-273).

## Rodada 25

Follow-ups da rodada 24, a pedido do usuário: PMK-274, PMK-277, PMK-278 e PMK-280 em paralelo; PMK-281, PMK-282 e PMK-283 depois, uma por vez, porque mexem em `scripts/lib/adr.mjs` (decisão do usuário). A PMK-281 só começa depois do merge da PMK-280, que mexe no mesmo arquivo. Antes, o PR #229 (abre PMK-274 a PMK-283) foi mergeado (d63c141).

Início: 2026-11-11. `develop` em d63c141, `npm test` com 4975 testes, 4884 pass, 0 fail, 91 skipped, saída 0. Run Orca `run_4c99b0d03c38`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-274 | 1 | haiku (`ctx_135973715073`) | #232 | ciclo 1 (sonnet): APROVADO com correções antes do merge (55e6470); rebase 0a9a89e | mergeado (74ed665), done |
| PMK-277 | 1 | sonnet (`ctx_b2615d76d98c`) | #230 | ciclo 1 (sonnet): APROVADO | mergeado (7815f8c), done |
| PMK-278 | 2 | sonnet (`ctx_b5b5f75914d2`) | #233 | ciclos 1 e 2 (sonnet): MUDANÇAS PEDIDAS; ciclo 3 (sonnet): APROVADO | mergeado (45ff9ce), done |
| PMK-280 | 1 | sonnet (`ctx_45985de3067b`) | #231 | ciclo 1 (sonnet): APROVADO; rebase b0e4fd3 | mergeado (eb96c3e), done |
| PMK-281 | 1 | sonnet (`ctx_506a0e55cbea`) | #234 | ciclos 1 e 2 (sonnet): MUDANÇAS PEDIDAS; ciclo 3 (sonnet): APROVADO | mergeado (35fda00), done |
| PMK-282 | 1 | sonnet (`ctx_21da8533228c`) | #235 | ciclo 1 (sonnet): APROVADO | mergeado (47b3238), done |
| PMK-283 | 1 | haiku (`ctx_bef846c0e851`) | #236 | ciclo 1 (sonnet): APROVADO | mergeado (d0588bb), done |
- PMK-277 e PMK-280 com sonnet apesar da estimativa 1: regex e parser com casos de borda (O'Brien na PMK-271, setext na PMK-273). PMK-277 e PMK-278 tocam em `hideAbsolutePaths`; a 277 muda o regex e a 278 só passa a chamá-la, sem mudar regex nem assinatura.
- PMK-277: PR #230; `[ , ; < @` como inícios nos dois lookbehinds de hideAbsolutePaths, assinatura igual; `]` e `>` sem mudança (caminho sem aspas vai até o fim da linha; aspa antes de `]` ou `>` cai nessa regra, esconde mais). Sem e2e novo (git não imprime caminho depois de `[` sob comando). npm test 4887 pass, 0 fail, saída 0. Follow-up: `]` e `>` como fechamento de aspa. Revisor ciclo 1 (sonnet, `ctx_b733679c489b`) iniciado.
- PMK-280: PR #231; a volta pelo parágrafo setext para no item de lista mais próximo com deslocamento de conteúdo <= indentação; adr-get e adr-status pelo mesmo locate. npm test 4885 pass, 0 fail, saída 0. Teto: tab na indentação e largura de item aninhado. Revisor ciclo 1 (sonnet) iniciado.
- PMK-274: PR #232; passo 2 do record-decision guarda só o number, diz que ref é o caminho que o usuário vê e nunca a citação do Supersedes, e aponta para o supersedesRef; teste de regra em plugin.test.mjs escrito antes. npm test 4884 pass, 0 fail, saída 0; cenário spec-record-decision passa. Follow-ups: `issues branch` falha sem develop local (passou com --from origin/develop); regex do teste de regra frágeis a reescrita. Revisor ciclo 1 (sonnet) iniciado.
- PMK-274: primeiro start do revisor (ctx_5c8bbcda1527) com composer vazio; abandon, ready e worker-start no mesmo terminal (aprovação permanente): `ctx_371e6cafd874`, rodando.
- PMK-277 ciclo 1 (sonnet): APROVADO; critério com código (paths.mjs:30-31) e teste por caractere, unitário mais o e2e da PMK-271 bastam; falsos positivos (`a,/b`, `</body>`) só perdem texto depois do caminho. O npm test do revisor saiu 1 por `redact-probes.test.mjs` (tempo, máquina carregada), que passou isolado. Não bloqueantes: `{ | >` e crase ainda não iniciam caminho; comentário de paths.mjs:23 impreciso; trailer Opus no plano. Mergeado (7815f8c8).
- PMK-278: PR #233; stderr do git escondido em 6 lugares: grepFailure (issues delete), tagWarning, readRemotes (link-repo), scanRepo em todos.mjs, nota de prune do inbox em local/tracker.mjs, failure em github/host.mjs só para git (pr open); commitIn já escondia; regex e assinatura intactos. Testes de 4 comandos pela CLI em cli-git-paths.test.mjs. npm test 4890 pass, 0 fail, saída 0. Follow-ups: mensagem do readRemotes com `${ctx.root}` (caminho do próprio pmkit); URLs viram `https:<path>`; stderr do gh não escondido. Revisor ciclo 1 (sonnet) iniciado.
- PMK-280 ciclo 1 (sonnet): APROVADO; os dois critérios com código e teste. O npm test do revisor saiu 1 por `redact-probes.test.mjs:303` (1211 ms, máquina carregada); redact-probes e adr isolados 320/320. Não bloqueantes, levados ao brief da PMK-281: item irmão largo demais mantém a seção aberta (`- x\n\n1. a\n\n  b\n---`, adr.mjs:175); cerca de código no indent 0 ignorada na volta (:174); `- - -` tomado como item (:120); continuação preguiçosa antes da linha em branco encerra a seção (:175); comentário de LIST_ITEM no lugar errado (:118). Conflito com develop depois do #230; pedi rebase.
- PMK-274 ciclo 1 (sonnet): APROVADO; o diff só toca o passo 2, nenhuma regra sumiu, npm test saída 0. O worker_done saiu pelo dispatch abandonado (ctx_5c8bbcda1527), daí uma escalation sem efeito. Pedi antes do merge: placeholder `<old ref>` no passo 4 (record-decision.md:21) trocado pelo supersedesRef (critério 1), mensagem e regex negativo das asserções em plugin.test.mjs:219-220, frase de que ref só mostra o arquivo; e rebase.
- PMK-280: rebase b0e4fd3 (só CHANGELOG, as duas linhas mantidas), npm test 4888 pass, 0 fail, saída 0. Conferido: mesma lista de 9 arquivos da revisão. Mergeado (eb96c3e). PMK-281 iniciada (sonnet), com `- - -` como quebra temática e o comentário de LIST_ITEM da revisão da PMK-280; os outros achados daquela revisão ficam como follow-up.
- PMK-278 ciclo 1 (sonnet): MUDANÇAS PEDIDAS, 1 bloqueio: hideAbsolutePaths lê o `//host` de `https://` como caminho e apaga a causa do erro de push do pr open (`unable to access 'https:<path>`, sem 403, DNS ou auth). Nenhum outro lugar em scripts/ repete stderr do git; auto_commit intacto; npm test saída 0. Pedi a correção em hideAbsolutePaths (vale para todos os chamadores, inclusive o auto_commit; a restrição de não mexer no regex valia só com a PMK-277 em paralelo), com rebase sobre o #230, e o regex vácuo do teste de tagWarning (cli-git-paths.test.mjs:61). Ficam como registro: erro de spawn sem hide (pmkit.mjs:491, :2368, sem caminho do git); todos.mjs:451 esconde até o fim da linha (regra da PMK-271); `cmd==='git'` dentro do failure() compartilhado.
- PMK-274: 55e6470 com as quatro correções e rebase sobre 7815f8c (só CHANGELOG); npm test 4887 pass, 0 fail, saída 0 na segunda execução (a primeira saiu 1 por dois probes de tempo em redact-probes, que passou 243/243 isolado). Conferido no diff: placeholder `<supersedesRef>` no passo 4, passo 2 sem guardar ref, asserções por frase em plugin.test.mjs. Conflito de novo no CHANGELOG depois do #231; pedi outro rebase.
- PMK-278: 0944b1e com rebase (só CHANGELOG): hideAbsolutePaths deixa `scheme://host` inteiro (http, https, ssh, git, file com host) e esconde `file:///x`, caminho sem scheme, `C://x` e UNC, para todos os chamadores; asserção `https:<path>` da PMK-277 invertida; testes unitários de URL, mensagem de push com 403 em host.mjs, teste de tagWarning ancorado. npm test 4895 pass, 0 fail, saída 0. Revisor ciclo 2 (sonnet) iniciado.
- PMK-274: rebase 0a9a89e sobre eb96c3e (só CHANGELOG), npm test 4888 pass, 0 fail, saída 0. Conferido: mesma lista de 9 arquivos. Mergeado (74ed665).
- PMK-281: PR #234; INTERRUPTS_PARAGRAPH estreito (ordenada só em 1, item vazio não interrompe), BLOCK_START largo, indentColumns com tab para bloco indentado, LIST_ITEM sem quebra temática; teste de 12 casos em adrInfo, setAdrStatus, adr-get e adr-status. npm test 4889 pass, 0 fail, saída 0. Follow-ups (da revisão da PMK-280, ainda valem): item irmão largo, cerca no indent 0 na volta de continuesItem, continuação preguiçosa antes da linha em branco, indentOf sem tab em continuesItem. Revisor ciclo 1 (sonnet) iniciado.
- PMK-278 ciclo 2 (sonnet): MUDANÇAS PEDIDAS, 2 bloqueios em paths.mjs:20: `file://localhost/Users/John Doe/r.git` e `file://host/abs` saem inteiros (vazam o caminho); a URL inteira expõe `user:pw@` (piorou em relação ao `https:<path>`). npm test 4895 pass, 0 fail, saída 0. Pedi: esconder o caminho de toda URL file://, e trocar o userinfo por [redacted] reusando url_credentials (e TOKENS) de redact.mjs, com testes. Ficam como registro: const URL sombreia o global (pedi a troca, barata); erros de spawn sem esconder (todos.mjs:451, pmkit.mjs:489).
- PMK-281 ciclo 1 (sonnet): MUDANÇAS PEDIDAS, 1 bloqueio (regressão sobre a PMK-280): o laço que pula código indentado (adr.mjs:203) toma continuação de item com 4+ colunas por código, e `## Status\nAccepted\n- a\n\n    b\nc\n---` fecha a seção em c. npm test 4889 pass, 0 fail, saída 0. Pedi pular o código só quando continuesItem for falso, com teste com espaços e tab. Não bloqueantes: `-\nfoo\n===`, tab contra indentOf, 9 dígitos, aspas duplas.
- PMK-278: 05bb1fe com rebase (CHANGELOG): toda URL file:// vira `file:<path>`; as outras `scheme://host` passam por redact(url).text (`https://[redacted]@host`, token solto também); const URL virou SCHEME_URL; linha `file://server` do teste do ciclo 1 removida porque fixava o vazamento. npm test 4897 pass, 0 fail, saída 0. Revisor ciclo 3 (sonnet) iniciado.
- PMK-281: b57b753 pula código indentado só quando continuesItem é falso e troca indentOf por indentColumns (tab); teste com espaços e tab em adrInfo, adr-get e adr-status; rebase sem conflito. npm test 4890 pass, 0 fail, saída 0. Follow-ups: `-\nfoo\n===`, limite de 9 dígitos, aspas duplas, e os da PMK-280. Revisor ciclo 2 (sonnet) iniciado.
- PMK-278 ciclo 3 (sonnet): APROVADO; bloqueios dos ciclos 1 e 2 resolvidos com teste; só a asserção `https:<path>` da PMK-277 sumiu, trocada pela regra nova. npm test 4897 pass, 0 fail, saída 0. Follow-ups: file:// entre aspas perde a causa; userinfo sem formato de token passa (`https://usuario@host`); `git+file://host/...` vaza; regex quadrática em linha sem `://` (paths.mjs:22); erro de spawn e raiz sem esconder (todos.mjs:452, pmkit.mjs:491 e :3801). Conferido: 16 arquivos, CLEAN. Mergeado (45ff9ce).
- PMK-281 ciclo 2 (sonnet): MUDANÇAS PEDIDAS, outra regressão sobre develop (adr.mjs:204): marcador seguido de 5+ espaços (`-    a\n\n    b\nc\n---`) faz continuesItem usar item[1].length, pular b como código e fechar a seção em c. npm test 4890 pass, 0 fail, saída 0. Pedi largura do conteúdo pelo CommonMark (marcador + 1 com 5+ colunas ou item vazio), em colunas, a mesma conta na volta da PMK-280; teste vazio de `-` (adr.test.mjs:924); e, por ser o último ciclo antes de chamar o usuário, comparar com develop os casos de lista antes do push.
- PMK-281: 2370553 com itemContent (coluna do conteúdo em colunas, tab até a parada de 4, marcador + 1 com 5+ colunas) em continuesItem; testes com 5 espaços, tab depois do marcador e item ordenado; teste de `-` sozinho afirma casos. Comparou adrInfo de develop e da branch em 4410 casos de lista: onde o PR fecha mais cedo, develop estava errado pelo CommonMark. Rebase sem conflito, npm test 4899 pass, 0 fail, saída 0. Revisor ciclo 3 (sonnet) iniciado.
- PMK-281 ciclo 3 (sonnet): APROVADO; casos dos ciclos 1 e 2 certos pelo CommonMark, nenhum caso pior que develop; code-review só com estilo e o follow-up de 9 dígitos. npm test 4899 pass, 0 fail, saída 0. Conferido: CLEAN. Mergeado (35fda00). PMK-282 iniciada (sonnet), com pedido de comparar adrInfo de develop e da branch antes do PR.
- PMK-282: PR #235; heading Status achado com headingLevel e um helper novo headingText (1 a 3 espaços, tab, fechamento com `#`), no lugar de STATUS_SECTION; testes em adrInfo, setAdrStatus e na CLI. Comparou adrInfo e setAdrStatus de develop e da branch em 171 textos: só o caso indentado muda. npm test 4902 pass, 0 fail, saída 0. Follow-ups: fechamento escapado (`Status \#`); heading Status dentro de item de lista ou citação. Revisor ciclo 1 (sonnet) iniciado.
- PMK-282 ciclo 1 (sonnet): APROVADO; critérios com código (adr.mjs:218, headingText em :115) e teste; STATUS_SECTION removido; título não usa headingText. A comparação do implementador estava incompleta: develop também recusava `## Status ##`, `#####`, `#` único e tab antes do fechamento, e a branch aceita (o que a issue pede). Não bloqueantes: título mantém `#` final (adr.mjs:189); trim aceita NBSP (já era assim); faltam testes de `## Status #` e `# #` (adr.test.mjs:880). npm test 4902 pass, 0 fail, saída 0. Conferido: CLEAN. Mergeado (47b3238). PMK-283 iniciada (haiku; só teste, como a PMK-272), com PERGUNTA se o que adr-status escreve hoje parecer errado.
- PMK-283: PERGUNTA PMK-283 (em `## Status\nAccepted\n---`, adr-status grava `## Status\n\nDeprecated\n\nAccepted\n---`, com dois status para um leitor humano). Respondi opção 1: teste de caracterização do texto de hoje, sem mudar adr.mjs, porque a issue pede só o teste e tira a regra setext do escopo, e pelo CommonMark (PMK-273) `Accepted` sublinhado é heading. Follow-up: avisar ou tratar uma seção Status vazia seguida de heading setext. Decisão também comentada na issue.
- PMK-283: PR #236; teste de caracterização em setAdrStatus e pela CLI: `## Status\nAccepted\n---` vira `## Status\n\nDeprecated\n\nAccepted\n---`, adr-get null antes e Deprecated depois; adr.mjs intocado. npm test 4904 pass, 0 fail, saída 0. Follow-up: seção Status vazia seguida de heading setext. Revisor ciclo 1 (sonnet) iniciado.
- PMK-283 ciclo 1 (sonnet): APROVADO; adr.mjs intocado, texto inteiro comparado, adr-get antes e depois, comentário CommonMark, testes unitário e CLI; o teste falha com a regra setext mudada (conferido e desfeito). Não bloqueantes: adrInfo não conferido no texto escrito (adr.test.mjs:873), fixture duplicada (:882), só `---` fixado (não `===`), CHANGELOG descreve mudança só de teste. npm test 0 falhas, saída 0. Mergeado (d0588bb).
- `pr sync` moveu PMK-274, PMK-277, PMK-278, PMK-280, PMK-281, PMK-282 e PMK-283 para done, com todos os critérios marcados.

Fim da rodada 25: PRs #230, #231, #232, #233, #234, #235 e #236 mergeados.

Limpeza da rodada 25: closing PR #237 mergeado (cf113eb), 17 workers liberados e 1 parado (revisor da PMK-274 que ficou em start_unknown), 18 worktrees removidos, branches provisórias e de issue apagadas, local e no origin. `npm test` em develop cf113eb: 4995 testes, 4904 pass, 0 fail, 91 skipped, saída 0.
- Follow-ups da rodada 25, a pedido do usuário, sob EPC-6, conferidos no código de cf113eb e agrupados por correção: PMK-284 a PMK-289 (de PMK-277 e PMK-278: inícios e fechamentos de caminho, file:// entre aspas, git+file://, nome de usuário em URL https, regex quadrática, raiz e erros de spawn e do gh), PMK-290 (de PMK-274: issues branch sem develop local), PMK-291 e PMK-292 (de PMK-280 e PMK-281: aninhamento de lista no continuesItem, item vazio e marcador com 10+ dígitos), PMK-293 (de PMK-282: `#` de fechamento no título e testes de `## Status #`), PMK-294 (de PMK-283: aviso para seção Status vazia seguida de heading setext). Ficaram de fora: `## Status \#` (já correto, só falta teste, entra na PMK-293), heading Status dentro de item ou citação (ignorar é o comportamento certo para um ADR), regex frágil do teste de regra da PMK-274 e achados de estilo.

## Rodada 26

Follow-ups da rodada 25 (pedido do usuário: "run 25"): PMK-284 a PMK-294. Antes, o PR #238 (abre as onze) foi mergeado (79bb6df). Três faixas: `hideAbsolutePaths` em `scripts/lib/paths.mjs` uma por vez (PMK-284, 285, 286, 287, 288, com a 288 por último porque reescreve o match de URL sobre as regras finais); `scripts/lib/adr.mjs` uma por vez (PMK-291, 292, 293, 294, mesma decisão do usuário da rodada 25); PMK-289 (só chama hideAbsolutePaths, sem mudar regex) e PMK-290 (issues branch) em paralelo.

Início: 2026-11-12. `develop` em 79bb6df, `npm test` com 4995 testes, 4904 pass, 0 fail, 91 skipped, saída 0. Run Orca `run_4c99b0d03c38`.

| Issue | Est. | Implementador | PR | Revisões | Status |
|---|---|---|---|---|---|
| PMK-284 | 1 | sonnet (`ctx_8a25edaefcda`) | #239 | ciclos 1 e 2 (sonnet): MUDANÇAS PEDIDAS; ciclo 3 (sonnet): APROVADO | mergeado (8e958801), in_review |
| PMK-289 | 2 | sonnet (`ctx_a2333ef5515f`) | #240 | ciclo 1 (sonnet): APROVADO | mergeado (579a9be9), in_review |
| PMK-290 | 1 | sonnet (`ctx_26740971a6be`) | #242 | ciclo 1 (sonnet): APROVADO com correções antes do merge; rebase | mergeado (f098751e), in_review |
| PMK-285 | 1 | sonnet (`ctx_67a842d0243c`) | #243 | ciclo 1 (sonnet): APROVADO | mergeado (679c1b91), in_review |
| PMK-286 | 1 | sonnet (`ctx_b62d3b26b9a1`) | #244 | ciclo 1 (sonnet): APROVADO | mergeado (8baa6c71), in_review |
| PMK-287 | 1 | sonnet (`ctx_9d009d659d35`) | #245 | ciclo 1 (sonnet): APROVADO | mergeado (6c40123a), in_review |
| PMK-288 | 1 | sonnet (`ctx_cd560ab1f17f`) | #246 | ciclo 1 (sonnet): APROVADO | mergeado (8f1dc2fd), in_review |
| PMK-291 | 2 | sonnet (`ctx_4f11c701ab81`), opus nos ciclos 4 a 6 (`ctx_67546e3e7843`) | #241 | ciclos 1 a 3 (sonnet) e 4 e 5 (opus): MUDANÇAS PEDIDAS; correção do ciclo 5 conferida pelo orquestrador | mergeado (04ea4c7a), in_review |
| PMK-292 | 1 | haiku (`ctx_b7d632460e42`) | #247 | ciclo 1 (sonnet): APROVADO | mergeado (a3c436ea), in_review |
| PMK-293 | 1 | sonnet (`ctx_c53064dc557d`) | #248 | ciclo 1 (sonnet): APROVADO com correções antes do merge | mergeado (a3c436ea), in_review |
| PMK-294 | 1 | sonnet (`ctx_f95b81a55f30`) | #249 | ciclos 1 e 2 (sonnet): MUDANÇAS PEDIDAS; ciclo 3 (sonnet): APROVADO | mergeado (1380f10a), in_review |
- Modelo sonnet nas de estimativa 1 de regex e parser (mesmo critério da rodada 25: casos de borda). PMK-290 com sonnet: lógica de git com clone de teste, não mecânica.
- PMK-284: PR #239; `` ` { | > `` como inícios e aspa que fecha antes de `]` e `>`; lista explícita de inícios mantida (sem lookbehind negativo). Única expectativa antiga mudada: o caso da PMK-277 `['/Users/x y'] and '/b c/d'` vira `['<path>'] and '<path>'`. npm test 4908 pass, 0 fail, saída 0. Follow-ups: caminho sem aspas ainda vai até o fim da linha; `}` e `!` não iniciam; crase dentro de caminho entre crases. Revisor ciclo 1 (sonnet) iniciado.
- PMK-289: PR #240; stderr do gh escondido (status HTTP lido da linha crua antes), raiz tirada das mensagens do link-repo e do todos ("the project root", "this repository"), mensagens de spawn escondidas (defensivo, sem teste que falhe antes). Quatro goldens todos-scan.txt mudaram. npm test 4908 pass, 0 fail, saída 0. Follow-ups: error.message nos rethrows de run()/defaultExec em host.mjs; teste direto de grepFailure (não exportado). Revisor ciclo 1 (sonnet) iniciado.
- PMK-291: PR #241; continuesItem reescrito como caminhada para frente sobre os itens abertos (itemContent, indentColumns); os três textos da issue com teste. Comparou adrInfo de develop e da branch em 782.192 casos com commonmark.js de oráculo: 4.354 corrigidos, 0 piores. npm test 4905 pass, 0 fail, saída 0. Follow-ups: ~300 mil casos gerados ainda diferem do CommonMark nos dois lados (citação dentro de item, item vazio, listas mais fundas). package-lock.json não rastreado no worktree, fora do commit. Revisor ciclo 1 (sonnet) iniciado, com conferência independente de casos.
- PMK-291: primeiro start do revisor (ctx_b8299126b222) com composer vazio; abandon, ready e worker-start no mesmo terminal (aprovação permanente): `ctx_788447896045`, rodando.
- PMK-284 ciclo 1 (sonnet): MUDANÇAS PEDIDAS, 2 bloqueios: `>` como início faz `git push <remote>/<branch>` virar `<remote><path>` (paths.mjs:35, regressão sobre develop); aspa que fecha antes de `]` ou `>` mostra o resto de um caminho com aspa no nome (`'/Users/x/a'>b/secret dir/y'`, paths.mjs:34). Decidi e pedi: `>` só inicia caminho como redirect (depois de início de linha, espaço, dígito, `&` ou `>`, nunca de letra); aspa fecha antes de `]`/`>` só quando o seguinte é fim de linha, espaço, `:`, `)`, `]` ou `>` (mantém o critério e o caso da revisão volta ao lado seguro); constante única para os inícios. Ficam como follow-up: `https://h.com/x|/Users/y` sai inteiro (já era em develop); `{/Users/x}` perde o `}`.
- PMK-289 ciclo 1 (sonnet): APROVADO; cada lugar da issue com código, status HTTP do gh api lido (testes de 404 e 502), paths.mjs intocado, npm test 4997 testes, 0 fail, saída 0. Não bloqueantes: teste de tagWarning cai no ramo ENOENT e grepFailure sem teste, então 2 dos 5 lugares de spawn sem teste que falhe antes (follow-up). Conferido: CLEAN. Mergeado (579a9be9).
- PMK-284: correção do ciclo 1 com teste primeiro: `>` só inicia como redirect, aspa fecha antes de `]`/`>` só quando seguida de fim de linha, espaço, `:`, `)`, `]` ou `>`; constante START única; tirada a asserção `a>/Users/x`. npm test 4910 pass, 0 fail, saída 0. Conflito com develop depois do #240; pedi rebase antes do revisor do ciclo 2.
- PMK-290: PR #242; sem --from usa o default local, senão origin/<default> (texto diz `(no local <default>)`, JSON `from` com o ref usado); --from inexistente ou default ausente nos dois lados dá INVALID_INPUT com next step antes de escrever, dry-run também. Remote origin (o do pr open), sem fetch. Testes de cli-pr e cli-linear que dependiam de não haver main local agora criam a branch. npm test 4907 pass, 0 fail, saída 0. Follow-up: remote configurável para issues branch e pr open. Revisor ciclo 1 (sonnet) iniciado.
- PMK-291 ciclo 1 (sonnet): MUDANÇAS PEDIDAS; comparação independente de 8.023 casos contra commonmark.js: 14 corrigidos, 4 piores (adr.mjs:207): item vazio `- a\n-\n\n  x\n---` e marcador com 5+ espaços seguido de linha preguiçosa (`-     a\nlazy\n\n  x\n---` e variantes), que a branch lê como parágrafo e deixa a seção aberta. O worker_done saiu pelo dispatch abandonado (ctx_b8299126b222), daí uma escalation sem efeito. Pedi a correção dos quatro com teste, nova comparação com esses formatos (0 piores) e rebase. Ficam como registro (iguais a develop): código indentado sob item, cerca colada em cerca, linha preguiçosa depois de citação.
- PMK-284: rebase sobre 579a9be (só CHANGELOG, linha da PMK-289 mantida), npm test 4914 pass, 0 fail, saída 0. Revisor ciclo 2 (sonnet) iniciado.
- PMK-290 ciclo 1 (sonnet): APROVADO; critérios com código e teste, testes de cli-pr e cli-linear só ganharam a base exigida, asserções iguais. npm test 4907 pass, 0 fail, saída 0. Pedi antes do merge: `--no-track` no switch -c com base remota (upstream errado em origin/<default>), next step com `--from origin/<nome>`, getIssue antes de branchBase (NOT_FOUND antes de INVALID_INPUT), `git log` do work.md:29 com a base devolvida. Follow-ups: exists() trata qualquer falha do rev-parse como ausente; `--from` sem valor; tag com o nome do default; ordem do spread de `from`.
- PMK-284 ciclo 2 (sonnet): MUDANÇAS PEDIDAS; os três pontos do ciclo 1 certos, PMK-289 intacta, npm test 4914 pass, 0 fail, saída 0. Bloqueio: dígito que termina palavra antes de `>` conta como redirect (`<rev1>/<rev2>` vira `<rev1><path>`, paths.mjs:22). Menor: crase de fechamento em `` `git`/`gh` `` inicia caminho (paths.mjs:36). Pedi `(?<!\w)\d` no redirect e crase só abrindo depois de START, com bateria de textos comuns antes do push. Follow-ups: `>` depois de letra ou aspa não inicia (`from>/Users/x` sai inteiro); aspa seguida de `. , ; }` não fecha; falsos positivos novos de `|` (`x ||/Users/x`); gh `(/repos/o/r/pulls/1)` vira `<path>` e repoMentions devolve error.message sem esconder (PMK-289).
- PMK-284: correção do ciclo 2 com teste primeiro: dígito antes de `>` é redirect só sem caractere de palavra, `~` ou `^` antes (`HEAD~1>/x` inteiro); crase só abre caminho sem aspas depois de START; teste antigo `a`/Users/x` virou `a `/Users/x`. Bateria de 38 linhas comuns de git e gh: só mudam crase com /tmp/x e os redirects `2>/dev/null` e `>/dev/null` (pretendido). npm test 4917 pass, 0 fail, saída 0. Revisor ciclo 3 (sonnet) iniciado.
- PMK-291: correção do ciclo 1 com teste primeiro: os quatro casos (item vazio, marcador com 5+ espaços seguido de linha preguiçosa, outra linha ou item vazio) em continuesItem; rebase (só CHANGELOG). Nova comparação em 6.516.750 casos: 13.576 corrigidos, 0 piores; 74 errados nos dois lados (item vazio depois de continuação, depois texto e sublinhado; a volta do parágrafo usa INTERRUPTS_PARAGRAPH), follow-up. npm test 4910 pass, 0 fail, saída 0. Revisor ciclo 2 (sonnet) iniciado, com comparação independente.
- PMK-284 ciclo 3 (sonnet): APROVADO; os dois pontos do ciclo 2 certos, sem vazamento; npm test 5008 testes, 0 fail, saída 0. Não bloqueante (follow-up): dígito depois de `-`, `.` ou `<` ainda vira redirect (`<sha-1>/<x>`, `<v1.2>/<x>`, `<1>/<2>` perdem o resto da linha, sem vazar). Conferido: CLEAN. Mergeado (8e958801). PMK-285 iniciada (sonnet).
- PMK-290: correções antes do merge 25ff374, 1a6ebe0 e ebdf268 (`--no-track` com teste de branch sem upstream, next step `--from origin/<nome>`, getIssue antes de branchBase, passo 6 do work.md lê o `from` do dry-run do issues branch, cenário issues-work e golden regenerados). npm test 4909 pass, 0 fail, saída 0. Conferido no diff. Conflito com develop depois do #239; pedi rebase.
- PMK-291 ciclo 2 (sonnet): MUDANÇAS PEDIDAS; os quatro casos do ciclo 1 certos, sem dependência, npm test 4910 pass, 0 fail, saída 0. Comparação independente em 854.065 casos: 42 piores que develop, código indentado dentro do item seguido de linha preguiçosa e sublinhado (`- a\nlazy\n\n\n      x\nlazy\n---`), regra de 4 colunas não aplicada no ramo j === top (adr.mjs ~212-238). Pedi a correção com teste e o gerador ampliado com esse formato. Ficam como registro (iguais a develop): cerca depois de cerca, item vazio + código, citação.
- PMK-290: rebase sobre 8e95880 (só CHANGELOG, linhas da PMK-284 e da PMK-289 mantidas) e espaço em host.mjs:155 (6d25b94). npm test 4922 pass, 0 fail, saída 0. Conferido: CLEAN. Mergeado (f098751e).
- PMK-285: PR #243; file:// entre aspas termina na aspa que fecha, pela mesma regra do caminho entre aspas. Bateria de 20 textos de git e gh: só mudam os file:// entre aspas (mantêm a causa). npm test 4918 pass, 0 fail, saída 0 na segunda execução (a primeira saiu 1 por tempo em redact-probes, que passou 243/243 isolado). Follow-ups: `Cloning into 'file:///x'...` ainda esconde até o fim da linha; `file:/x` com uma barra não tratado. Revisor ciclo 1 (sonnet) iniciado.
- PMK-285 ciclo 1 (sonnet): APROVADO; bateria de 45 textos develop x branch sem regressão (https, ssh, file:// com e sem host, aspas, git+file, O'Brien, `<remote>/<branch>`, `<rev1>/<rev2>`). npm test 4918 pass, saída 0 na segunda execução (primeira saiu 1 por tempo em redact-probes). Não bloqueantes, iguais a develop: `file:/` de uma barra, git+file e URL no meio da aspa cortam a linha; constante de `file:` duplicada. Conferido: CLEAN. Mergeado (679c1b91). PMK-286 iniciada (sonnet).
- PMK-291: correção do ciclo 2 com teste primeiro (código indentado dentro do item não conta como continuação no topo); rebase (só CHANGELOG). Gerador ampliado: 13.939.836 casos, 41.824 corrigidos, 0 piores, 170 errados nos dois lados (item vazio depois de continuação). npm test 4926 pass, 0 fail, saída 0. Revisor ciclo 3 (sonnet) iniciado, com gerador próprio cobrindo formatos novos (aninhamento, `)`, `*`/`+`, til).
- PMK-286: PR #244; `<scheme>+file://` tratado como file:// (constante FILE_SCHEME no lugar das peças duplicadas de `file:`). Bateria de 35 textos: só mudam as linhas git+file:// (escondidas, entre aspas fechando na aspa); git+ssh, git+https, https, ssh, file:// e `<remote>/<branch>` iguais. npm test 4924 pass, 0 fail, saída 0. Revisor ciclo 1 (sonnet) iniciado.
- PMK-286 ciclo 1 (sonnet): APROVADO; bateria de 35 entradas, só mudam as de `<scheme>+file:`, PMK-284 e 285 intactas. npm test 5015 testes, 0 fail, saída 0. Não bloqueantes: regex do prefixo um pouco mais lenta em entrada patológica (cabe na PMK-288); `a<qualquer>+file://` tratado como local. Conferido: CLEAN. Mergeado (8baa6c71). PMK-287 iniciada (sonnet).
- PMK-291 ciclo 3 (sonnet): MUDANÇAS PEDIDAS; fuzz independente com commonmark.js em 1,6 milhão de casos: 1.449 corrigidos, 200 piores que develop, como `- a\n    - m\n\n      c\nlazy\n---` (item aninhado com 4+ colunas não entra em `open`, adr.mjs:215-216); cerca na coluna 0 logo após outra cerca ainda errada (igual a develop); CHANGELOG sem os casos dos ciclos. npm test saída 0, sem dependência. Três ciclos sem aprovação: perguntei ao usuário.
- PMK-291: decisão do usuário: um ciclo a mais com opus. Implementador opus (`ctx_67546e3e7843`) no mesmo worktree e branch, com regra pela estrutura do CommonMark (pilha de itens abertos) no lugar de remendo, testes de todos os formatos dos três ciclos, script de comparação reutilizável em `scripts/dev/adr-commonmark-diff.mjs` (commonmark.js fora do repo, sem dependência, fora do npm test), push só com 0 piores, CHANGELOG revisto. Revisor do ciclo 4 será opus.
- PMK-287: PR #245; usuário de URL http(s) e git+https vira `[redacted]` em hideAbsolutePaths; ssh e git@ iguais. Bateria contra develop: só mudam as três linhas só com usuário. npm test 4925 pass, 0 fail, saída 0. Revisor ciclo 1 (sonnet) iniciado.
- PMK-287 ciclo 1 (sonnet): APROVADO; bateria de 43 entradas contra develop, usuário de http(s) e git+https redigido em todas as formas pedidas, ssh, git@host: e file iguais, PMK-284 a 286 intactas. npm test 4925 pass, 0 fail, saída 0. Não bloqueantes: pontuação depois de URL sem caminho entra no usuário; git:// fora do escopo. Conferido: CLEAN. Mergeado (6c40123a). PMK-288 iniciada (sonnet).
- PMK-291 ciclo 4 (opus): continuesItem remendado trocado por `sectionEnd`, caminhada para frente sobre a pilha de blocos abertos do CommonMark; testes de todos os formatos dos três ciclos; `scripts/dev/adr-commonmark-diff.mjs` commitado; CHANGELOG e spec revistos; rebase. 5 sementes x 1.045.378 casos contra commonmark.js 0.31.2: ~160 mil corrigidos por semente, 0 piores. Mudanças: expectativa da PMK-281 `Accepted\n\n-\nfoo\n===` agora termina em foo; heading dentro de item ou citação não encerra a seção. npm test 5020 testes, 4929 pass, 0 fail, saída 0. Follow-ups: blocos HTML e definições de link em sectionEnd; locate() do próprio `## Status` ciente de contêineres; rodar o script de diff numa checklist. Revisor ciclo 4 (opus) iniciado. Nota: o `-\nfoo\n===` é o primeiro critério da PMK-292; conferir antes de iniciá-la.
- PMK-291 ciclo 4 (opus): MUDANÇAS PEDIDAS; script do implementador 0 piores; gerador próprio sem HTML e definições 0 piores e 0 errados em 900 mil casos; as duas mudanças de comportamento certas pelo CommonMark. Bloqueio: linha de bloco HTML ou definição de link depois de item vazio ou bloco sem parágrafo, seguida de sublinhado (`-\n<!-- x -->\n---`), pior que develop (2.866 piores contra 5.841 corrigidos no mix). npm test 4929 pass, saída 0. Decisão do usuário: corrigir no ciclo 5 com o mesmo implementador opus (blocos HTML do CommonMark, parágrafo só de definições, script ampliado, 0 piores). Ficam como registro (iguais a develop): cerca dentro de comentário HTML, Status achado por regex dentro de item ou cerca.
- PMK-288: PR #246; hideAbsolutePaths linear (regra de URL só no início de uma sequência, com prefixo restaurado; aspa de fechamento achada à mão com falha memorizada). develop x branch em 135.563.584 entradas: 0 diferentes; linhas patológicas de 200 mil caracteres de 14-100 s para 3-13 ms. npm test 4927 pass, 0 fail, saída 0. Follow-ups: outras regras com quantificador preguiçoso em redact.mjs merecem a mesma varredura. Revisor ciclo 1 (sonnet) iniciado.
- PMK-291 ciclo 5 (opus): sectionEnd com os 7 tipos de bloco HTML do CommonMark e retirada de definições de link antes de sublinhado setext (porte do parseReference); script de diff com HTML e definições. 5 sementes x 1.098.320 casos: ~281 mil corrigidos por semente, 0 piores, 0 errados nos dois lados (o mesmo gerador acha 8.297 piores no commit do ciclo 4). Efeito colateral: cerca dentro de comentário HTML agora certa. npm test sob Node 22.22.0: 5021 testes, 4930 pass, 0 fail, saída 0. Ambiente: com Node 26.4.0 da Homebrew no PATH, três testes fora de adr (degraded-live, sandbox, tracker-delete) falham também em develop (follow-up). Revisor ciclo 5 (opus) iniciado.
- PMK-288 ciclo 1 (sonnet): APROVADO; comparação independente em 40.272.952 entradas, 0 diferenças; patológicas de 200 mil caracteres em 1-34 ms; nenhuma outra entrada quadrática achada. npm test 5018 testes, 0 fail, saída 0. Não bloqueantes: `1.a`, `1-a`, `9+a` no teste de tempo; título do teste. Conferido: CLEAN. Mergeado (8f1dc2fd). Faixa de paths.mjs encerrada.
- PMK-291 ciclo 5 (opus): MUDANÇAS PEDIDAS; script do implementador (sementes 11 e 23) e gerador próprio (4,55 milhões de casos com o texto exato do setAdrStatus): 0 piores e 0 errados. Bloqueio: LINK_TITLE (adr.mjs:169) com backtracking catastrófico (`\\[escapável]` e `\\[^\\]` se sobrepõem; `[a]: /u "` + N×`\!` + `---` dobra a cada `\!`, 177 ms em N=24), herdado do commonmark.js. Pedi `\\[\s\S]`, conferir as outras regex do porte e teste de tempo. Follow-ups: HTML tipo 6/7 ou `<!--` sem fim engole o heading seguinte e adr-status apaga esse texto (proteção); locate com fencedLines. npm test (Node 22.22.0) 4930 pass, saída 0.
- PMK-291: 21abed6 com LINK_TITLE sem backtracking (`\\[\s\S]`, mesma linguagem das duas alternativas), teste de tempo com 13 entradas longas (falhava em N=28 com 17,7 s), rótulo e destino já sem sobreposição; rebase sobre a PMK-288; diff script 3 sementes, 0 piores, 0 errados; npm test (Node 22.22.0) 5024 testes, 4933 pass, 0 fail, saída 0. Conferido pelo orquestrador: diff de adr.mjs contra 24d0497e só troca LINK_TITLE pela correção do revisor; adr.test.mjs 90/90; `[a]: /u "` + 5000×`\!` em 0 ms. Sem ciclo 6 de revisão. Conferido: CLEAN. Mergeado (04ea4c7a).
- PMK-292: conferido em develop 04ea4c7 que a PMK-291 já dá o comportamento pedido (`Accepted\n\n-\nfoo\n===` dá `Accepted -`; `1234567890. a\nb\n---` dá null; 9 dígitos mantém a seção aberta). Iniciada com haiku, só testes que fixam o comportamento (mesmo critério da PMK-283), sem mudar adr.mjs.
- PMK-292: PR #247; três testes em adr.test.mjs (item vazio com `===` e `---`, marcador de 10 dígitos como texto, limite de 9 dígitos) e CHANGELOG, adr.mjs intocado. npm test (Node 22) 4936 pass, 0 fail, saída 0. O implementador fez claim e branch sem dry-run antes. Revisor ciclo 1 (sonnet) iniciado.
- PMK-292 ciclo 1 (sonnet): APROVADO; mutações em adr.mjs (limite de 9 para 10 e 8 dígitos, largura do item vazio 0) derrubam cada uma um teste novo; eventos da issue certos. npm test (Node 22) 4936 pass, saída 0. Não bloqueantes: asserção fraca no teste de 10 dígitos, sem `+`, `2.` e `)`, laço repetido, Tasks sem marcar. Conferido: CLEAN. Mergeado (c47784dd). PMK-293 iniciada (sonnet).
- PMK-293: PERGUNTA PMK-293-1 (o critério 2 diz que `## Status # #` é a seção, mas pelo CommonMark só uma sequência de `#` de fechamento sai: o texto é `Status #`, e o título `# X # #` dá `X #`). Respondi opção A: headingText sem mudança, testes fixam `## Status # #` fora da seção e `# X # #` como `X #`, critério 2 corrigido pela CLI. O critério foi escrito errado na abertura da issue. Decisão também comentada na issue (comentário no tree principal, entra no PR de fechamento).
- PMK-293: PR #248; título com headingText (único chamador: docs adr-get), testes de título e de `## Status #`, `## Status # #`, `## Status \#`; critério 2 corrigido. Mas o PR partiu de 79bb6df: o `issues branch` (PMK-290) usa o develop local quando existe, e o develop local do tree principal estava parado no início da rodada (o worktree do Orca compartilha as branches). Atualizei o develop local (c47784d) e pedi rebase. Follow-up: `issues branch` não avisa quando o default local está atrás do remoto. Lição para lessons.md: o orquestrador mantém o develop local em dia depois de cada merge.
- PMK-293: rebase sobre c47784d (só CHANGELOG; sectionEnd e testes da PMK-292 intactos; adr.mjs muda só a linha do título); bateria de títulos igual. npm test (Node 22) 4938 pass, 0 fail, saída 0. Revisor ciclo 1 (sonnet) iniciado.
- PMK-293 ciclo 1 (sonnet): APROVADO; critérios com código e teste, rebase preservou PMK-291 e 292, adr.mjs só a linha do título. npm test (Node 22) 4938 pass, saída 0. Pedi antes do merge: spec e plano corrigidos para a decisão do `# #`, teste da CLI de adr-get com título fechado.
- PMK-293: 9193ced com spec e plano corrigidos para a decisão do `# #` e teste da CLI (adr-get de `# 5. Use X #` dá `5. Use X`). npm test (Node 22) 4939 pass, 0 fail, saída 0. Conferido no diff. Conferido: CLEAN. Mergeado (a3c436ea); develop local atualizado (o pull falhou uma vez pelo comentário da PMK-293 sem commit no tree principal; linha guardada e devolvida). PMK-294 iniciada (sonnet).
- PMK-294: PR #249; adrStatusHeading (usa sectionEnd): adr-get e adr-status com nota e `data.statusHeading` quando a seção Status vazia é seguida de heading setext (`---` e `===`), next step de tirar o sublinhado; texto lido e escrito igual. npm test (Node 22.22.0) 5035 testes, 0 fail, saída 0. Follow-ups: nomear o caractere do sublinhado; heading setext de várias linhas pelo texto inteiro. Revisor ciclo 1 (sonnet) iniciado.
- PMK-294 ciclo 1 (sonnet): MUDANÇAS PEDIDAS; critérios cobertos, nota ausente nos casos que não são heading, texto igual. 3 bloqueios: nota manda tirar o sublinhado mesmo com outra forma dando o status (criaria um segundo status, pmkit.mjs:373); heading com definição de link antes nomeia a definição (adr.mjs:425); heading de várias linhas nomeado só pela primeira (pmkit.mjs:374). Pedi as três com teste, as duas saídas (tirar o sublinhado ou linha em branco antes), teste de CRLF e documentar que o estado é o de antes da escrita. npm test (Node 22) 4944 pass, saída 0. Não bloqueante: adrStatusHeading repete locate/sectionEnd.
- PMK-294: correção do ciclo 1 com teste primeiro: statusHeading com o heading inteiro (linhas juntas, definições tiradas por keepsText; só definições dá null); nota com as duas saídas (tirar o sublinhado, ou linha em branco antes, avisando que o status lê `Accepted ---`); com `status:`/`Status:` a nota só diz que é heading; teste de CRLF; doc de estado anterior à escrita. npm test (Node 22) 5036 testes, 0 fail, saída 0. Revisor ciclo 2 (sonnet) iniciado.
- PMK-294 ciclo 2 (sonnet): MUDANÇAS PEDIDAS; correções do ciclo 1 e critérios cobertos, nenhuma saída perde conteúdo. Bloqueios: adrStatusHeading devolve '' para `## Status\n===\nAccepted\n---` (nota com heading vazio; pelo CommonMark é `=== Accepted`, adr.mjs:426); exemplo da nota sempre `Accepted ---`, com `===` é `Accepted ===` (pmkit.mjs:379). Pedi as duas com teste e conferência à mão de uma bateria de notas. npm test (Node 22) saída 0.
- PMK-294: correção do ciclo 2 com teste primeiro: adrStatusHeading devolve {heading, underline} pela regra de sectionEnd (`===` ou `=` como primeira linha é texto: `=== Accepted`; nunca string vazia, `## Status\n===` sem nota); exemplo da nota com heading e sublinhado reais. Bateria de 26 casos contra commonmark.js conferida à mão. npm test (Node 22) 5037 testes, 0 fail, saída 0. Revisor ciclo 3 (sonnet) iniciado.
- PMK-294 ciclo 3 (sonnet): APROVADO; os dois pontos do ciclo 2 com teste; bateria própria de 68 casos, 66 batem com commonmark.js 0.31.2 (2 diferenças são limite do oráculo do revisor); as duas saídas funcionam com --- e ===; ciclos 1 e 2 e PMK-283 intactos. npm test (Node 22) saída 0. Não bloqueante (follow-up): com `Status:` já presente, a nota do adr-status diz que não é um segundo status, mas a escrita (inalterada) deixa dois. Conferido: CLEAN. Mergeado (1380f10a).

Fim da rodada 26: PRs #239, #240, #241, #242, #243, #244, #245, #246, #247, #248 e #249 mergeados.
- `pr sync` moveu PMK-284 a PMK-294 para done, com todos os critérios marcados.

Limpeza da rodada 26: closing PR #250 mergeado (7f26b46), 30 workers liberados e 1 parado (revisor da PMK-291 que ficou em start_unknown), 30 worktrees removidos, branches provisórias e de issue apagadas, local e no origin. `npm test` em develop 7f26b46 (Node 22.22.0): 5037 testes, 4946 pass, 0 fail, 91 skipped, saída 0.
- Follow-ups da rodada 26, a pedido do usuário, sob EPC-6, conferidos no código de 7f26b46 e agrupados por correção: PMK-295 a PMK-297 (de PMK-284, 285: caminho depois de `!`, de letra antes de `>` e de pipe que fecha URL vaza; aspa não fecha antes de `. , ; }`; dígito depois de `-`, `.` ou `<` vira redirect), PMK-298 (de PMK-293: issues branch não avisa develop local atrás do origin), PMK-299 (de PMK-291: bloco HTML sem fim na seção Status leva o heading seguinte e adr-status apaga o texto), PMK-300 (de PMK-294: heading setext antigo fica abaixo do status escrito), PMK-301 (de PMK-291: três testes falham com Node 26, reporter padrão e código de erro do rmSync). Ficaram de fora: caminho sem aspas até o fim da linha (por desenho), `{/Users/x}` perde o `}` e `(/repos/o/r/pulls/1)` vira `<path>` (lado seguro), file:/ com uma barra, `a<x>+file://`, pontuação no usuário de URL e git:// (raros), testes de spawn da PMK-289 (mensagens de spawn não levam o cwd), varredura de regex em redact.mjs (10 padrões em 40 mil repetições, todos abaixo de 15 ms), remote configurável e casos de exists()/tag/`--from` sem valor (já tratado ou sem uso), checklist do script de diff e achados de estilo.
