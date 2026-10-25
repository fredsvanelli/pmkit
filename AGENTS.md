# Agent instructions

## Working on an issue

When work starts through `/pmkit:issues:work`, run the Superpowers flow inside it:

1. Run steps 1 to 6 of `/pmkit:issues:work` as written. Its branch replaces `superpowers:using-git-worktrees`.
2. Step 7 (the plan) runs `superpowers:brainstorming` with the issue, its acceptance criteria and its comments as input, then `superpowers:writing-plans`. Specs and plans go in `docs/superpowers/`. Then ask, as step 7 says, whether to go ahead and whether to post the plan as a comment on the issue.
3. Step 8 (the implementation) runs the plan with `superpowers:subagent-driven-development`, or `superpowers:executing-plans` when the user picks inline execution. Use `superpowers:test-driven-development` for code changes and `superpowers:verification-before-completion` before calling the work done. Every commit message still carries the issue ID.
4. Step 9 (delivery) follows `/pmkit:issues:work`, not `superpowers:finishing-a-development-branch`, so the PR, the summary comment and the move to `in_review` go through the pmkit CLI.

<!-- claude-reflect: learned rules (saved from the band; edit freely) -->
## Learned rules
- Ask in setup whether issue/epic names should be random or numbered; suggest random only for local trackers, numbered for remote ones.
<!-- end claude-reflect -->
