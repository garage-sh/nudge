# nudge

Open-source, self-hosted tool that collects feedback from the users of several applications, triages it, then dispatches it to the team's tools.

## Language

### Collection

**Project**:
An application whose feedback nudge collects. The unit of configuration: each Project has its own triage and dispatch rules.
_Avoid_: App, client, tenant

**Project description**:
A short, optional text that tells the Judge what the Project is and what is critical in it, so it can assess Severity better.
_Avoid_: Prompt, context

**Feedback**:
A message left by a user of a Project (bug, suggestion, opinion, question). The central object of nudge, kept until a Deletion or the Retention removes it. In code, one item is a `feedback` and the collection is `feedbacks`.
_Avoid_: Ticket, message, report, submission

**Source**:
The entry point through which a Feedback arrived: Widget or API (later, the QA extension).
_Avoid_: Channel, origin, provenance

**Feedback type**:
The nature of a Feedback: Bug, Suggestion, Opinion or Question. The user may declare it (optional), but Triage sets the resolved type.
_Avoid_: Category, kind

**Opinion**:
A Feedback type: the user's opinion of the Project (praise, criticism), with no precise request for action.
_Avoid_: Review, comment

**Question**:
A Feedback type: the user asks for help or an explanation.
_Avoid_: Support, request

**Author**:
The person who left a Feedback. Anonymous by default; identified only if the host application or the user provides it.
_Avoid_: User, reporter, client

**Allowed origin**:
A web origin (`https://app.example.com`) from which a Project's public key is accepted. A property of the Project, not the Source of a Feedback.
_Avoid_: Allowed domain, whitelist

**Widget**:
The embeddable form nudge provides to web Projects to collect Feedback.
_Avoid_: SDK, snippet, plugin

### Processing

**Triage**:
The step that assesses a received Feedback and returns a Verdict on how to handle it.
_Avoid_: Classification, analysis

**Verdict**:
The result of Triage for a Feedback: its resolved type, whether it is Junk, and its Severity.
_Avoid_: Result, label, tag

**Severity**:
How urgent a Feedback is, from cosmetic to blocking.
_Avoid_: Priority, criticality

**Judge**:
The System One decision model that answers Triage's questions (Jev, pplx-decider…), chosen by the Instance.
_Avoid_: AI, LLM, model, provider

**Junk**:
A Verdict: the Feedback is spam, empty or abusive. It is kept but never dispatched, unless a Member reinstates it.
_Avoid_: Spam, rejected, trash

**Manipulation**:
A Verdict: the Feedback tries to influence Triage. It is put In review instead of being dispatched.
_Avoid_: Injection, attack

**Uncertain**:
A flag on a Verdict the Judge hesitated on. It blocks nothing; it signals that a Member should check.
_Avoid_: To review, dubious

**In review**:
State of a Feedback suspected of Manipulation, held until a Member approves it (it is then dispatched) or rejects it (it becomes Discarded).
_Avoid_: Quarantine, pending

**Discarded**:
State of a Feedback that will not be dispatched (Junk, or rejected after review).
_Avoid_: Deleted, archived

### Dispatch

**Dispatch**:
Sending a triaged Feedback to the Destinations of its Project whose Filter accepts it.
_Avoid_: Notification, forward, export

**Destination**:
An external place configured on a Project, to which Feedback is sent (a Discord channel, a Linear team, a webhook…).
_Avoid_: Channel, integration, connector, sink

**Filter**:
The condition carried by a Destination (accepted types, minimum Severity) that decides whether a Feedback is sent to it.
_Avoid_: Rule, route, subscription

**Delivery**:
One attempt to deliver a Feedback to a Destination, with its status and the link to the object created there. A Feedback has one Delivery per accepting Destination. Replaying a Delivery sends it again.
_Avoid_: Job, send, dispatch

**Redispatch**:
A Member's manual action that resumes the Dispatch of a Triaged or Dispatched Feedback according to its current Verdict: it creates the missing Deliveries to the Destinations whose Filter now accepts it, without touching existing Deliveries. Not to be confused with a replay, which resends an existing Delivery.
_Avoid_: Re-triage, automatic propagation

**Suspended**:
State of a Destination whose Deliveries fail repeatedly; its Deliveries are held until it is reachable again.
_Avoid_: Disabled, down, open circuit

### Instance

**Instance**:
A self-hosted deployment of nudge, with its Projects, its Members and its Judge.
_Avoid_: Workspace, organization, tenant

**Alert destination**:
A Destination set at the Instance level that receives the alerts meant for Members (a Feedback In review, a Suspended Destination), not Feedback.
_Avoid_: Ops channel, notifications

**Member**:
A person who signs in to the dashboard of an Instance. Every Member sees every Project.
_Avoid_: Admin, user

**Capture**:
A screenshot attached to a Feedback at the Author's initiative, after optional masking. It is never sent to the Judge.
_Avoid_: Screenshot, attachment

**Deletion**:
The permanent removal of a Feedback and its Capture by a Member, for example on an erasure request from the Author. Objects already created in the Destinations remain. Not to be confused with Discarded, where the Feedback is kept.
_Avoid_: Archiving, rejection

**Retention**:
The optional duration, at the Instance level, after which Feedback and its Captures are purged automatically. Unlimited by default.
_Avoid_: Expiration, TTL, archiving
