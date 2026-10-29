# Dashboard design system

The dashboard (`apps/dashboard`) is a triage tool for devs and PMs, mostly on desktop. The list is dense like Linear's and the data crisp like Stripe's. Only one element is memorable: the Severity gauge.

Tokens and classes are in `apps/dashboard/src/styles.css`, React primitives in `src/layout/ui.tsx` (generic) and `src/screens/feedback-badges.tsx` (domain values).

## Principles

1. **Urgency shows before text.** A Feedback always carries its Severity gauge, in the same place: list, detail, filters, a Destination's threshold.
2. **Dense and calm.** Body text at 14 px, 32 px controls, a single surface per list with thin separators. A border outlines a whole object, never a paragraph.
3. **Color states something, never decorates.** The accent is for the primary action and the selection. The other colors are semantic (see the tones).
4. **Domain words.** The vocabulary of `CONTEXT.md`, with its capitals (Feedback, Verdict, Destination…). No system jargon.

## Tokens

### Color

| Token                          | Light                 | Role                                                                       |
| ------------------------------ | --------------------- | -------------------------------------------------------------------------- |
| `--frame`                      | `#e3e9e6`             | The app frame: sidebar, background behind the sheet                        |
| `--canvas`                     | `#f6f8f7`             | The sheet: the content, laid on the frame with a hairline and 12 px radius |
| `--surface`                    | `#ffffff`             | Lists, panels, fields, a Feedback's pane                                   |
| `--surface-2`                  | `#f1f4f2`             | Hover, code, neutral pill                                                  |
| `--text`                       | `#16201c`             | Main text (16.7:1)                                                         |
| `--muted`                      | `#5b6762`             | Metadata, help text (5.9:1)                                                |
| `--border` / `--border-strong` | `#dce2df` / `#c4ccc8` | Separators / control outlines                                              |
| `--accent`                     | `#176a52`             | Primary action, selection, links (6.5:1)                                   |
| `--review`                     | `#5a48c8`             | Awaits a human decision: In review, Uncertain                              |
| `--success`                    | `#1c7a4a`             | Dispatched, Delivered, Active                                              |
| `--danger`                     | `#b42318`             | Failure, error, deletion                                                   |
| `--held`                       | `#9a5b00`             | Suspended, Held, warning                                                   |
| `--severity-1…4`               | `#87938e` → `#b4161b` | Gauge: Cosmetic, Minor, Major, Blocking                                    |

Each semantic color has a `-soft` variant for backgrounds. Dark mode (`prefers-color-scheme: dark`) redefines every token with its own values; no component uses a literal color.

### Typography

