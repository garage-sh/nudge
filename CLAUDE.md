# nudge

Open-source, self-hosted tool that collects, triages and dispatches user feedback from several projects. The domain vocabulary is in `CONTEXT.md`; the v1 spec is issue #1.

## Language

nudge is an open-source project: **everything is written in English.** That covers code (identifiers, file names, comments, log and error messages, test names), database schema and migrations, documentation, ADRs, commit messages, pull requests, issues and review comments.

The only exception is the French locale of the user interface (the dashboard and widget `fr` translation files). French text goes nowhere else, even when the conversation with the maintainer is in French.

## Agent skills

### Issue tracker

Specs, tickets, incoming requests and wayfinder maps live in GitHub Issues (garage-sh/nudge). See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
