# PMK-161: handle nested splits in one cycle close

## Problem

Found in PMK-123. A split carries the original's open blockers and open sub-issues to the new issue (step 7 and step 8 of `/pmkit:cycle:close`). When a carried blocker or sub-issue is itself split in the same close, step 7 only warns in the preview and says what the result points to:

- **A carried blocker B that is split too.** The new issue A′ gets `B blocks A′`; then B's own split moves B to `done` with its delivered part, and B′ (B's remaining work) blocks nothing. A′ looks free to start while the work that blocks it is still open in B′.
- **A carried sub-issue S that is split too.** S moves under A′, then S's own split moves S to `done`, so A′'s sub-issue holds only the delivered part; and S′ is created under the original A (its create takes the parent from the step 3 read), a `done` issue.

The user is told to fix the links by hand after the close.

## Decision

**Remaining work points to remaining work; delivered work stays with delivered work.**

- When a carried blocker B is itself split in this close, the link goes from B′ to A′ (`issues link <B′> <A′> --kind blocks`), not from B. The original A keeps `B` in its `blockedBy`, both delivered.
- When a carried sub-issue S is itself split in this close, S (its delivered part, moved to `done`) stays under A (both delivered), and S′ moves under A′ (`issues parent <S′> <A′>`). S itself is not moved.

**Write order in step 8:** the moves (`cycle add`) first, as today; then every split's create, each noting its new ID; then, split by split, the `related` link, the `blocks` links and the parent changes, which can now name any new issue of this close; then every estimate update; then every move to `done`; the close last. A split's move to `done` stays after its own links and its estimate update.

## Approaches

1. **Creates first, then the links with the rule above (chosen).** Every new ID exists before any link names one, so no order between the splits matters, and a failure leaves each original unfinished until its own last write, which the rerun of PMK-160 finds by the creates' marks.
2. Order the splits so a blocker's or sub-issue's split runs before the split that carries it. It needs a dependency sort in the command file and still breaks on a cycle (A blocks B, B is a sub-issue of A).
3. Keep the warning. The issue asks for a rule.

## Design

- `commands/cycle/close.md` step 7: the bullet that warned about a carried blocker or sub-issue "itself split in this close" states the rule instead, and the preview shows `B′ → A′` and `S′ under A′` with "the new issue of <B>" for an ID that exists only after the create.
- `commands/cycle/close.md` step 8: the write order above; for a carried blocker or sub-issue that is itself split, the writes of the rule.
- `scripts/scenarios.test.mjs`: a static test that step 8 runs every split's create before the first link, and that step 7 states the rule for a carried blocker and a carried sub-issue that are split too.
- `scripts/__scenarios__/cycle-close.mjs`: a fourth scenario, `nestedSplits`. Setup raises ISS-4M2S to 2 points so it can split. The close splits ISS-2X6D (8 → 5, 3 left), its open blocker ISS-5N1R (3 → 1, 2 left) and its open sub-issue ISS-4M2S (2 → 1, 1 left), and moves ISS-8C4W to the backlog. `expect`: ISS-2X6D′ is blocked by ISS-5N1R′ and not by ISS-5N1R; ISS-4M2S′ is under ISS-2X6D′; ISS-4M2S is `done` under ISS-2X6D; the three originals are `done` with their delivered estimates; each new issue is related to its original.
- CHANGELOG.

## Interview

- Does a blocker outside the sprint, or one not split, change? No: the rule applies only to a carried blocker or sub-issue that this close splits; others are carried as before.
- What does the rerun of PMK-160 see after a failure between the creates and the moves? Every original still unfinished, and every new issue marked; step 6 finds each split and finishes its missing writes. The rule's links name new issues the rerun finds the same way.
- A blocker that is split and also blocks an issue that is not split: that issue keeps `B` as its blocker (B is `done` after the close). Out of scope; the close copies blockers only for a split.
- New terms or ADRs: none.
- Approval: the issue asks for a write order or a rule; this is the rule the preview already described as the wanted result. pmkit PO approves.
