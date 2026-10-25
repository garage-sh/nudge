# Triage goes through a System One port, not through Jev directly

nudge is open-source and self-hosted: it must not depend on any particular model provider. Triage phrases its decisions as typed System One questions (Noul, Choice, Score) asked about a state, and sends them to a port. Each System One-compatible provider — Jev through the TypeSafe API, pplx-decider through OpenRouter's Decisions API, self-hosted pplx-decider — is an adapter of this port, chosen by the Instance's configuration.

## Considered Options

- **Hard-coded Jev**: simpler, but nudge could not run without a TypeSafe account.
- **Generative LLM (chat completions)**: universal, but we would have to parse free text and would lose the calibrated probabilities that routing depends on.

## Consequences

Triage questions rely only on what System One providers have in common (Noul, Choice, Score). A feature specific to a single provider (images, Box) cannot carry a Triage decision.
