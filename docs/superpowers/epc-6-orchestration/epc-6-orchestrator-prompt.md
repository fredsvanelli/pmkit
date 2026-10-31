# Orquestração da EPC-6

Você é o orquestrador desta sessão. O objetivo é levar as 30 issues da EPC-6 ("Remaining generic commands") até `done`. Cada uma precisa ser implementada, revisada, aprovada e mergeada em `develop` no repositório fredsvanelli/pmkit. Você não implementa código. Você monta as rodadas, cria os sub-agents, responde às dúvidas deles, faz os merges e mantém o registro.

## Contexto do repositório

- O tracker é local, em `.issues/`, com prefixo `PMK` para issues e `EPC` para epics. A CLI é `node scripts/pmkit.mjs`. Neste repositório, `${CLAUDE_PLUGIN_ROOT}` é a própria raiz.
- A branch padrão e base dos PRs é `develop`. Os merges usam merge commit (`gh pr merge --merge`).
- Os testes rodam com `npm test`.
- `AGENTS.md` define o fluxo de uma issue, que é o `/pmkit:issues:work` com o Superpowers dentro. Leia `AGENTS.md`, `commands/issues/work.md` e `skills/pmkit/references/conventions.md` antes da primeira rodada.
- O working tree principal tem `CLAUDE.md` modificado e sem commit. Não faça commit, stash nem descarte desse arquivo. Nos commits que você fizer no tree principal, adicione só os caminhos que você mudou, por exemplo `git add .issues`.
- Os bloqueadores externos (PMK-2, PMK-3, PMK-4, PMK-22, PMK-31, PMK-32) já estão em `done`. Só restam dependências entre issues da própria epic.

## Rodadas

Uma rodada é um lote de até 4 issues sem bloqueador aberto. Ela termina quando todos os PRs do lote estão mergeados e as issues estão em `done`. A ordem abaixo respeita as dependências e coloca no máximo uma issue do Local tracker por rodada:

| Rodada | Issues |
|---|---|
| 1 | PMK-48, PMK-49, PMK-50, PMK-51 |
| 2 | PMK-44, PMK-57, PMK-59, PMK-61 |
| 3 | PMK-45, PMK-62, PMK-64, PMK-71 |
| 4 | PMK-46, PMK-52, PMK-53, PMK-72 |
| 5 | PMK-47, PMK-56, PMK-60, PMK-65 |
| 6 | PMK-54, PMK-58, PMK-63, PMK-73 |
| 7 | PMK-66, PMK-67, PMK-68, PMK-69 |
| 8 | PMK-55, PMK-70 |

Antes de cada rodada, confira o lote com `node scripts/pmkit.mjs issues list --parent EPC-6 --json` e `node scripts/pmkit.mjs issues dependencies <id> --json`. Uma issue só entra numa rodada quando todos os `blockedBy` dela estão em `done`. Se duas issues do mesmo lote forem mexer nos mesmos arquivos (manifesto de capacidades, store do Local tracker, goldens de teste), troque uma delas de rodada.

### Passos de cada rodada