- **Instrument Sans** (variable, `@fontsource-variable/instrument-sans`) for everything.
- **JetBrains Mono** (`@fontsource/jetbrains-mono`) only for actual technical values: keys, webhook URLs, identifiers. Never for a label.
- Fonts are bundled in the build: the self-hosted Instance contacts no third-party service.
- Scale: `--t-xs` 12, `--t-s` 13 (metadata, field labels), `--t-m` 14 (body text), `--t-l` 16 (panel titles, a Feedback's text), `--t-xl` 20 (screen title), `--t-2xl` 28 (public screens). Weights: 400, 500 (labels, buttons), 600 (titles).
- Tabular figures (`tabular-nums`) wherever numbers are compared: dates, counters, attempts.

### Shape and motion

- Radii: `--r-control` 6 px (buttons, fields, checkboxes), `--r-panel` 10 px (panels, lists, dialogs), pill for pills.
- No shadow at rest. `--shadow-floating` is reserved for what floats: mobile drawer, menus, dialogs.
- `--duration` 140 ms, ease-out, only in response to an action. Everything is turned off under `prefers-reduced-motion`.

## Layout

```
┌────────────────────┬────────────────────────────────────────────┐
│ ▂▄▆█ nudge         │ ← back                                     │
│ Inbox              │ Screen title                  [actions]    │
│                    │ description                                │
│ Projects           ├────────────────────────────────────────────┤
│   Shop             │ content (max 1040 px)                      │
│   Storefront       │                                            │
│ [alerts]           │                                            │
│ Members            │                                            │
│ Settings           │                                            │
│ account            │                                            │
└────────────────────┴────────────────────────────────────────────┘
```

- Three planes, from darkest to lightest: the frame, the sheet, then the surfaces. An object stands out from its surroundings by moving to the next plane, never through a shadow.
- `Layout`: 232 px sticky sidebar, on the frame; the content is a sheet laid beside it. Below 860 px, the sheet fills the whole screen. Below 860 px, it becomes a drawer opened by "Menu" (closed by Escape, the backdrop or a navigation).
- Fixed entries are in `layout/navigation.ts`; Projects are read from the API.
- Alerts (`Alerts`) live in the sidebar: In review in violet, suspended Destination in amber.
- `PublicPage`: screens without a session (setup, sign in, invitation), a centered 400 px column. Their loading and error states stay inside it.
- `ErrorBoundary`: an unexpected render error shows what happened and "Reload", never a blank page.
- `LocaleSelect`: the language, per browser; in the sidebar's account block and at the foot of a `PublicPage`.

## Brand

The mark is the Severity gauge at its full level: four rising bars, in the accent. `Brand` (`layout/Layout.tsx`) draws it beside the name; the same geometry is in `docs/assets/` (`logo.svg`, `logo-dark.svg` with the outlined wordmark, `mark.svg`, `social-preview.png` for the repository) and `apps/dashboard/public/` (favicon and app icon: white bars on an accent tile).

## Primitives

| Primitive                                                                   | Where                 | When                                                                                                                                          |
| --------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`                                                                | `ui.tsx`              | At the top of every signed-in screen: the only `h1`, an optional back link, a description, the screen's actions. Names the browser tab.       |
| `EmptyState`                                                                | `ui.tsx`              | A list or section with no content: say why, offer the action that fills it.                                                                   |
| `Loading`                                                                   | `ui.tsx`              | During a request: row skeletons, announced as "Loading…".                                                                                     |
| `ErrorMessage`                                                              | `ui.tsx`              | API error, in plain words and with the action to take (codes in the dictionaries' `apiErrors`). `onRetry` adds "Retry" on a read that failed. |
| `Field`                                                                     | `ui.tsx`              | A text field with a label and help text. A value the browser refuses is said under the field (`.field-error`), and the first one takes focus. |
| `CopyableValue`                                                             | `ui.tsx`              | Key or link to copy; `multiline` for a block of code (a JSON body, a snippet), with the button in its corner.                                 |
| `ConfirmAction`                                                             | `ui.tsx`              | Irreversible action behind a button: the confirmation opens in place, with focus on Cancel. Escape cancels and returns focus to the button.   |
| `Confirmation`                                                              | `ui.tsx`              | The same question, triggered another way, for example a save that erases data (shorter retention).                                            |
| `SaveStatus`                                                                | `ui.tsx`              | "Saved." after a save, announced to screen readers. The form clears it as soon as it changes (`onChange={() => mutation.reset()}`).           |
| `useReturnFocus`                                                            | `ui.tsx`              | Returns focus to the button that opened a form (Correct, Edit) when the form closes.                                                          |
| `ExternalLink`                                                              | `ui.tsx`              | Any URL coming from outside (a link only for http(s)).                                                                                        |
| `Pill`                                                                      | `ui.tsx`              | A State or a Status, colored by a tone: `neutral`, `success`, `review`, `danger`, `held`, `off`.                                              |
| `SeverityGauge`                                                             | `feedback-badges.tsx` | A Feedback's Severity; `large` in the detail view. Dotted when there is no Severity.                                                          |
| `StatePill`, `DeliveryStatusPill`, `DestinationStatePill`, `UncertainBadge` | `feedback-badges.tsx` | Domain values, with their tone set once and for all.                                                                                          |
| `LevelPill`, `IncidentStatePill`                                            | `feedback-badges.tsx` | An Incident's Level (Critical is solid, so it differs from Error without color) and its state.                                                |
| `Properties`                                                                | `ui.tsx`              | Label / value pairs (`.properties`), values rendered as text.                                                                                 |
| `useScrollToHash`                                                           | `ui.tsx`              | A link to a panel (`#settings-smtp`, `#project-incidents`) scrolls to it once the screen is drawn.                                            |

### Classes

- `.panel`: a panel, for a whole object (a Verdict, a Destination, a settings section). `PanelHeader` gives it a title with, on the right, a `Pill` of the saved state of what it configures.
- `.field-row`: two related fields side by side (username and password), stacked below 560 px; `.short-end` when the second is short (a port).
- `.list`: a surface with separators, for a collection. No card per item.
- `.linked-row` + `.row-link`: a row that opens its object. The link is stretched over the whole row, which takes the hover and the focus ring: a click anywhere on the row opens it (Inbox, Projects).
- `.form`, `.field`, `fieldset.field` + `.check` (checkboxes as pills), `.actions` (row of buttons), `.help`, `.muted`.
- `.alert` (error), `.warning` (caution, amber), `.empty` (empty state), `.meta` (inline metadata), `.properties` (label / value pairs).
- `fieldset.type-picker` + `.type-option`: a choice between a few kinds of object, as radios carrying a mark (`TypeIcon`) and a name. `fieldset.segmented`: a switch between a few views of the same thing (a webhook's events).

### Buttons

- `button` with no class: **solid**, the primary action. At most one per screen or per panel.
- `.secondary`: outlined, for all other actions.
- `.ghost`: no outline, for Cancel and low-weight actions.
- `.danger`: solid red, only to confirm a deletion (in `ConfirmAction`).

## Screen patterns

Every signed-in screen starts with `PageHeader`. The patterns below are the shapes already solved: a new screen of the same shape reuses them.

- **List to triage** (Inbox, `screens/Feedbacks.tsx`):
  - `.views`: shortcuts to a filter, as links with `aria-current`;
  - `.filters` / `.filter`: pills that carry a native `select` and switch to a solid outline when active;
  - `.feedback-list`: one surface, groups by day (`.day-group`) and `.feedback-row` rows in a fixed-column grid;
  - the whole row opens the item: a link stretched by `::after`.

  An empty result offers "Clear filters".

- **Reading pane** (Inbox, above 1360 px):
  - like a mail client, the Feedback opens in a pane (`.feedback-pane`) beside the list, which narrows;
  - the route stays `/feedbacks/:id`, nested under `/feedbacks`; the filters follow in the URL;
  - the detail view knows it is in the pane through the `FeedbackPane` context: it offers "Close", and its title becomes an `h2`;
  - J and K move to the next or previous Feedback, and Escape closes the pane;
  - rows and detail adapt to the space they have, through container queries (`list`, `detail`) rather than the screen width.
    Below 1360 px, the Feedback opens as a full page.

- **Item detail** (a Feedback's detail, `screens/Feedback.tsx`):
  - `.trail`: back to the originating list, with its filters, and Previous / Next from the `ListState` navigation state;
  - `.feedback-grid`: content and decision on the left, properties on the right (`.feedback-side`, flat sections separated by hairlines). A single column below 1100 px;
  - a decision awaiting a Member is shown as a banner (`.review-banner`), above everything else.
- **Incident list** (a Project's Incidents tab, `screens/Incidents.tsx`): the Inbox's views and filters, without day groups; `.incident-row` puts the Level first, then the title, Environment, Occurrences, state and last seen. The detail (`screens/Incident.tsx`) states Level, state, Environment and Occurrences under its title, then the first and last Occurrence beside the Incident's properties.
- **Tabbed object** (Project, `ProjectHeader` in `screens/Project.tsx`):
  - a shared header and `.tabs` as `NavLink`s, one route per tab;
  - the tab's primary action goes in the header.
- **Configurable collection** (Destinations, Projects):
  - one row per object (`.destination`);
  - adding is the header's action and opens the form at the top of the list. It is open by default when the collection is empty, under the empty state (`EmptyState`) that says what to put in it;
  - an object in trouble says why and what to do (`.problem`);
  - a Project's routing (`RoutingMap`) heads the list: Feedback types on the left, Destinations on the right, a line where a Filter accepts a type, highlighted on hover. A type no Destination accepts says it goes nowhere. The drawing is `aria-hidden`; the same routes are written as a list, which is also the narrow-screen view;
  - a webhook's form shows its payload (`.payload`): request, headers, body per event and the signature check, from `WEBHOOK_EXAMPLES` in `@nudge/shared`. On a wide screen it sits beside the fields.
- **Settings** (Settings, a Project's settings): a `.settings` column of at most 760 px, one `.panel` per topic with its state in its `PanelHeader`, and one solid button per panel. Instance settings add a `.settings-nav` to each panel: a sticky column beside them from 1100 px, a row of links above them below. A link to `/settings#settings-<topic>` lands on the panel.

## Writing rules

- A button says what it does, with the domain name: "Add Destination", "Reinstate", not "Submit form".
- An action keeps the same name throughout the flow (button, confirmation, success message).
- An error says what happened and what to do, without apologizing. A field's error sits under that field, never in the browser's bubble.
- In lists, dates are relative (`format.dateRelative`), and the exact date shows in `title`. Day groups use `format.day`.
- No copy in components: every string lives in `src/i18n/en.ts` (the source of the keys) and `src/i18n/fr.ts`, read with `useT()` or `useI18n()` (which also gives `format`, the dates and sizes of the active locale). A sentence with a number is a function, so each language handles its own plurals.
- An empty state invites action.
- No capitals for labels, no middle dot to join metadata: each piece of metadata is its own element.
