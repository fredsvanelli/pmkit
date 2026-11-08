Siga o fluxo de `AGENTS.md`. Rode os passos 1 a 9 de `commands/issues/work.md` com `node scripts/pmkit.mjs` como CLI. No passo 7, use `superpowers:brainstorming` e depois `superpowers:writing-plans`, com spec e plano em `docs/superpowers/`. No passo 8, use `superpowers:executing-plans` em execução inline, sem criar sub-agents, junto com `superpowers:test-driven-development`. Antes de abrir o PR, use `superpowers:verification-before-completion`.

Regras:
- Não use `AskUserQuestion`. Em cada ponto de confirmação, escolha a opção que fizer mais sentido e siga em frente. Faça o dry-run e depois a escrita real. Poste o plano como comentário na issue.
- Rode `git fetch origin` antes do passo 6. A branch parte de `origin/develop`.
- Todo commit leva o ID da issue, por exemplo `feat(issues): add issues delete (PMK-52)`, e termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. As mudanças que a CLI fizer em `.issues/` entram em commit na própria branch.
- O corpo do PR termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- O PR só abre com `npm test` passando, rodado em primeiro plano e com código de saída 0.
- Pule o passo 10. Liste os follow-ups candidatos no relatório.
- Se precisar de uma regra de negócio que não dá para tirar do código, do README, de `docs/`, das ADRs ou de issues parecidas, pare, devolva o bloco abaixo e espere a resposta.

```
PERGUNTA <ID>
Contexto: <o que você está fazendo e onde travou>
Opções: <2 a 4 opções concretas>
Recomendação: <a sua escolha e o motivo>
Por que não decido sozinho: <o que falta>
```

Se o orquestrador pedir mudanças da revisão ou um rebase, faça na mesma branch, rode `npm test` e dê push.

Leia e siga também o bloco de lições em `docs/superpowers/epc-6-orchestration/lessons.md`.

Relatório final, em até 15 linhas: link do PR, status da issue, decisões tomadas nos pontos de confirmação, resultado do `npm test` e follow-ups sugeridos.