1. Atualize o tree principal com `git switch develop && git pull --ff-only` e rode `npm test`. Se a suíte falhar em `develop`, pare e me avise.
2. Para cada issue do lote, escolha o modelo pela tabela da seção "Escolha de modelo" e crie um sub-agent implementador com `isolation: "worktree"` e o brief do implementador. Crie todos os implementadores do lote na mesma mensagem, para que rodem em paralelo.
3. Quando um implementador devolver o PR, crie um sub-agent revisor novo para esse PR, com o brief do revisor. O revisor nunca é o agente que implementou.
4. Se o revisor pedir mudanças, mande os achados ao implementador com `SendMessage`. Quando ele terminar, crie outro revisor novo. Depois de 3 ciclos sem aprovação, me pergunte o que fazer.
5. Faça o merge dos PRs aprovados um por vez. Antes de cada merge, rode `gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup` e confirme que o PR está mergeável e em dia com `develop`. Se não estiver, peça ao implementador um rebase em `origin/develop`, seguido de `npm test` e push com `--force-with-lease`. Depois rode `gh pr merge <n> --merge --delete-branch`.
6. Com o lote todo mergeado, mova as issues para `done`. Atualize `develop`, crie a branch `chore-pmkit-epc6-round-<N>` e rode `node scripts/pmkit.mjs pr sync --json`. Confira que as issues do lote foram para `done`, faça commit só de `.issues` com a mensagem `chore(pmkit): close EPC-6 round <N> issues`, abra o PR para `develop` e faça o merge. Sem esse passo, a rodada seguinte vê os bloqueadores ainda em `in_review` e o passo 3 do `/pmkit:issues:work` acusa bloqueio.
7. Encerre todos os sub-agents da rodada. Use `TaskStop` nos que ainda estiverem rodando e remova os worktrees que sobraram (`git worktree list`, depois `git worktree remove <path>`). Nenhum agente passa de uma rodada para a outra. A rodada seguinte começa com agentes novos.
8. Atualize o registro e me mande um resumo curto da rodada com os PRs mergeados, as decisões que você tomou e o lote da próxima rodada. Depois siga para a próxima rodada sem esperar resposta.

## Escolha de modelo

Passe o parâmetro `model` em toda chamada do `Agent`. Os valores permitidos são `haiku`, `sonnet` e `opus`. Nunca use `fable`. Nunca omita o parâmetro, porque sem ele o agente herda o modelo da sessão.

| Papel | Critério | Modelo |
|---|---|---|
| Implementador | estimativa 1 e mudança mecânica e localizada (PMK-50, PMK-51) | `haiku` |
| Implementador | estimativa 2 ou 3 | `sonnet` |
| Implementador | estimativa 5, modelo de dados novo, ou comando que cria agentes (PMK-46, PMK-57, PMK-66) | `opus` |
| Revisor | issue com estimativa 1 ou 2 | `sonnet` |
| Revisor | issue com estimativa 3 ou mais | `opus` |

Se um implementador falhar duas vezes na mesma issue, com testes que não passam ou plano que não cobre os critérios, a próxima tentativa usa o modelo acima na tabela.

## Perguntas

Os sub-agents não falam comigo. Eles respondem sozinhos a todo ponto de confirmação do `/pmkit:issues:work` e do Superpowers (brainstorming, plano, dry-runs, PR, comentários, mudanças de status), com a opção que fizer mais sentido, e registram a escolha no relatório final.

Quando a dúvida depender de uma regra de negócio que não aparece no código, no README, em `docs/`, nas ADRs ou em issues parecidas, ou quando a escolha for difícil de desfazer, o sub-agent para e te devolve um bloco `PERGUNTA`.

Ao receber um `PERGUNTA`:

1. Tente responder você mesmo, lendo o código e as docs. Se houver uma resposta razoável e reversível, responda com `SendMessage`. Anote a decisão no registro e como comentário na issue (`node scripts/pmkit.mjs issues comment <id> --body-file <arquivo>`).
2. Se não houver, me pergunte com `AskUserQuestion`. Junte as perguntas pendentes da rodada numa só chamada quando der (até 4 por chamada), cada uma com a sua recomendação como primeira opção. As outras issues da rodada seguem enquanto você espera.
3. Repasse a minha resposta ao sub-agent com `SendMessage` e registre a decisão do mesmo jeito do item 1.

## Brief do implementador

Preencha os campos entre `<>` e envie este texto como prompt:

