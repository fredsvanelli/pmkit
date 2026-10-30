---
id: PMK-174
title: Tick the Tasks checkboxes in /pmkit:issues:progress
type: feature
status: backlog
priority: medium
estimate: 3
created: 2026-10-30T19:21:41.605Z
updated: 2026-10-30T19:21:41Z
---

## Description

### Context

`/pmkit:issues:create` now writes a Tasks section with `- [ ]` checkboxes in the description (PR #76). `/pmkit:issues:progress` only ticks acceptance criteria, and `issues update --check` only reaches criteria too. When the work is done, the tasks stay unchecked, so a finished issue looks unfinished. The only way to tick a task today is to rewrite the whole description with `--description-file`.

### Scope (in)

- `/pmkit:issues:progress` offers the open tasks that look done, next to the criteria, and ticks the ones the user approves
- A way in pmkit to tick and untick one task of an issue, on the Local tracker and on Linear
- The preview shows the ticked tasks before anything is written

### Out of scope

- Tasks written in a section other than `### Tasks`
- Ticking tasks from other commands, such as `/pmkit:issues:work`
- Changing how acceptance criteria are ticked

### Tasks

- [ ] Let pmkit tick and untick one task in the Tasks section of an issue
- [ ] Offer the open tasks in `/pmkit:issues:progress` and tick the approved ones
- [ ] Cover the new flow in the progress scenario

## Acceptance criteria

- [ ] /pmkit:issues:progress lists the open tasks that look done and asks which to tick
- [ ] An approved task shows as - [x] in the description, and the rest of the description does not change
- [ ] A task can be unticked again
- [ ] An issue with no Tasks section behaves as it does today
