# PMK-279: report a failing git rev-parse for a tracker outside the repository (design)

Small change, design agreed from the issue (no open business rule).

- **Intent:** `commitTracker` treats every `git rev-parse --show-toplevel` failure in an outside tracker folder as "not in a git repository", so a bad gitconfig or missing git reads as "nothing was committed" with no error.
- **Goals:** only git's "not a git repository" keeps the current note. A spawn error or any other failure becomes `UPSTREAM`, with git's message through `hideAbsolutePaths`, in the same shape as `commitIn`'s `fail` ("the write succeeded but auto_commit failed: ...", next step "Commit ... yourself", `error.written` set by the caller), so text and JSON say the write happened and the commit did not.
- **Non-goals:** trackers inside the repository; changing `commitIn`.
- **Approaches:** (a) throw from `commitTracker` at the first failing `rev-parse` (chosen: same pattern as `commitIn`, one throw site); (b) collect failures into notes (rejected: a note is what hid the failure).
- **Builder's call:** the throw happens in the loop, so files of groups found earlier are not committed; the hint names the tracker folder, never an absolute path.
