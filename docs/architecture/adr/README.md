# Architecture decision records

One file per design decision that a reader of the code would otherwise have
to reverse-engineer: a rule, a data-model choice, a concurrency strategy.
Number them in order. Never renumber or delete one. When a decision changes,
add a new ADR that supersedes the old one, and set the old one's status to
"Superseded by ADR-NNNN".

| ADR | Decision | Story | PR |
|---|---|---|---|
| [0001](0001-15-minute-booking-units-with-setup-and-turnaround.md) | Book venues in 15-minute units, with the venue's setup and turnaround around each booking | SPM-93 | #41 |
| [0002](0002-lock-venue-row-for-conflict-checks.md) | Lock the venue row while checking a booking for conflicts | SPM-44 | #37 |
| [0003](0003-flag-affected-arrangements-instead-of-changing-them.md) | Flag the arrangements an event change affects, never change them | SPM-62 | #40 |

## Template

```markdown
# ADR-NNNN: <decision, as a sentence>

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN
- **Date:** YYYY-MM-DD
- **Story:** SPM-NN <title>
- **Pull request:** #NN
- **Requirement:** <customer change, discussion board numbers>

## Context
What forced a decision: the requirement, the constraint, what was there before.

## Decision
What we do now, specific enough to check the code against.

## Alternatives considered
Each option not taken, and why.

## Consequences
What this makes easier, harder, or now required of later work.
```
