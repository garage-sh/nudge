# Incidents are their own aggregate, sharing Dispatch with Feedback

nudge now also collects Incidents: reports sent by machines (an application's backend, later a monitoring tool) that something is going wrong, to be routed to the team's channels by Level and Environment. An Incident is a separate aggregate next to Feedback, not a new Source of Feedback: it has its own lifecycle (Open, absorbing Occurrences that share its Fingerprint, then Closed), and it reuses only what Dispatch already offers: Destinations and their adapters, Deliveries, Suspended, Redispatch. A Destination carries a second, Incident Filter beside its Feedback Filter.

An Incident's Level is declared by its sender. When it is not, the Judge assesses it within a bounded wait, and failing that the Project's default Level applies. Unlike Feedback Triage, there is no Junk, no Manipulation detection and no In review for Incidents.

## Considered Options

- **A new Source of Feedback**: everything would be reused as is, but a machine report would go through Triage, Author, Capture, Junk and Manipulation, notions that mean nothing for it, and Feedback would lose its definition as something a person left.
- **A separate module with its own ingestion, routing and senders**: full isolation, but every Destination adapter (Discord, Slack, Linear, email…) would be written twice.
- **Severity, assessed by the Judge as for Feedback**: one scale and one Filter, but "cosmetic" means nothing for a production outage, and routing a critical Incident would depend on a third party being up at the worst moment.

## Consequences

Destination adapters gain a second payload and must act on what they created at opening when an Incident closes (close the issue, reply in the thread) rather than sending a new object. The sender is authenticated by the Project's secret key, so the Judge only ever decides a Level: a report that tries to influence it can at worst produce a wrong Level, which is why Manipulation detection is not worth an alert held at the worst moment. Two scales coexist: Severity for Feedback, Level for Incidents.
