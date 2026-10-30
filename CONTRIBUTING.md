# Contributing to nudge

Thank you for your interest. nudge is maintained in its author's spare time: a well-prepared contribution has a better chance of being reviewed quickly.

## Before writing code

- **A bug**: open an issue with the "Bug" template, unless it is a security vulnerability (see [`SECURITY.md`](SECURITY.md)).
- **A feature or a behavior change**: open an issue to discuss it first. A PR that arrives without prior discussion may be declined, even if it is good, when it does not go in the project's direction.
- **A documentation or typo fix**: a direct PR is enough.

## Setting up your machine

The procedure is in the [Development](docs/development.md) guide: Node 26, Docker, `yarn install`, `yarn dev`.

## Conventions

- **Language**: everything is written in English — code (identifiers, file names, comments, log and error messages, test names), database schema and migrations, docs and ADRs, commit messages, PRs, issues and review comments. The only exception is the French locale of the UI: French text appears only in the dashboard and widget `fr` locale files.
- **The domain vocabulary** is defined in [`CONTEXT.md`](CONTEXT.md): Feedback, Verdict, Destination, Delivery… Code, tests, the interface and commit messages use it.
- **Architecture decisions** live in [`docs/adr/`](docs/adr/). A PR that goes back on one of them says so and proposes a new ADR.
- **The dashboard interface** follows [`docs/design-system.md`](docs/design-system.md).
- **The public API** (`POST /v1/feedbacks`, `POST /v1/incidents`) is described by [`docs/api/openapi.json`](docs/api/openapi.json), generated from `feedbackInputSchema` and `incidentInputSchema`: after changing the schema, regenerate it with `yarn workspace @nudge/shared vitest run -u`. A change to the Widget's options, the SDK or the public API also updates the coding agent skills that depend on it: [`integrate-nudge`](skills/integrate-nudge/SKILL.md) for Feedback and [`integrate-nudge-incidents`](skills/integrate-nudge-incidents/SKILL.md) for Incidents.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/), in English: `feat(dashboard): …`, `fix(api): …`, `docs: …`. Release notes are generated from them.
- **Tests** accompany every behavior change. The pipeline tests (`tests/pipeline`) start Postgres and Redis with testcontainers: Docker must be running.

## Opening a Pull Request

Before pushing:

```bash
yarn prettier --check .
yarn lint
yarn check-types
yarn test
```

CI runs the same checks, builds the images and looks for secrets in the history. Describe the problem, the solution and how to verify it, then link the issue (`Closes #12`).

## License of contributions

nudge is released under [AGPL-3.0](LICENSE). By opening a Pull Request, you agree that your contribution is released under that same license.
