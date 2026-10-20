// ARCHIVED 2026-10-19 - not run. tests/archive/ is excluded from Vitest,
// Playwright, TypeScript and ESLint; this file is kept as the record of a test
// whose behaviour was changed on purpose. See docs/test-cases/DECOMMISSIONED.md.
//
// Moved from: src/app/__tests__/event-readiness-page.test.tsx
//   describe "Event Readiness tab (SPM-33) > the Operational Safety Check"
// Why: it checked the Readiness tab from before SPM-88, when Confirm event did
//   not wait for the Operational Safety Check and the tab said so. Since SPM-88
//   (Week 7 Change #6: "The event cannot proceed to preparation until the Safety
//   Officer has approved it"; SPM-88 AC8) the server marks every arrangement,
//   the safety check included, as blocking confirmation
//   (src/lib/eventConfirmation.ts, safetyRow: blocksConfirmation: true), so the
//   state this test sets up can no longer happen.
// Replaced by, in the same file:
//   "[SPM-33][AC6][AC11] counts a check awaiting review as blocking, without saying Confirm does not wait"
//   and, for the rule itself, src/lib/__tests__/eventConfirmation.test.ts
//   "[SPM-88][AC8][AC9] SPM-88-TC13: stops confirmation while the check was never submitted".
// It used the file's helpers (open, row, safety, auditorium) and is kept as written.

it("[SPM-33][AC6] says Confirm does not wait for it yet, and leaves it out of the count", async () => {
  open([auditorium, safety("safety_not_submitted")]);

  expect(await row("Operational Safety Check")).toHaveTextContent("Confirm event does not wait for it yet.");
  expect(await screen.findByText("Nothing is blocking confirmation")).toBeInTheDocument();
});
