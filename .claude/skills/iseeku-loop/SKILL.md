---
name: iseeku-loop
description: Work ISeekU to done — read the map, take the next open ticket, build it to the project's standard, prove it, update the map, repeat until nothing is open.
---

# The ISeekU loop

`PLAN/MAP.md` holds the destination and what is still open. This loop closes
those tickets one at a time and stops when there are none. It exists because
"build the rest of it" is more than one session can hold, and a loop without a
written map re-decides settled questions every time it wakes up.

## The cycle

**1. Orient.** Read `PLAN/MAP.md` — the Destination, then Decisions so far,
then Open. Two minutes here saves an hour of rebuilding something that was
already ruled out. Check `Out of scope` before starting anything that feels
large: Android, the original `.swf` games and OMEMO are settled as *not this
project*, and re-opening them is the most expensive mistake available.

**2. Choose one ticket.** The one that unblocks the most others, not the
easiest. A ticket in `PLAN/tickets/` holds the detail; the map only gists it.
If a ticket turns out to be two tickets, split it and say so.

**3. Build it.** House rules, in force:

- Pure logic goes in a module free of I/O, so it tests without Electron.
- Every module opens with a comment explaining **why it exists and what the
  hard part was** — the trap avoided, not a list of functions. Match
  `electron/lib/icq-skn.js` and `electron/lib/icq-theme.js`.
- Domain words from `CONTEXT.md`: Contact List, Owner, UIN, Event.
- British spelling in prose.
- No new npm dependency without stating the case first. Node stdlib wins.
- No placeholders, no TODO comments, no abstraction ahead of a second caller.
- Untrusted input — a file from a skin archive, a move from the opponent's
  client, a caps hash from a Contact — is validated at the boundary and
  refused with a reason, never guessed at.

**4. Prove it.** Not "should work".

```bash
npx jest --config jest.electron.config.js
```

```bash
CI=true npx react-scripts test --watchAll=false
```

Both green, with the output read, before the ticket is closed. Tests are
sentences describing behaviour. A test that would pass against a broken
implementation is worse than no test — the question to ask each one is *what
break would this catch?*

**5. Check it against the standards.** Run the `coding-standards` skill over
what changed. For anything a person looks at — a component, a menu, the
README — run `impeccable` as well; the whole point of this project is that it
looks like ICQ rather than like default AI output.

**6. Close the ticket and update the map.** Move the line from `Open` to
`Decisions so far` with a one-line gist of the answer. If the work revealed
something that must be decided later, add it to `Not yet specified` rather
than leaving it in your head. If it revealed something out of reach, put it in
`Out of scope` with the reason.

**7. Commit.** Conventional commits. The body says what was hard and why the
approach was chosen — a commit that only restates the diff is wasted.

**8. Repeat** from step 1 until `Open` is empty.

## Verify before claiming done

The rule this project keeps breaking and re-learning: run the command, read the
output, *then* say it works. Applies to tests, to the build, to a downloaded
file being what it claims. The flower colours were wrong for a week because
they came from a website palette instead of a measurement; the release was
"building" while `gh` was pointed at the upstream repo.

When a claim can be checked, check it.

## When something is genuinely blocked

Say so in the map, in the ticket, and to the Owner — with what would unblock
it. A ticket that needs a decision only the Owner can make (TURN relay, and
what it costs) is not a failure; carrying on and guessing is.

Finish everything that is *not* blocked before raising it.

## Done

`Open` is empty, both test suites are green, the README sells what exists, and
every honest limit is written where a user will meet it rather than buried.
