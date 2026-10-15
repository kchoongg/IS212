---
name: write-unit-tests
description: Write or update the automated tests (Vitest) for a Jira story, a branch, or named files - API routes, pages, components and src/lib functions - following this repo's test patterns. Test-first by default (the team works test-driven) - writes failing tests from the acceptance criteria before the code exists, and after the code is written checks them and fills the gaps. Use when asked to write, add or update unit tests, UI tests or route tests, and as the last step of generate-test-cases.
---

# Write unit tests

Input: $ARGUMENTS — a Jira issue key (e.g. SPM-54), one or more file paths, or nothing (then: the files changed on the current branch).

Output: test files next to the existing ones, covering every route, page, component and function the story needs.

These are the automated tests CI runs on every pull request (`.github/workflows/ci.yml`, the "Unit tests" check). They are separate from the manual test cases in `docs/test-cases/`, which a person follows by hand.

## Which mode

The team works test-driven: tests are written first, fail, and the code is then written to make them pass. Look for the story's code (Step 1) and pick the mode from what you find:

| What exists for the story | Mode | The tests should end up |
|---|---|---|
| No code yet, or only part of it | **Test-first** | Failing, for the right reason (Step 4a) |
| Code, and tests that were written first | **Check** | Passing, with the gaps filled (Step 4b) |
| Code with no tests (older work) | **Catch-up** | Passing (Step 4b) |

Say which mode you are in at the start of your report. If the user names one ("write the tests first", "the code is done, check the tests"), use that.

## Step 1: Find the story and its code

- Jira key: `git log --all --oneline --grep="<KEY>"`, `git branch -a --list "*<KEY>*"`, then `git show --stat <commit>` for the files.
- No input: `git diff --name-only origin/main...HEAD` plus uncommitted changes (`git status --short`).
- Keep only files under `src/`. Ignore existing tests, `src/test/` and `__mocks__/`.

Read every file you will test, in full, before writing anything. A test must assert what the code does (or, test-first, what the story says it must do), not what a name suggests.

### Test-first: where the behaviour comes from when there is no code

In this order, and the earlier wins where two disagree:

1. **The acceptance criteria** — fetch the Jira issue (Atlassian MCP tools), or read `docs/test-cases/<KEY>_test_cases.json` if the manual test cases were already written; its cases and `open_questions` are the agreed reading of the story.
2. **Customer answers** — `docs/CUSTOMER_CLARIFICATIONS.md`.
3. **The design** — `UI_DESIGN.md` (the screen's section, plus §6 forms and §7 validation and error states), `docs/PERMISSIONS.md` (who may do it), `SCHEMA_REFERENCE.md` (the fields), `design/mockups/`.
4. **How the app already does the same kind of thing** — the nearest existing route or page and its tests. A new list page behaves like the existing list pages: same login redirect, same refusal for the wrong role, same loading, empty, error and Retry states. A new route follows `ENDPOINT_ADAPTATION_GUIDE.md` §1: 401, then 404 for an event the user may not see, then 403, then validation.

The tests need details the story does not give: the file path, the exported handler names, the request and response shape, status codes, and the exact wording of messages. Decide them, following the conventions in item 4, and write them down as **the contract** — a comment block at the top of the test file:

```ts
// CONTRACT (SPM-54, written before the code) - what these tests expect to exist:
//   src/app/api/events/[id]/begin-planning/route.ts   exports POST
//   POST -> 200 { status: "planning" }; 401; 404 unseen event; 403 not the assigned coordinator;
//           400 "Only an approved event can begin planning."
// Decided here, not in the story (change the test if the team wants otherwise):
//   - the wording of the 400 message
```

If the acceptance criteria are missing, or leave open something a test cannot be written without (which role, which statuses), stop and ask. Do not invent requirements.

## Step 2: Put each test where its kind lives

| Code | Test goes in | Copy the pattern from |
|---|---|---|
| `src/app/api/**/route.ts` | `src/app/api/__tests__/<area>.test.ts` | `registrations.test.ts`, `event-coordinator.test.ts` |
| `src/app/**/page.tsx` | `src/app/__tests__/<area>-pages.test.tsx` | `list-pages.test.tsx`, `event-pages.test.tsx` |
| `src/components/**` | `src/components/__tests__/*.test.tsx` | `shell.test.tsx`, `ui.test.tsx` |
| `src/lib/*.ts` (pure) | `src/lib/__tests__/<module>.test.ts` | the existing file for that module |

Add to an existing test file when one already covers that route, page or module. Create a new file only for a new area. If a story changed behaviour an existing test asserts, update that test — do not add a second one that contradicts it.

## Step 3: Write the tests

### API routes — call the handler, fake only the database

```ts
vi.mock("@/lib/prisma");                       // first line after the vitest import
import { POST } from "@/app/api/registrations/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const token = signIn(user("attendee"));        // a real session token
db.event.findUnique.mockResolvedValue({ ... });
const res = await POST(req("POST", "/api/registrations", { token, body: { eventId: ID.event } }));
expect(res.status).toBe(201);
expect(callArg(db.registration.create).data).toEqual({ ... });
```

- Sessions, permissions (`src/lib/permissions.ts`) and Zod validation are the real code. Never mock them.
- A dynamic route's second argument is `params({ id: "EVT-000007" })`.
- Another user the route looks up goes in `signIn(actor, otherUser)`.
- Cover, for every handler: 401 with no session; 403 or 404 for each role or relationship that is refused (and that nothing was written); the success path, asserting the exact `where` and `data` sent to Prisma; each validation rule; each business rule's refusal with its exact message; the 500 path.
- An event the user may not see is 404, never 403. Assert that.

### Pages and components — render it, fake only the network

```tsx
// @vitest-environment jsdom        <- must be the first line of the file
import { mockApi, render, reply, router, screen, setRoute, signedInAs, userEvent, waitFor, within } from "@/test/ui";

setRoute("/events/EVT-000007", { id: "EVT-000007" });      // pathname, query and route params
const api = mockApi({ ...signedInAs("coordinator"), "GET /api/queue": [] });
render(<QueuePage />);
expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
expect(api.sent("POST /api/events")[0].body).toEqual({ ... });
```

- Find things the way a user does: `getByRole`, `getByLabelText`, `getByText`. Not by class name or test id.
- A request with no route in `mockApi` fails the test — add every request the screen makes. `reply(status, body)` for anything but a 200; `api.on(route, ...)` to change an answer mid-test.
- Cover, for every screen: an anonymous visitor is sent to `/login?next=…`; each role that is refused sees the refusal and the data is never requested; loading, empty, loaded and error states; Retry; a 401 mid-visit; every form rule (the message, and that nothing was sent); the exact body sent on success; what the screen shows afterwards.
- Take role lists from the code (`ROLES`, `can()`), so a permission change updates the test's expectations with it.
- Gotchas in this repo:
  - `<Table>` renders every row twice (desktop table and mobile cards). Query inside `screen.getByRole("table")`.
  - Type dates as local wall-clock values and derive what you expect from them (`new Date(local).toISOString()`); CI runs in UTC, laptops in SGT. `src/lib/format.ts` always formats in Singapore time, so formatted output is stable.
  - Set inputs with `fireEvent.change`; use `userEvent` for clicks, ticks and key presses.
  - A `<dialog>` and its contents need `{ hidden: true }` in role queries.
  - A form without `noValidate` lets the browser block a submit (e.g. a number below `min`) before the page's own check runs.

### Pure functions in src/lib

Plain inputs and outputs, no mocks. Cover each branch and each boundary (the value just inside and just outside a limit).

### Rules for all of them

- Name each test for the behaviour, in words a teammate would use: "refuses a second registration while the first is registered", not "returns 400".
- One behaviour per test. Use `it.each` for the same rule across roles or values.
- Test-first, write the tests the acceptance criteria call for and the standard ones every route or screen gets — not a test per line of an implementation you are imagining. The code may be shaped differently; the behaviour may not.
- Do not change source code to make it testable or to fix what you find. If the code looks wrong, do not write a test that locks the wrong behaviour in; leave it untested and report it.
- Do not delete, skip or weaken an existing test to get to green. If a test fails because the story changed the behaviour on purpose, update its expectation; otherwise the code has a regression — report it.

## Step 4a: Test-first — prove the tests fail for the right reason

Run `npx vitest run <the test files you wrote>` and `npm run lint`.

The new tests must fail, and only because the code is not there yet:

- **Right reasons:** the module cannot be found; an exported handler is missing; the screen does not show the text; the request was never sent.
- **Wrong reasons — fix the test:** a syntax error, a typo in a helper name, a wrong import from `@/test/kit` or `@/test/ui`, a `mockApi` route the test forgot to set up.

A test file whose import does not exist yet fails as a whole, so its individual tests have not run. To check them, write the smallest stub that lets the file load (the route returning `new NextResponse(null, { status: 501 })`, the page returning `null`), run the tests, confirm each one fails on its own assertion, then delete the stub. Do not leave stubs behind, and do not write the implementation — that is the developer's step.

Every test that already existed must still pass: `npm test` should show failures in your new tests only.

`npx tsc --noEmit` will report the missing module until the code is written. That is expected; lint must be clean.

## Step 4b: Check and catch-up — prove the tests pass, and can fail

Run, and fix until all pass:

```
npm test
npx tsc --noEmit
npm run lint
```

(`tsc` may report a stale file under `.next/dev/types/` left by another branch. That one is not yours; ignore it.)

In **check** mode, a test written first that now fails means the code and the contract disagree. Do not edit the test to match the code. Work out which is right against the acceptance criteria: if the code is wrong, report it; if the team changed its mind while building, update the test and its contract comment, and say so in the report.

Then check the tests can fail. For two or three of the most important rules you tested, break the rule in the source (flip a condition, drop a check), confirm a test goes red, and restore the file with `git checkout -- <file>`. A test that stays green when its rule is broken is not testing it — fix the test.

Finally run `npm run test:coverage`, then `npm run coverage:changed`, which lists every line the branch adds or changes under `src/` that no test runs - CI fails the PR on the same list. Each one is either behaviour the code has that no test asked for (add the test, or question whether the code should be there) or a line no test can reach: a guard TypeScript needs, or a fallback for a value that is always sent. Mark that line `// v8 ignore next -- <why>` and name it in the report. Do not mark a line that is reachable but awkward to test. Once the code passes, trim the "written before the code" contract comment to whatever is still useful.

## Step 5: Report back

Tell the user, briefly:
- The mode, the test files added or changed, and how many tests
- **Test-first:** the contract in full — every file, export, status code and message the developer now has to build — and which parts you decided rather than took from the story
- **Check / catch-up:** coverage of each file the story touched, and anything left uncovered and why
- Any test written first that the code did not satisfy, and what you did about it
- Any behaviour that looked wrong and was deliberately not locked in — in full, since a person needs to decide

Do not commit unless the user asks.
