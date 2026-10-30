# Dashboard design system

The dashboard (`apps/dashboard`) is a triage tool for devs and PMs, mostly on desktop. It reads like a professional SaaS: a quiet frame, a top bar that always says where you are, lists that run the sheet's full width and are dense like Linear's, data crisp like Stripe's. Only one element is memorable: the Severity gauge.

Tokens and classes are in `apps/dashboard/src/styles.css`, React primitives in `src/layout/ui.tsx` (generic) and `src/screens/feedback-badges.tsx` (domain values).

## Principles

1. **Urgency shows before text.** A Feedback always carries its Severity gauge, in the same place: list, detail, filters, a Destination's threshold.
2. **Dense and calm.** Body text at 14 px, 32 px controls, a single surface per list with thin separators. A border outlines a whole object, never a paragraph.
3. **Color states something, never decorates.** The accent is for the primary action and the selection. The other colors are semantic (see the tones).
4. **An icon supports a word, never replaces it.** Icons come from `lucide-react` (16 px, stroke 1.75, class `icon`, `aria-hidden`). An icon-only control (`.icon-button`) carries its name in visually hidden text or `aria-label`.
5. **Domain words.** The vocabulary of `CONTEXT.md`, with its capitals (Feedback, Verdict, Destination…). No system jargon.

## Tokens

### Color

| Token                          | Light                 | Role                                                               |
| ------------------------------ | --------------------- | ------------------------------------------------------------------ |
| `--frame`                      | `#f3f4f4`             | The app frame: sidebar, background behind the sheet                |
| `--canvas`                     | `#ffffff`             | The sheet: the content, laid on the frame with a 12 px radius      |
| `--surface`                    | `#ffffff`             | Panels, fields, menus                                              |
| `--surface-2` / `--surface-3`  | `#f2f3f3` / `#e9ebeb` | Hover, selected view / hover on the frame, avatar, empty gauge bar |
| `--sunken`                     | `#f7f8f8`             | Day groups, a detail's properties column, code values              |
| `--text`                       | `#17191a`             | Main text                                                          |
| `--muted`                      | `#5f6468`             | Metadata, help text (5.9:1)                                        |
| `--subtle`                     | `#8b9094`             | Icons and counters beside a word that already says it; never alone |
| `--border` / `--border-strong` | `#e6e8e8` / `#d2d5d6` | Separators / control outlines                                      |
| `--accent`                     | `#176a52`             | Primary action, selection, links (6.5:1)                           |
| `--selection`                  | `#eef5f2`             | The open row of a list                                             |
| `--review`                     | `#5a48c8`             | Awaits a human decision: In review, Uncertain                      |
| `--success`                    | `#1c7a4a`             | Dispatched, Delivered, Active                                      |
| `--danger`                     | `#b42318`             | Failure, error, deletion                                           |
| `--held`                       | `#9a5b00`             | Suspended, Held, warning                                           |
| `--severity-1…4`               | `#87938e` → `#b4161b` | Gauge: Cosmetic, Minor, Major, Blocking                            |
| `--hue-0…7`                    | muted hues            | A Project's identity, on its avatar only (`ProjectAvatar`)         |

Each semantic color has a `-soft` variant for backgrounds. Dark mode (`prefers-color-scheme: dark`) redefines every token with its own values; no component uses a literal color.

### Typography

