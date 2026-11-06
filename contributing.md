# Team workflow: GitHub + Jira

Everything you need to know to pick up a ticket, write code, and get it merged.

Our Jira project key is **SPM** (board: https://kkchoong.atlassian.net, project SPM), so every ticket ID looks like `SPM-123`.

---

## The one rule

**Every branch name starts with the Jira issue key.**

That key is how Jira knows which ticket your code belongs to. Get it wrong or leave it out and your work will not appear in Jira — with no error message to warn you.

---

## One-time setup

Do this once, before your first ticket.

1. Clone the repo: `git clone <repo-url>` then `cd` into it.
2. Confirm you can see the repo in GitHub and the board in Jira. If not, ask the repo owner to add you.
3. Optional but useful — install the GitHub CLI so you can open PRs from the terminal:
   - Mac: `brew install gh`
   - Windows: `winget install GitHub.cli`
   - Then run `gh auth login` once and follow the prompts.

---

## The daily workflow

### 1. Pick up a ticket

Take a story from the sprint board and drag it to **In Progress** so nobody duplicates your work.

Note the issue key at the top of the card — it looks like `SPM-123`. You'll need it in the next step.

### 2. Create your branch

Always branch from an up-to-date `main`:

```bash
git checkout main
git pull
git checkout -b SPM-123-short-description
```

**Branch naming rules:**

| Rule | Example |
|---|---|
| Start with the issue key | `SPM-123-...` |
| Key in UPPERCASE | `SPM-123` not `proj-123` |
| Dash after the key | `SPM-123-login` not `SPM123login` |
| Then 2–4 words, lowercase, dashes between | `SPM-123-add-login-endpoint` |
| No spaces, no underscores, no slashes | |

Good: `SPM-123-user-model`, `SPM-88-fix-token-refresh`, `SPM-45-payment-webhook`

Bad: `feature/login` (no key), `proj-123-login` (lowercase), `SPM-123 login` (space), `my-branch` (no key)

**Easier alternative:** open the ticket in Jira, find the Development panel on the right, and click **Create branch**. Jira pre-fills the name correctly, so you can't typo the key. Then run `git fetch && git checkout SPM-123-...` to get it locally.

### 3. Work and push as you go

Commit and push regularly — at least once a day. Don't sit on unpushed work.

```bash
git add .
git commit -m "add user model and migration"
git push -u origin SPM-123-user-model
```

You do **not** need to type the key in your commit messages. Git adds it for you from the branch name: on `SPM-123-user-model`, the commit above is saved as `SPM-123: add user model and migration` (`.githooks/prepare-commit-msg`, switched on by `npm install`). That keeps every commit linked to its ticket even after the branch is merged and deleted.

It leaves the message alone on a branch with no key (`main`, `docs/...`, `ci/...`), when you already typed the key, and on merge commits.

When a commit includes a test case workbook (`docs/test-cases/SPM-*_Test_Cases.xlsx`), a second hook (`.githooks/pre-commit`) fills the Commit row of each new execution block with the hash of the build you tested. Leave that cell blank and commit. See `docs/test-cases/README.md`.

(First push needs `-u origin <branch-name>`. After that, plain `git push` works.)

### 4. Test before you ask for review

Run the app and the tests locally. Check your own changes first — reviewer time is expensive, and "it didn't run" is a wasted round trip.

CI runs these checks on every PR (`.github/workflows/ci.yml`):

| Check | What it needs from you | Run it yourself |
|---|---|---|
| Lint, Type-check, Unit tests | Clean code, passing tests, coverage above the minimum in `vitest.config.mts` | `npm run lint`, `npx tsc --noEmit`, `npm run test:coverage` |
| Changed lines are tested | Every line your PR changes is covered by a test | `npm run coverage:changed` |
| Test cases | The story has its workbook, `docs/test-cases/SPM-123_Test_Cases.xlsx` | `npm run test-cases:check` |
| Traceability | Every test is tagged with its story, the PR names its story, and the matrix in `docs/traceability/` is up to date | `npm run trace:tags`, then `npm run trace` (or `npm run trace -- --repo-only` without a Jira token) |
| Dependency audit | No high or critical advisories in `package-lock.json` | `npm audit --omit=dev --audit-level=high` |
| Build | The app builds | `npm run build` |
| Migrations | The schema matches `prisma/migrations`, and the seed and every story fixture load | `npm run prisma:migrate` on your own database |
| Integration tests | Pass against a real Postgres on `localhost` | `npm run test:integration` |
| End-to-end | Pass in Chromium against the built app | `npm run build`, then `npm run test:e2e` |

Lint and the unit tests also run automatically every time you `git push` (`.githooks/pre-push`, switched on by `npm install`).

- **Lint fails:** the push is cancelled and the error is shown. Fix it and push again.
- **Tests fail:** the failures are listed, and the push goes through. We write tests before the code, so failing tests are normal until a ticket's code is finished.

A red check on your PR means one of these failed — open the **Checks** tab on the PR to see which, fix it, and push to the same branch. A PR whose code is not finished yet will be red; open it as a **draft** so reviewers know. Merge only when every check is green.

### Tests come first

We work test-driven. For a new ticket, in Claude Code:

1. Run `/generate-test-cases SPM-123` before writing any code. It writes the manual test cases (the Excel file) and the automated tests, which fail because the code is not there yet.
2. Read the "contract" comment at the top of each new test file and the "DECIDED" entries in the open questions. They say what you are about to build. Change anything you disagree with now.
3. Write the code until the tests pass. Leave `npm run test:watch -- <part of the test file name>` running in a terminal: it re-runs those tests each time you save.
4. Run `/generate-test-cases SPM-123` again. It checks the tests against the finished code and fills any gaps.

Every test name starts with its story and acceptance criterion, so the traceability matrix can link it:

| Test is for | Tag at the start of the `it()` / `test()` name |
|---|---|
| One acceptance criterion | `it("[SPM-43][AC3] approves a free room", …)` |
| Several criteria | `[SPM-43][AC3][AC7]` |
| The story, no single criterion | `[SPM-43]` |
| A bug, on the story whose page it tests | `[SPM-41][BUG-98]` |
| Code no story asks for | `[UNTRACED:<feature>]`, e.g. `[UNTRACED:self-registration]`; a new feature also needs an entry in `UNTRACED_FEATURES` in `scripts/trace.ts` |

Update the story's test case workbook in the same PR. Add a new execution block for each run and never overwrite an old one; retire a case instead of deleting it (`docs/test-cases/README.md`, `docs/test-cases/DECOMMISSIONED.md`). Run `npm run trace` before marking the PR ready.

### 5. Open a pull request

Three ways, pick whichever:

- **Banner:** right after pushing, the repo's GitHub page shows a "Compare & pull request" button. Click it.
- **Tab:** repo → **Pull requests** → **New pull request**. Set `base` to `main` and `compare` to your branch.
- **Terminal:** `gh pr create --fill`

On the PR form:

- **Title** — must contain the issue key. Usually pre-filled from the branch name; check it. Example: `SPM-123 add user model and migrations`
- **Description** — a few sentences: what changed, why, anything the reviewer should look at closely.
- **Reviewers** — assign a teammate via the gear icon in the right sidebar. **Skip this and nobody gets notified.**

Not finished yet but want early feedback? Use the dropdown next to the create button and choose **Create draft pull request**. Drafts can't be merged until you mark them ready.

### 6. Respond to review

Push fixes to the same branch — the PR updates itself. **Never open a second PR for review comments.**

```bash
git add .
git commit -m "address review comments"
git push
```

### 7. Merge and close out

Once approved, click **Merge pull request** on GitHub, then **Delete branch** (the button appears right after merging).

Then move the Jira ticket to **Done**.

Clean up locally:

```bash
git checkout main
git pull
git branch -d SPM-123-user-model
```

---

## Rules we all follow

- **Never push directly to `main`.** All changes go through a PR. No exceptions, including tiny fixes.
- **Review PRs within one working day.** If PRs sit, people start stacking branches on unmerged branches and everything tangles. Reviewing is as much a part of your job as writing code.
- **Merge as soon as it's approved.** Don't batch merges until the end of the sprint — that concentrates all the integration pain into the worst possible day.
- **One story, one branch, one PR.** If a branch is open more than about a week, the story was too big. Say so, and we'll split it.
- **Always branch from an updated `main`.** `git checkout main && git pull` first, every time.

---

## Common situations

**My PR touches two tickets.**
Put both keys in the PR title: `SPM-12 SPM-45 add shared validation`. It links to both tickets.

**I forgot the key in my branch name.**
Easiest fix: edit the PR title on GitHub and add the key at the front. That links the PR and its commits. Alternatively rename the branch:

```bash
git branch -m SPM-123-correct-name
git push origin --delete old-branch-name
git push -u origin SPM-123-correct-name
```

**Nothing is showing on the Jira ticket.**
Check, in order: is the key spelled exactly right (`SPM-123`, not `SMP-123`)? Is it uppercase? Did you actually push, not just commit? Does that ticket exist? A typo'd key fails silently.

**`main` moved while I was working and now there are conflicts.**

```bash
git checkout main
git pull
git checkout SPM-123-my-branch
git merge main
```

Resolve conflicts, commit, push. Ask for help rather than force-pushing anything.

**I'm blocked on someone else's unmerged work.**
Say so in standup. Don't branch off their branch unless there's no alternative — it makes both PRs harder to merge.

---

## Quick reference

```bash
# Start a ticket
git checkout main
git pull
git checkout -b SPM-123-short-description

# Work
git add .
git commit -m "what you did"
git push -u origin SPM-123-short-description

# Open PR (or use the GitHub website)
gh pr create --fill

# After merge
git checkout main
git pull
git branch -d SPM-123-short-description
```

**Branch name format:** `SPM-123-short-description`
**PR title format:** `SPM-123 what this does`
