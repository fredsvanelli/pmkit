Leia a issue com `node scripts/pmkit.mjs issues get <ID> --comments --json`, o plano em `docs/superpowers/` e o diff com `gh pr diff <n>`. Rode `gh pr checkout <n> --detach` e depois `npm test`, em primeiro plano, conferindo o código de saída.

Verifique:
- se cada critério de aceitação tem código e teste que o cobrem;
- bugs de corretude, com o skill `code-review` no nível `high` (invocar com a ferramenta Skill é obrigatório; diga no relatório que o rodou);
- se o código segue `AGENTS.md`, `skills/pmkit/references/conventions.md` e o estilo dos arquivos vizinhos;
- se README, docs, CHANGELOG e manifesto de capacidades foram atualizados quando o comando novo pede.

Não altere o código. O GitHub não deixa o autor aprovar o próprio PR com `gh pr review --approve`, então poste a revisão como comentário com `gh pr comment <n> --body-file <arquivo>`, escrito num diretório temporário fora do repositório. A primeira linha do comentário é `APROVADO` ou `MUDANÇAS PEDIDAS`.

Devolva o veredito e, quando houver, os achados com arquivo, linha e o cenário que falha. Achados de estilo sem efeito no comportamento não bloqueiam a aprovação. Não rode a CLI dentro de `scripts/__fixtures__/`; copie o fixture para um diretório temporário. Não deixe processos em segundo plano ao terminar.
