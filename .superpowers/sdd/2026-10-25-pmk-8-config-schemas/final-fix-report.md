# PMK-8 final review fixes

1. setup.md: step 2 now says a problem in .issues/config.yaml makes init --update refuse. The refusal sentence moved to step 3.
2. config.mjs: the shape checks show the value found, for example `auto_commit must be true or false, found "yes"`. The member map message and the member id message give an example. Tests updated.
3. README.md and the init summary mention the schema line.
4. Schema descriptions for estimate.unit and member email filled in.
5. Null member: kept the refusal. `discover` reads `local.members[id].name` at scripts/lib/local/tracker.mjs:558, which throws on a null member. scripts/lib/actor.mjs:13 is safe (`?.`), but actor.mjs:17 returns the null member. Schema and validator still agree (schemas.test.mjs: 27 pass).

npm test: 467 pass. validate: no problems.
