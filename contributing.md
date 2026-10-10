# Team workflow: GitHub + Jira

Everything you need to know to pick up a ticket, write code, and get it merged.

**Before you start, replace `PROJ` everywhere below with our actual Jira project key** (the letters at the start of every ticket ID).

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

Note the issue key at the top of the card — it looks like `PROJ-123`. You'll need it in the next step.

### 2. Create your branch

Always branch from an up-to-date `main`:

```bash
git checkout main
git pull
git checkout -b PROJ-123-short-description
```

**Branch naming rules:**

| Rule | Example |
|---|---|
| Start with the issue key | `PROJ-123-...` |
| Key in UPPERCASE | `PROJ-123` not `proj-123` |
| Dash after the key | `PROJ-123-login` not `PROJ123login` |
| Then 2–4 words, lowercase, dashes between | `PROJ-123-add-login-endpoint` |
| No spaces, no underscores, no slashes | |

Good: `PROJ-123-user-model`, `PROJ-88-fix-token-refresh`, `PROJ-45-payment-webhook`

Bad: `feature/login` (no key), `proj-123-login` (lowercase), `PROJ-123 login` (space), `my-branch` (no key)

**Easier alternative:** open the ticket in Jira, find the Development panel on the right, and click **Create branch**. Jira pre-fills the name correctly, so you can't typo the key. Then run `git fetch && git checkout PROJ-123-...` to get it locally.

### 3. Work and push as you go

Commit and push regularly — at least once a day. Don't sit on unpushed work.

```bash
git add .
git commit -m "add user model and migration"
git push -u origin PROJ-123-user-model
```

You do **not** need to type the key in your commit messages. Git adds it for you from the branch name: on `PROJ-123-user-model`, the commit above is saved as `PROJ-123: add user model and migration` (`.githooks/prepare-commit-msg`, switched on by `npm install`). That keeps every commit linked to its ticket even after the branch is merged and deleted.

It leaves the message alone on a branch with no key (`main`, `docs/...`, `ci/...`), when you already typed the key, and on merge commits. Run `npm install` once after pulling this change to turn it on.

(First push needs `-u origin <branch-name>`. After that, plain `git push` works.)

### 4. Test before you ask for review

Run the app and the tests locally. Check your own changes first — reviewer time is expensive, and "it didn't run" is a wasted round trip.

CI runs the same checks on every PR (`.github/workflows/ci.yml`): Lint, Type-check, Unit tests, Build and Migrations. To run them yourself before pushing:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Lint and the tests also run automatically every time you `git push` (`.githooks/pre-push`, switched on by `npm install`). Run `npm install` once after pulling this change to turn it on.

- **Lint fails:** the push is cancelled and the error is shown. Fix it and push again.
- **Tests fail:** the failures are listed, and the push goes through. We write tests before the code, so failing tests are normal until a ticket's code is finished.

A red check on your PR means one of these failed — open the **Checks** tab on the PR to see which, fix it, and push to the same branch. A PR whose code is not finished yet will be red; open it as a **draft** so reviewers know. Merge only when every check is green.

### Tests come first

We work test-driven. For a new ticket, in Claude Code:

1. Run `/generate-test-cases SPM-123` before writing any code. It writes the manual test cases (the Excel file) and the automated tests, which fail because the code is not there yet.
2. Read the "contract" comment at the top of each new test file and the "DECIDED" entries in the open questions. They say what you are about to build. Change anything you disagree with now.
3. Write the code until the tests pass. Leave `npm run test:watch -- <part of the test file name>` running in a terminal: it re-runs those tests each time you save.
4. Run `/generate-test-cases SPM-123` again. It checks the tests against the finished code and fills any gaps.

### 5. Open a pull request

Three ways, pick whichever:

- **Banner:** right after pushing, the repo's GitHub page shows a "Compare & pull request" button. Click it.
- **Tab:** repo → **Pull requests** → **New pull request**. Set `base` to `main` and `compare` to your branch.
- **Terminal:** `gh pr create --fill`

On the PR form:

- **Title** — must contain the issue key. Usually pre-filled from the branch name; check it. Example: `PROJ-123 add user model and migrations`
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
git branch -d PROJ-123-user-model
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
Put both keys in the PR title: `PROJ-12 PROJ-45 add shared validation`. It links to both tickets.

**I forgot the key in my branch name.**
Easiest fix: edit the PR title on GitHub and add the key at the front. That links the PR and its commits. Alternatively rename the branch:

```bash
git branch -m PROJ-123-correct-name
git push origin --delete old-branch-name
git push -u origin PROJ-123-correct-name
```

**Nothing is showing on the Jira ticket.**
Check, in order: is the key spelled exactly right (`PROJ-123`, not `PORJ-123`)? Is it uppercase? Did you actually push, not just commit? Does that ticket exist? A typo'd key fails silently.

**`main` moved while I was working and now there are conflicts.**

```bash
git checkout main
git pull
git checkout PROJ-123-my-branch
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
git checkout -b PROJ-123-short-description

# Work
git add .
git commit -m "what you did"
git push -u origin PROJ-123-short-description

# Open PR (or use the GitHub website)
gh pr create --fill

# After merge
git checkout main
git pull
git branch -d PROJ-123-short-description
```

**Branch name format:** `PROJ-123-short-description`
**PR title format:** `PROJ-123 what this does`
