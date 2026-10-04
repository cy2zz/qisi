# Chat feedback recovery delta (qisi-3.1 / B07)

## ADDED Requirements

### Requirement: Bounded internal recovery before neutral feedback
WHEN Strategy violates the selected help depth, trusted fact references or pre-render policy, the service SHALL allow at most one shared Strategy/Schema repair within the existing turn budget and SHALL revalidate the repaired output.

#### Scenario: Strategy remains invalid
- GIVEN an ordinary attempt and a Strategy outside L1
- WHEN the one permitted repair also fails
- THEN no Renderer candidate SHALL be shown; the response SHALL describe system unavailability, not mark the student incorrect, and SHALL name existing explanation actions.

### Requirement: Evidence-aware Guard without private Renderer context
The service SHALL provide confirmed student evidence and decision meanings to Guard; it SHALL NOT provide private reference, raw diagnosis or Guard notes to Renderer, including rewrite requests.

#### Scenario: Revise followed by accept
- GIVEN a revise verdict with private reviewer notes
- WHEN budget permits a rewrite plus a fresh Guard call
- THEN only code-authored correction instructions SHALL reach Renderer, and only the final approved message SHALL be committed/streamed.

#### Scenario: Unknown or repeated rejection
- GIVEN Guard unknown, or a second non-approved message after the one rewrite
- THEN no additional rewrite SHALL occur; finish_problem SHALL remain unknown and no disclosure audit SHALL be granted.

### Requirement: Probe cap cannot be bypassed by null metadata
WHEN the current canonical goal has two shown probes, the service SHALL reject a new probe or ask action even with probe=null, SHALL NOT reset counters or switch goals to repeat the probe, and SHALL offer explanation or neutral pending feedback.

### Requirement: Every attempt is budgeted and auditable
All model attempts SHALL count against 7 calls, 24000 input tokens, 8000 output tokens, 90-second turn and 25-second node limits. Unknown usage SHALL be conservative, failures SHALL not refund attempts, failed schema output SHALL be null in audit with usage retained, and cancellation SHALL prevent late output from continuing or committing.

#### Scenario: Insufficient budget for a rewrite pair
- GIVEN six calls consumed by diagnosis, route review/Guard, strategy, Renderer and message Guard
- WHEN the message needs rewriting
- THEN no half rewrite pair SHALL start and the response SHALL be neutral.

## Verification limits
Unit and real Nest/Supertest use synthetic ModelPort and mocked Store. They are not true-model, MySQL8.4, independent-review or student-outcome evidence. Refer to B07 handoff and acceptance artifacts for actual commands/results.
