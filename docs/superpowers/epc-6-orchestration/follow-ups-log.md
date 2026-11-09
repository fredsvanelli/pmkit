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