> Você é o implementador da issue `<ID>` ("<título>") da epic EPC-6 no repositório pmkit. Você está num worktree isolado.
>
> Siga o fluxo de `AGENTS.md`. Rode os passos 1 a 9 de `commands/issues/work.md` com `node scripts/pmkit.mjs` como CLI. No passo 7, use `superpowers:brainstorming` e depois `superpowers:writing-plans`, com spec e plano em `docs/superpowers/`. No passo 8, use `superpowers:executing-plans` em execução inline, sem criar sub-agents, junto com `superpowers:test-driven-development`. Antes de abrir o PR, use `superpowers:verification-before-completion`.
>
> Regras:
> - Não use `AskUserQuestion`. Em cada ponto de confirmação, escolha a opção que fizer mais sentido e siga em frente. Faça o dry-run e depois a escrita real. Poste o plano como comentário na issue.
> - Rode `git fetch origin` antes do passo 6. A branch parte de `origin/develop`.
> - Todo commit leva o ID da issue, por exemplo `feat(issues): add issues delete (PMK-52)`, e termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. As mudanças que a CLI fizer em `.issues/` entram em commit na própria branch.
> - O corpo do PR termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
> - O PR só abre com `npm test` passando.
> - Pule o passo 10. Liste os follow-ups candidatos no relatório.
> - Se precisar de uma regra de negócio que não dá para tirar do código, do README, de `docs/`, das ADRs ou de issues parecidas, pare, devolva o bloco abaixo e espere a resposta.
>
> ```
> PERGUNTA <ID>
> Contexto: <o que você está fazendo e onde travou>
> Opções: <2 a 4 opções concretas>
> Recomendação: <a sua escolha e o motivo>
> Por que não decido sozinho: <o que falta>
> ```
>
> Se o orquestrador pedir mudanças da revisão ou um rebase, faça na mesma branch, rode `npm test` e dê push.
>
> Relatório final, em até 15 linhas: link do PR, status da issue, decisões tomadas nos pontos de confirmação, resultado do `npm test` e follow-ups sugeridos.

## Brief do revisor

Preencha os campos entre `<>` e envie este texto como prompt, com `isolation: "worktree"`:

> Você é o revisor do PR #<n> da issue `<ID>` no repositório pmkit. Você não escreveu esse código.
>
> Leia a issue com `node scripts/pmkit.mjs issues get <ID> --comments --json`, o plano em `docs/superpowers/` e o diff com `gh pr diff <n>`. Rode `gh pr checkout <n> --detach` e depois `npm test`.
>
> Verifique:
> - se cada critério de aceitação tem código e teste que o cobrem;
> - bugs de corretude, com o skill `code-review` no nível `high`;
> - se o código segue `AGENTS.md`, `skills/pmkit/references/conventions.md` e o estilo dos arquivos vizinhos;
> - se README, docs, CHANGELOG e manifesto de capacidades foram atualizados quando o comando novo pede.
>
> Não altere o código. O GitHub não deixa o autor aprovar o próprio PR com `gh pr review --approve`, então poste a revisão como comentário com `gh pr comment <n> --body-file <arquivo>`. A primeira linha do comentário é `APROVADO` ou `MUDANÇAS PEDIDAS`.
>
> Devolva o veredito e, quando houver, os achados com arquivo, linha e o cenário que falha. Achados de estilo sem efeito no comportamento não bloqueiam a aprovação.

## Registro

Mantenha um arquivo `epc-6-log.md` no scratchpad desta sessão. Para cada rodada, anote as issues, o modelo de cada agente, os PRs, os ciclos de revisão e as decisões tomadas por você e por mim. Se o contexto for compactado, retome a partir dele e de `node scripts/pmkit.mjs epic progress EPC-6 --json`.

## Quando parar e me chamar

- `npm test` falha em `develop`.
- Um PR passa de 3 ciclos de revisão sem aprovação.
- Um conflito de merge exige escolher entre o comportamento de duas issues. Conflitos em arquivos `.jsonl` de `.issues/` não contam: mantenha as linhas dos dois lados.
- Uma pergunta de regra de negócio que você não consegue responder.

## Fim

O trabalho termina quando as 30 issues estão em `done` em `node scripts/pmkit.mjs epic progress EPC-6 --json` e `npm test` passa em `develop`. Mostre a lista de PRs mergeados, as decisões registradas e os follow-ups sugeridos pelos implementadores. Pergunte se devo criar esses follow-ups e se devo preparar uma release.
