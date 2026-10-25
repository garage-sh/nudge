# Issue tracker

Where this repo's issues live, by **role**. A repo may use more than one tracker; every skill that publishes or fetches an issue reads this table first, then the operations file of the tracker the row names.

## Routing

| Role        | What it covers                                                                                                           | Tracker  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| `spec`      | Specs from `/to-spec`, and **every ticket cut from a spec** or from a plan (`/to-tickets`, `/implement-spec-unattended`) | `github` |
| `incoming`  | Bug reports and requests that arrive raw, worked by `/triage`                                                            | `github` |
| `wayfinder` | Wayfinder maps and their decision tickets                                                                                | `github` |

Each tracker named here has its operations in `docs/agents/issue-tracker-<tracker>.md` — how to create, read, list, label, parent, block and close an issue there, and the syntax a pull request uses to close one.

A spec and its tickets always share one tracker: parent links and blocking edges never cross tools. A ticket with no spec above it follows the `spec` row too.

## Recognising a reference

A reference names its tracker by its shape — read the identifier formats each operations file records:

- `#123`, `owner/repo#123` or a `github.com/…/issues/…` URL → GitHub;
- `KEY-123` → the tracker whose operations file lists `KEY` among its keys (Linear team keys and Plane project identifiers look alike, so match the key, never the shape alone).

## Specs vs implementation tickets

A spec and a ticket are both issues, so a spec is told apart by **one label**: `spec`.

- **A spec** — the document `/to-spec` publishes: problem, solution, user stories, implementation and testing decisions. Always labelled `spec`. It is a parent to read from, never a unit of work to pick up and build.
- **An implementation ticket** — a tracer-bullet slice from `/to-tickets`, or an incoming bug or request. **Never** labelled `spec`.

A `wayfinder:map` issue is a third kind — a map of decision tickets, not a spec. It never carries `spec`.

## Labels

The same vocabulary on every tracker, so the skills carry one logic:

- `spec` — applied by `/to-spec` alone.
- The triage roles — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, mapped to this repo's strings in `docs/agents/triage-labels.md` when `/triage` is installed.
- `wayfinder:map` and `wayfinder:research|prototype|grilling|task` — applied by `/wayfinder`.

A label has to exist before it is applied; each operations file says how to create one idempotently.
