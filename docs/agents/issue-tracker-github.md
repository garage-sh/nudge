# Issue tracker operations: GitHub

How to work issues on GitHub, for every role `docs/agents/issue-tracker.md` routes here. Use the `gh` CLI for all operations; it infers the repo from `git remote -v` when run inside a clone.

## Identifiers

`#<n>` within this repo, `owner/repo#<n>` across repositories. GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## Operations

- **Create** ("publish to the issue tracker"): `gh issue create --title "..." --label <label> --body "..."`. Use a heredoc for multi-line bodies.
- **Read** ("fetch the relevant ticket"): `gh issue view <n> --comments`, also fetching labels.
- **List**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with `--label` and `--state` filters. Specs only: `--label spec`. Work only, specs excluded: `--search "-label:spec"`.
- **Comment**: `gh issue comment <n> --body "..."`
- **Apply / remove labels**: `gh issue edit <n> --add-label "..."` / `--remove-label "..."`
- **Assign** (a claim): `gh issue edit <n> --add-assignee @me`
- **Close**: `gh issue close <n> --comment "..."`; `--reason "not planned"` for `wontfix`.

## Labels

Create each label once (idempotent — an existing label is left alone):

```bash
gh label create spec --color 5319E7 --description "A spec produced by /to-spec — not an implementation ticket" 2>/dev/null || true
```

The triage roles and `wayfinder:*` labels are created the same way.

## Parent and children

A ticket cut from a spec, and a wayfinder decision ticket, is a **sub-issue** of its parent: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`. List them with `gh api repos/<owner>/<repo>/issues/<parent>/sub_issues`.

Where sub-issues aren't enabled, put `Part of #<parent>` at the top of the child body, and add the child to a task list in the parent body. To find every child either way, also search `gh issue list --state all --search "<parent> in:body"` and keep the issues whose body actually references the parent.

## Blocking edges

Use GitHub's **native issue dependencies** — the canonical, UI-visible representation, which renders the frontier without anyone opening a parent issue.

Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<blocked>/dependencies/blocked_by -F issue_id=<blocker-db-id>`. Read them with `gh api repos/<owner>/<repo>/issues/<n>/dependencies/blocked_by`. A `<…-db-id>` is the issue's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` — open blockers only, which is the live gate.

Where dependencies aren't enabled, fall back to a `Blocked by: #<n>, #<n>` line at the top of the body. Either way, an issue is unblocked when every blocker is closed.

## Closing from a pull request

One `Closes #<n>` per ticket in the PR body, each on its own line; a spec is referenced as `Part of #<n>`, never closed. GitHub fires the close only when the PR merges into the **default branch** — a PR stacked on another branch links the issue and never closes it, so close those by hand after the stack lands.

Confirm the closes registered after opening: `gh pr view <n> --json closingIssuesReferences`.

## Wayfinding

- **Map**: one issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: a sub-issue of the map (see Parent and children), labelled `wayfinder:<type>`.
- **Frontier query**: list the map's open children, drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: assign it to yourself — the session's first write.
- **Resolve**: comment the answer, close the issue, then append a context pointer (gist + link) to the map's Decisions-so-far.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <n> --comments` and `gh pr diff <n>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.