- **Instrument Sans** (variable, `@fontsource-variable/instrument-sans`) for everything.
- **JetBrains Mono** (`@fontsource/jetbrains-mono`) only for actual technical values: keys, webhook URLs, identifiers. Never for a label.
- Fonts are bundled in the build: the self-hosted Instance contacts no third-party service.
- Scale: `--t-xs` 12, `--t-s` 13 (metadata, field labels), `--t-m` 14 (body text), `--t-l` 16 (panel titles, a Feedback's text), `--t-xl` 20 (screen title), `--t-2xl` 28 (public screens). Weights: 400, 500 (labels, buttons), 600 (titles).
- Tabular figures (`tabular-nums`) wherever numbers are compared: dates, counters, attempts.

### Shape and motion

- Radii: `--r-small` 4 px (crumbs, keys), `--r-control` 6 px (buttons, fields, chips), `--r-panel` 10 px (panels, lists, menus), `--r-sheet` 12 px (the sheet), pill for pills.
- Shadows stay faint: `--shadow-control` (1 px) under controls and panels, `--shadow-sheet` outlines the sheet, `--shadow-floating` only for what floats (account menu, mobile drawer, the public pages' card).
- Sizes: `--topbar-height` 52 px, `--row-height` 40 px, `--gutter` 24 px (16 px below 860 px).
- `--duration` 140 ms, ease-out, only in response to an action. Everything is turned off under `prefers-reduced-motion`.

## Layout

```
┌────────────────────┬────────────────────────────────────────────────┐
│ ▂▄▆█ nudge         │ Projects › Storefront           [action]      │ ← top bar (sticky)
│ ▤ Inbox            ├────────────────────────────────────────────────┤
│ ◉ 2 in review      │ Destinations  Incidents  Settings              │ ← tabs, if any
│ Projects        +  ├────────────────────────────────────────────────┤
│ S Storefront     8 │ All  Open  Closed          ≡ Level ▾ Env ▾     │ ← toolbar, on lists
│ A Atlas app        ├────────────────────────────────────────────────┤
│                    │ rows across the whole sheet                    │
│ ⚇ Members          │                                                │
│ ⚙ Settings         │                                                │
│ (a) ada@… ⇕        │                                                │
└────────────────────┴────────────────────────────────────────────────┘
```

- Three planes: the frame (sidebar), the sheet (`--canvas`), then raised surfaces (panels, menus).
- `Layout`: 244 px sidebar on the frame; the content is a sheet beside it, which scrolls on its own while the sidebar stays. Below 860 px, the sheet fills the screen under a mobile bar, and the sidebar becomes a drawer opened by the menu button (closed by Escape, the backdrop or a navigation).
- Sidebar, top to bottom: the brand, the main navigation (`layout/navigation.ts`, each entry with its icon), the alerts, the Projects (avatar, name, counter; "+" opens the creation form), then Members, Settings and the account button. The account button opens a menu with the email, the language and "Sign out"; Escape or a click elsewhere closes it.
- Alerts (`Alerts`): In review in violet, suspended Destination in amber, each with its icon.
- `PublicPage`: screens without a session (setup, sign in, invitation), a centered 400 px column on the frame, the form on a floating card. The session guard's loading and error states use the same centered frame.
- `ErrorBoundary`: an unexpected render error shows what happened and "Reload", never a blank page.
- `LocaleSelect`: the language, per browser; in the account menu and at the foot of a `PublicPage`.

## Brand

The mark is the Severity gauge at its full level: four rising bars, in the accent. `Brand` (`layout/Layout.tsx`) draws it beside the name; the same geometry is in `docs/assets/` (`logo.svg`, `logo-dark.svg` with the outlined wordmark, `mark.svg`, `social-preview.png` for the repository) and `apps/dashboard/public/` (favicon and app icon: white bars on an accent tile).

## Primitives

| Primitive                                                                   | Where                 | When                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`                                                                | `ui.tsx`              | At the top of every signed-in screen: the sticky top bar with the parent (`back`, as a crumb), the title (the only `h1`) and the actions; the description follows under it. Names the browser tab. |
| `EmptyState`                                                                | `ui.tsx`              | A list or section with no content, centered: an `icon` for what would be here, say why, offer the action that fills it.                                                                            |
| `Loading`                                                                   | `ui.tsx`              | During a request: row skeletons, announced as "Loading…".                                                                                                                                          |
| `ErrorMessage`                                                              | `ui.tsx`              | API error, in plain words and with the action to take (codes in the dictionaries' `apiErrors`). `onRetry` adds "Retry" on a read that failed.                                                      |
| `Field`                                                                     | `ui.tsx`              | A text field with a label and help text. A value the browser refuses is said under the field (`.field-error`), and the first one takes focus.                                                      |
| `CopyableValue`                                                             | `ui.tsx`              | Key or link to copy; `multiline` for a block of code (a JSON body, a snippet), with the button in its corner.                                                                                      |
| `ConfirmAction`                                                             | `ui.tsx`              | Irreversible action behind a button: the confirmation opens in place, with focus on Cancel. Escape cancels and returns focus to the button.                                                        |
| `Confirmation`                                                              | `ui.tsx`              | The same question, triggered another way, for example a save that erases data (shorter retention).                                                                                                 |
| `SaveStatus`                                                                | `ui.tsx`              | "Saved." after a save, announced to screen readers. The form clears it as soon as it changes (`onChange={() => mutation.reset()}`).                                                                |
| `useReturnFocus`                                                            | `ui.tsx`              | Returns focus to the button that opened a form (Correct, Edit) when the form closes.                                                                                                               |
| `ExternalLink`                                                              | `ui.tsx`              | Any URL coming from outside (a link only for http(s)).                                                                                                                                             |
| `Pill`                                                                      | `ui.tsx`              | A State or a Status, colored by a tone: `neutral`, `success`, `review`, `danger`, `held`, `off`.                                                                                                   |
| `SeverityGauge`                                                             | `feedback-badges.tsx` | A Feedback's Severity; `large` in the detail view. Dotted when there is no Severity.                                                                                                               |
| `StatePill`, `DeliveryStatusPill`, `DestinationStatePill`, `UncertainBadge` | `feedback-badges.tsx` | Domain values, with their tone set once and for all.                                                                                                                                               |
| `ProjectAvatar`                                                             | `feedback-badges.tsx` | A Project's initial on its hue (drawn from its id), always beside its name: sidebar, Inbox rows, Project list.                                                                                     |
| `LevelPill`, `IncidentStatePill`                                            | `feedback-badges.tsx` | An Incident's Level (Critical is solid, so it differs from Error without color) and its state.                                                                                                     |
| `Properties`                                                                | `ui.tsx`              | Label / value pairs (`.properties`), values rendered as text.                                                                                                                                      |
| `useScrollToHash`                                                           | `ui.tsx`              | A link to a panel (`#settings-smtp`, `#project-incidents`) scrolls to it once the screen is drawn.                                                                                                 |

### Classes

- `.icon`: a `lucide-react` icon. `.icon-button`: a 26 px control holding only an icon (close, previous, next, "+"), named for assistive technologies.
- `.toolbar`: the views and the filters of a list, as one band under the top bar (or the tabs).
- `.menu` (+ `.menu-item`, `.menu-label`, `.menu-separator`): a floating menu, the account's.
- `.avatar`: a Member's initial in a circle (account button, Members).

- `.panel`: a panel, for a whole object (a Verdict, a Destination, a settings section). `PanelHeader` gives it a title with, on the right, a `Pill` of the saved state of what it configures.
- `.field-row`: two related fields side by side (username and password), stacked below 560 px; `.short-end` when the second is short (a port).
- `.list`: a surface with separators, for a collection. No card per item.
- `.linked-row` + `.row-link`: a row that opens its object. The link is stretched over the whole row, which takes the hover and the focus ring: a click anywhere on the row opens it (Inbox, Projects).
- `.form`, `.field`, `fieldset.field` + `.check` (checkboxes as pills), `.actions` (row of buttons), `.help`, `.muted`.
- `.alert` (error), `.warning` (caution, amber), `.empty` (empty state), `.meta` (inline metadata), `.properties` (label / value pairs).
- `fieldset.type-picker` + `.type-option`: a choice between a few kinds of object, as radios carrying a mark (`TypeIcon`) and a name. `fieldset.segmented`: a switch between a few views of the same thing (a webhook's events).
- `fieldset.filter-group`: one Filter of the Destination form (Feedback or Incident), under a hairline: its legend, a `.check` switch that turns it on, then its settings.
- `fieldset.conditions-field` + `.conditions` / `.condition`: a list of rows to add or remove (an Incident Filter's context conditions), each row its fields side by side and its remove button.

### Buttons

- `button` with no class: **solid**, the primary action. At most one per screen or per panel.
- `.secondary`: outlined, for all other actions.
- In the top bar and in a list row, buttons are compact (28–30 px, 13 px text).
- `.ghost`: no outline, for Cancel and low-weight actions.
- `.danger`: solid red, only to confirm a deletion (in `ConfirmAction`).

## Screen patterns

Every signed-in screen starts with `PageHeader`. The patterns below are the shapes already solved: a new screen of the same shape reuses them.

- **List to triage** (Inbox, `screens/Feedbacks.tsx`):
  - `.toolbar` under the top bar: `.views`, shortcuts to a filter, as links with `aria-current`; `.filters` / `.filter`, chips that carry a native `select` and turn accent-tinted when active;
  - `.feedback-list`: rows across the sheet's full width, groups by day (`.day-group`, sticky under the top bar, with their count) and `.feedback-row` rows in a fixed-column grid: gauge, type, text, Project, states, date;
  - the whole row opens the item: a link stretched by `::after`.

  An empty result offers "Clear filters".

- **Reading pane** (Inbox, above 1360 px):
  - like a mail client, the Feedback opens in a pane (`.feedback-pane`) as tall as the sheet, beside the list, which narrows; the open row is tinted (`--selection`) with an accent edge;
  - the route stays `/feedbacks/:id`, nested under `/feedbacks`; the filters follow in the URL;
  - the detail view knows it is in the pane through the `FeedbackPane` context: its top bar offers Close (×), and its title becomes an `h2`;
  - J and K move to the next or previous Feedback, and Escape closes the pane;
  - rows and detail adapt to the space they have, through container queries (`list`, `detail`) rather than the screen width.
    Below 1360 px, the Feedback opens as a full page.

- **Item detail** (a Feedback's detail, `screens/Feedback.tsx`):
  - `.trail` is the detail's top bar: the crumb back to the originating list, with its filters, then the position and Previous / Next (up / down icons) from the `ListState` navigation state;
  - `.feedback-grid`: content and decision on the left, properties on the right (`.feedback-side`, a `--sunken` column of flat sections separated by hairlines). A single column when the detail is narrower than 720 px;
  - a decision awaiting a Member is shown as a banner (`.review-banner`), above everything else.
- **Incident list** (a Project's Incidents tab, `screens/Incidents.tsx`): the Inbox's views and filters, without day groups; `.incident-row` puts the Level first, then the title, Environment, Occurrences, state and last seen. The detail (`screens/Incident.tsx`) states Level, state, Environment and Occurrences under its title, then the first and last Occurrence beside the Incident's properties.
- **Tabbed object** (Project, `ProjectHeader` in `screens/Project.tsx`):
  - a shared top bar (`Projects › name`) and `.tabs` as `NavLink`s across the sheet, one route per tab, the active one underlined;
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
- A crumb names the parent screen ("Projects", "Incidents"), not an instruction ("Back to…"); the arrow is the chevron between crumbs.
