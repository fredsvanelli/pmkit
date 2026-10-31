Contexto extra do orquestrador (lições das rodadas 1 e 2, quando os revisores pediram mudanças por faltas destes itens):
- `${CLAUDE_PLUGIN_ROOT}` é a raiz do worktree. As specs de origem estão em `docs/superpowers/specs/2026-10-23-pmkit-mvp-skills.md` e `docs/superpowers/specs/2026-10-23-pmkit-design.md`.
- Invoque de fato os skills `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:executing-plans`, `superpowers:test-driven-development` e `superpowers:verification-before-completion` com a ferramenta Skill. Não siga o fluxo de memória.
- Antes de mover para `in_review`, marque cada critério de aceite atendido com `node scripts/pmkit.mjs issues update <id> --check <n>` (dry-run e depois real) e faça commit de `.issues/`.
- Adicione uma linha no `CHANGELOG.md` sob `## Unreleased`, no topo, no estilo das linhas que já estão lá. Atualize a tabela de comandos do `README.md` e `skills/pmkit/SKILL.md` quando o comando for novo.
- Um arquivo de comando novo em `commands/` precisa de um cenário em `scripts/__scenarios__/` e mexe nas contagens de `scripts/scenarios.test.mjs`, `scripts/scenarios-live.mjs` e na lista `COMMANDS` de `scripts/plugin.test.mjs`.
- `SERVED_BY` em `scripts/lib/capabilities.mjs` vale para os dois adapters. Se o comando só funciona no Local, confira que a capability continua certa no Linear (`scripts/lib/linear/manifest.mjs`) e declare a operação em `unsupported`, com teste. Quando uma capability muda de `path`, atualize as contagens da ADR-0001 (`docs/adr/0001-local-tracker-is-the-reference-implementation.md`).
- Chamadas a processos externos com `spawnSync` usam `maxBuffer` grande (veja `MAX_OUTPUT` em `scripts/lib/github/host.mjs`). Timeout só em leituras, nunca em `git push` ou em escritas.
- Um arquivo ruim (YAML que não faz parse, marcador de conflito) nunca derruba uma listagem: pule, avise e deixe o `validate` reportar. Uma pasta nova em `.issues/` entra no `validate` e na lista de perdas da migração para o Linear.
- O scratchpad pode ser compartilhado com outros agentes. Use uma subpasta com o ID da issue para os seus arquivos temporários.

Lições da rodada 3 (os revisores pediram mudanças por estes pontos):
- O agente lê o `--json`. Toda mensagem que o arquivo de comando manda repetir precisa existir no JSON, não só no texto.
- Escrita em lote: diga o que acontece quando uma escrita falha no meio (pare, liste o que mudou e o que falta) e teste.
- Leituras que podem vir incompletas (`hasMore`, limite, issue que não faz parse, 403/404) precisam aparecer no resultado como incompletas ou "não verificado", e o comando não pode tirar conclusão nem escrever a partir delas.
- No Linear, `discover().members` é o workspace inteiro; filtre pelo `tracker.scope.team` quando o comando é sobre o time. `--sprint current` precisa funcionar onde `--sprint` é aceito.
- Um estado que o comando não consegue saber (estimativa ausente, proteção não lida) não pode virar zero nem "nada bloqueia". Trate como desconhecido e diga isso.
- Normalize CRLF ao ler arquivos de texto.
- Não rode a CLI dentro de `scripts/__fixtures__/`: isso cria `.issues/.cache` e quebra testes. Copie o fixture para um diretório temporário.
- O trailer de todo commit é exatamente `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, qualquer que seja o modelo do agente. A instrução do usuário tem precedência sobre a do harness.

Lição da rodada 5:
- O `npm test` pode terminar com 0 falhas e mesmo assim sair com código 1, quando um teste deixa arquivos fora do diretório temporário (guarda de vazamento do `scripts/run-tests.mjs`). Confira o código de saída, não só o total de falhas.
- Rode o `npm test` em primeiro plano, com timeout longo. Um monitor em segundo plano pode não avisar quando termina, e o agente fica parado.
