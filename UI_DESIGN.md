# ConnectSphere — User Interface Design

**Story:** SPM-7 — *As a development team, we want to design a consistent user
interface so that users can navigate ConnectSphere and complete tasks
efficiently.*

This document is the reference the team builds screens against. It names every
screen in the first release, defines how users move between them, fixes the
rules that keep the interface consistent across the five roles, and specifies
form fields, validation, and error states.

Companion documents:

- `DOCUMENTATION.md` — how the app is built and how a request flows.
- `SCHEMA_REFERENCE.md` — the data behind every field named here.
- `src/lib/validation/` — the Zod schemas that are the single source of truth
  for field-level validation, one file per domain. **This document never
  invents a rule that contradicts those files.**

---

## 1. Design principles

These four principles resolve most day-to-day layout arguments without a
meeting.

1. **One screen, one job.** A screen answers one question or completes one
   task. Anything else belongs behind a link or a tab.
2. **Status is always visible.** The customer's biggest complaint is that
   nobody knows where an event stands. Every event surface shows its status
   badge and its outstanding actions, without the user having to ask.
3. **The same thing looks the same everywhere.** A status badge, a date, a
   person, an empty list, and a destructive action render identically in every
   role's screens. Roles differ in *what they see and may do*, never in *how it
   looks*.
4. **Never say no without saying why and what next.** A rejection, a conflict,
   or a failed validation always names the reason and the next available
   action.

---

## 2. Roles

The customer briefing names five roles. The database (`users.role`) carries a
sixth, `ops_manager`, because someone has to assign a coordinator to a
submitted event — a coordinator cannot assign themselves before they are
responsible for the event. Treated as an internal admin variant of Coordinator:
identical chrome, one extra screen.

| Key | Label in UI | Internal/External | Home screen after login |
| --- | --- | --- | --- |
| `organiser` | Event Organiser | External | `/dashboard` — my events needing action |
| `coordinator` | Event Coordinator | Internal | `/dashboard` — my assigned events + review queue |
| `venue_staff` | Venue Staff | Internal | `/dashboard` — pending booking requests |
| `tech_support` | Technical Support | Internal | `/dashboard` — pending equipment requests |
| `attendee` | Attendee | External | `/dashboard` — my registrations + open events |
| `ops_manager` | Operations Manager | Internal | `/dashboard` — unassigned submitted events |

**Never show a raw role key to a user.** `venue_staff` is a database value;
"Venue Staff" is what a person reads. Labels live in `src/lib/roles.ts`.

---

## 3. Screen inventory

28 screens. IDs are stable and are what test cases and the product backlog
cite.

### 3.1 Shared — every role

| ID | Screen | Route | Purpose |
| --- | --- | --- | --- |
| S-01 | Login | `/login` | Authenticate. |
| S-02 | Register | `/register` | Create an account. |
| S-03 | Dashboard | `/dashboard` | Role-specific overview: what needs my attention. |
| S-04 | Notifications | `/notifications` | Full notification history, read/unread. |
| S-05 | Profile | `/profile` | Name, contact details, organisation, department. |
| S-06 | Event detail | `/events/[id]` | **The hub.** Role-adaptive view of one event. |

### 3.2 Event Organiser

| ID | Screen | Route | Purpose |
| --- | --- | --- | --- |
| S-07 | My events | `/events` | All my events; drafts visibly separated from submitted. |
| S-08 | Event request form | `/events/new`, `/events/[id]/edit` | Create/edit a request. Save draft or submit. |
| S-09 | Clarification response | `/events/[id]` → Discussion tab | Answer a coordinator's question. |
| S-10 | Change request form | `/events/[id]/change-request` | Request a change after submission. |
| S-11 | Registration list (own event) | `/events/[id]` → Attendees tab | Who registered for my event. |

### 3.3 Event Coordinator

| ID | Screen | Route | Purpose |
| --- | --- | --- | --- |
| S-12 | Review queue | `/queue` | Events assigned to me, grouped by what they need. |
| S-13 | Event review | `/events/[id]/review` | Approve, reject, or request clarification. |
| S-14 | Venue search | `/venues/search?eventId=` | Filter venues against this event's requirements. |
| S-15 | Venue booking request | `/events/[id]/booking/new` | Request a venue from Venue Staff. |
| S-16 | Equipment request | `/events/[id]/equipment` | Record equipment needed. |
| S-17 | Change request review | `/events/[id]/change-requests/[crId]` | Approve/reject a requested change. |
| S-18 | Readiness & confirm | `/events/[id]` → Readiness tab | Checklist gating confirmation. |

### 3.4 Venue Staff

| ID | Screen | Route | Purpose |
| --- | --- | --- | --- |
| S-19 | Venue catalogue | `/venues` | All venues, searchable. |
| S-20 | Venue detail / edit | `/venues/[id]`, `/venues/[id]/edit` | Capacity, layouts, facilities, hours. |
| S-21 | Availability calendar | `/venues/[id]/calendar` | Bookings, holds, and blocks over time. |
| S-22 | Booking approval queue | `/bookings` | Pending requests to approve or reject. |
| S-23 | Block venue | `/venues/[id]/block` | Record maintenance/renovation unavailability. |

### 3.5 Technical Support

| ID | Screen | Route | Purpose |
| --- | --- | --- | --- |
| S-24 | Equipment catalogue | `/equipment` | Stock, categories, maintenance quantities. |
| S-25 | Equipment request queue | `/equipment/requests` | Review requests, check availability, reserve. |

### 3.6 Attendee

| ID | Screen | Route | Purpose |
| --- | --- | --- | --- |
| S-26 | Browse events | `/browse` | Confirmed, registration-enabled events. |
| S-27 | My registrations | `/registrations` | My registrations and their status; withdraw. |

*(Attendees reach a public view of an event through S-06, rendered with the
attendee variant — see §4.3.)*

### 3.7 Operations Manager

| ID | Screen | Route | Purpose |
| --- | --- | --- | --- |
| S-28 | Assignment queue | `/assignments` | Submitted events with no coordinator. |

---

## 4. Navigation

### 4.1 Structure

```
+---------------------------------------------------------+
|  Top bar:  ConnectSphere    [search]   (3)   Jordan v    |
+--------------+------------------------------------------+
|              |  Breadcrumb: Events / Annual Conference   |
|  Sidebar     |                                           |
|  (role nav)  |  Page header + primary action             |
|              |                                           |
|  Dashboard   |  Content                                  |
|  My Events   |                                           |
|  Venues      |                                           |
|  ...         |                                           |
+--------------+------------------------------------------+
```

- **Top bar** — identical for every role: product name (links to
  `/dashboard`), notification bell with unread count (→ S-04), user menu
  (Profile, Log out). The user menu shows the role label so a user testing two
  accounts always knows who they are signed in as.
- **Sidebar** — the only role-varying chrome. Items come from `NAV_BY_ROLE` in
  `src/lib/roles.ts`, so a role's navigation is one data structure, not
  scattered conditionals.
- **Breadcrumbs** — shown on every screen more than one level deep. The
  breadcrumb trail is the reliable way back; browser-back is not assumed.

### 4.2 Navigation per role

| Role | Sidebar items |
| --- | --- |
| Organiser | Dashboard · My Events · Notifications |
| Coordinator | Dashboard · Review Queue · All Events · Venues · Equipment · Notifications |
| Venue Staff | Dashboard · Venues · Booking Requests · Notifications |
| Tech Support | Dashboard · Equipment · Equipment Requests · Notifications |
| Attendee | Dashboard · Browse Events · My Registrations · Notifications |
| Ops Manager | Dashboard · Assignments · All Events · Notifications |

### 4.3 Event detail as the hub

S-06 is where the roles converge. Rather than building a separate event screen
per role, one screen renders the tabs the user is entitled to:

| Tab | Organiser | Coordinator | Venue Staff | Tech Support | Attendee |
| --- | --- | --- | --- | --- | --- |
| Overview | yes | yes | yes | yes | public subset |
| Discussion | yes | yes | — | — | — |
| Venue | read-only | yes | yes | — | name only, once confirmed |
| Equipment | read-only | yes | — | yes | — |
| Attendees | yes | yes | — | — | — |
| Readiness | — | yes | — | — | — |
| History | — | yes | — | — | — |

A tab the role cannot see is **not rendered** — not rendered-and-disabled.
Disabled tabs leak the existence of internal planning information, which §8b of
the briefing forbids.

### 4.4 Primary flows

**Organiser — request to confirmation**

```
/dashboard -> /events -> /events/new --save draft--> /events (Drafts)
                             |
                             +--submit--> /events/[id]  (status: submitted)
                                               |
                              coordinator asks clarification
                                               v
                                   /events/[id] Discussion -> reply
                                               v
                                    notification: approved
                                               v
                                    /events/[id]  (confirmed)
```

**Coordinator — planning**

```
/queue -> /events/[id]/review --approve--> /events/[id]
                                                |
                     +--------------------------+---------------+
                     v                                          v
      /venues/search?eventId=  ->  /events/[id]/booking/new     /events/[id]/equipment
                     |                                          |
           venue staff decides                        tech support reserves
                     +---------------------+--------------------+
                                           v
                            /events/[id] Readiness -> Confirm event
```

**Venue Staff — booking decision**

```
/dashboard -> /bookings -> decide (approve | reject + reason)
                   |
                   +-- conflict? -> /venues/[id]/calendar to see why
```

**Attendee — registration**

```
/browse -> /events/[id] -> Register -> /registrations
                               |
                           event full -> join waiting list
```

### 4.5 Responsive behaviour

The briefing requires desktop and mobile (§7). One breakpoint, `md` (768px):

- **≥ md** — sidebar fixed at 240px, content beside it, tables as tables.
- **< md** — sidebar becomes a slide-over behind a hamburger; tables become
  stacked cards (label above value); the primary action moves to a sticky
  bottom bar so it stays reachable. Venue Staff use this on their feet in a
  room, so booking decisions must work one-handed.

---

## 5. Consistency rules

What makes the interface feel like one system.

### 5.1 Page anatomy

Every content screen, in order: breadcrumb → page title → optional subtitle →
primary action (top-right, one per screen) → filters → content → empty state if
content is empty. Secondary actions are buttons of lower emphasis beside the
primary one, never a competing primary.

### 5.2 Status badges

Status is rendered by one component, `StatusBadge`, never by ad-hoc spans. It
maps the database string to a human label and a fixed tone:

| Status | Label | Tone |
| --- | --- | --- |
| `draft` | Draft | neutral (grey) |
| `submitted` | Submitted | info (blue) |
| `under_review` | Under review | info (blue) |
| `approved` | Approved | progress (indigo) |
| `planning` | Planning | progress (indigo) |
| `confirmed` | Confirmed | success (green) |
| `completed` | Completed | neutral (grey) |
| `postponed` | Postponed | warning (amber) |
| `rejected` | Rejected | danger (red) |
| `cancelled` | Cancelled | danger (red) |

Booking (`pending` / `approved` / `rejected` / `cancelled`), equipment
(`requested` / `under_review` / `reserved` / `partially_fulfilled` /
`unavailable`) and registration (`registered` / `waitlisted` / `withdrawn` /
`attended`) statuses use the same component and the same tone vocabulary.
Colour is never the only signal — the label carries the meaning for colour-blind
users.

### 5.3 Data formatting

| Data | Format | Example |
| --- | --- | --- |
| Date | `D MMM YYYY` | 3 Oct 2026 |
| Date + time | `D MMM YYYY, HH:mm` | 3 Oct 2026, 14:00 |
| Time range | `HH:mm–HH:mm` | 09:00–17:00 |
| Duration | rounded, human | 3h 30m |
| Person | full name, role label beneath in lists | Jordan Tan / Event Coordinator |
| Venue | name, then code in muted text | Marina Grand Hall (MAR-GH) |
| Capacity | `used / total` | 120 / 250 |
| Empty value | em dash, never blank | — |

Times are shown in Singapore time throughout; no timezone picker in release 1.

### 5.4 Component vocabulary

Screens are assembled from these, in `src/components/ui/`:

`Button` (primary / secondary / danger / ghost) · `Field` (label + control +
hint + error) · `Input` · `Textarea` · `Select` · `Checkbox` ·
`CheckboxGroup` · `Card` ·
`StatusBadge` · `Alert` (info / success / warning / error) · `EmptyState` ·
`PageHeader` · `Breadcrumb` · `Table` (responsive) · `Tabs` · `Spinner` ·
`ConfirmDialog`.

Nothing new gets a bespoke style. If a screen needs something not on this list,
it is added to the list first.

---

## 6. Forms

### 6.1 Form conventions

- Labels sit above inputs, always visible — never placeholder-only, which
  disappears once typing starts and fails screen readers.
- Required fields are marked with `*`. Optional fields are not marked; a form
  where most fields are optional instead marks the optional ones, and says so.
- Fields are grouped into titled sections when a form exceeds roughly 8 fields.
- Hint text under a field explains *why* the system needs it, where that is not
  obvious ("Used to check the venue is large enough").
- Every form ends with a primary submit and a cancel that returns to where the
  user came from. Long forms show the submit in a sticky footer.
- **Draft-first.** Where a draft exists (S-08), the form has two submits: "Save
  draft" (no validation beyond title) and "Submit request" (full validation).

### 6.2 S-08 Event request form

The core form of the system. Six sections, matching `createEventSchema`.

| Section | Field | Control | Required to submit | Rule |
| --- | --- | --- | --- | --- |
| **Basics** | Event title | text | yes | 1+ characters |
| | Category | select | yes | conference, workshop, training, exhibition, meeting, seminar, networking, other |
| | Purpose | textarea (2 rows) | — | |
| | Description | textarea (4 rows) | — | |
| **Schedule** | Starts at | datetime | yes | must be in the future |
| | Ends at | datetime | yes | must be after Starts at |
| **Attendance** | Expected attendance | number | yes | positive integer |
| | Preferred layout | select | — | theatre, classroom, boardroom, banquet, exhibition, u-shape, cabaret |
| **Requirements** | Required facilities | checkbox group | — | ids from `GET /api/facilities` where category = `facility` |
| | Accessibility needs | checkbox group + notes | — | ids from `GET /api/facilities` where category = `accessibility`, plus free-text notes |
| | Special requirements | textarea | — | |
| **Equipment** | Equipment needed | repeatable row: item + quantity + technical requirements | — | quantity ≥ 1; one row per item; requires event dates |
| **Registration** | Enable attendee registration | checkbox | — | |
| | Registration capacity | number | yes *if enabled* | positive integer |
| | Registration opens / closes | datetime x2 | — | closes after opens; both before event start |

Conditional fields (capacity, open/close dates) are hidden until the checkbox is
ticked rather than disabled — a disabled field the user cannot explain is worse
than no field.

**Draft completeness.** A draft may be missing anything. Leaving draft may not:
`PATCH /api/events/[id]` refuses a submission unless title, category, starts at,
ends at, and expected attendance are all present. The form mirrors that set
exactly — "Save draft" validates only the title, "Submit request" validates the
five. Getting this wrong in the client produces a form that lets the user press
Submit and then shows a server error, which is the thing the spec exists to
prevent.

### 6.3 Other forms

| Screen | Fields | Notes |
| --- | --- | --- |
| S-01 Login | Email, Password | |
| S-02 Register | Name, Email, Password, Role, Organisation (external roles only) | Password min 8. Role select shows labels, submits keys. **Role offers Event Organiser and Attendee only** — staff accounts are not self-service (see `docs/PERMISSIONS.md` §1). |
| S-13 Event review | Decision (approve / reject / request clarification), Message or Reason | Reason **required** when rejecting — enforced server-side in `events/[id]/route.ts`. |
| S-15 Venue booking request | Venue (prefilled from search), Layout, Start, End, Requirements note | Start/End default to the event's times and are editable to cover setup. |
| S-16 Equipment request | Equipment item, Quantity, Technical requirements, Start, End | Start/End default wider than the event — kit leaves early, returns late. |
| S-10 Change request | Reason *, Proposed start, Proposed end, Proposed attendance, Other changes | At least one proposed change required. Significant-change warning shown live — see §7.4. |
| S-20 Venue edit | Code, Name, Building, Floor, Address, Max capacity, Opens/Closes, Setup/Teardown minutes, Facilities, Per-layout capacities | Per-layout capacity is a repeatable row. |
| S-23 Block venue | Start, End, Reason (select), Notes | Warns if the block collides with an approved booking. |
| S-24 Equipment catalogue | Name, Category, Description, Total quantity, Quantity in maintenance | Maintenance quantity ≤ total. |
| S-26 Register for event | Dietary requirements, Accessibility requirements | Both optional and free text. |

---

## 7. Validation and error states

### 7.1 When validation runs

| Moment | Behaviour |
| --- | --- |
| While typing | Nothing. Validating a half-typed email address is noise. |
| On blur | Validate that field only, if it has been touched. |
| On submit | Validate everything. Focus and scroll to the **first** error. |
| Server response | Map `details` from the Zod `flatten()` payload back onto the offending fields. |

Client validation mirrors `src/lib/validation/` — it is a convenience, never
the authority. The server validates every request regardless.

### 7.2 How errors appear

- **Field error** — red text under the field, plus a red border and
  `aria-invalid`. The message says what to do: "Ends at must be after starts
  at", not "Invalid".
- **Form error** — an `Alert` (error) at the top of the form for anything not
  attributable to a single field.
- **Page error** — replaces the content area, with a retry action.
- **Toast** — only for successful actions. Never for errors: they disappear
  before they are read.

### 7.3 The four states of every data screen

Every screen that loads data specifies all four. A screen is not done until it
does.

1. **Loading** — skeleton rows matching the eventual layout, not a spinner that
   shifts the page when it resolves.
2. **Empty** — an `EmptyState`: what this screen is for, and the action that
   fills it ("No events yet. Create your first request.").
3. **Error** — what failed and a Retry button. Never a blank page.
4. **Loaded** — the content.

### 7.4 Domain error and warning states

These come from the customer's actual pain points and are the ones worth
getting right.

| Situation | Where | What the user sees |
| --- | --- | --- |
| Attendance exceeds venue capacity | S-14 venue search, S-18 readiness | Venue shown but greyed with "Capacity 200 — your event expects 250". Not hidden; the coordinator may still want to ask. |
| Required facility missing | S-14 | "Missing: hearing loop" listed on the venue card; venue ranked below full matches. |
| Venue double-booking | S-15 submit, S-22 approve | Blocking error naming the conflicting event and its times, with a link to the S-21 calendar. |
| Booking overlaps setup/teardown | S-15 | Warning, not a block: "This starts 20 min after the previous event ends; this venue needs 30 min turnaround." |
| Venue blocked for maintenance | S-14, S-15 | Venue excluded from results with the reason shown on expand. |
| Insufficient equipment | S-25 | "4 requested, 2 available for these dates." Tech Support may reserve a partial quantity, giving status `partially_fulfilled`. |
| Equipment in maintenance | S-24, S-25 | Availability shown as `total − maintenance − reserved`; the breakdown is visible, not just the result. |
| Registration full | S-26 | Register button becomes "Join waiting list" with the current waiting-list position. |
| Registration not open or closed | S-26 | Button disabled with the date: "Registration opens 1 Oct 2026". |
| Already registered | S-26 | Button replaced by registration status plus Withdraw. |
| Significant change proposed | S-10, S-17 | Amber warning listing exactly which arrangements will need re-checking (venue, equipment, registrations). |
| Event cancelled with live bookings | S-06 cancel | `ConfirmDialog` listing the bookings and reservations that will be released. |
| Rejecting without a reason | S-13, S-22 | Submit blocked; reason field errors. The server enforces this too. |
| Session expired | any | Redirect to `/login?next=<path>` with an info alert: "Your session expired. Log in to continue." The intended destination is preserved. |
| Not authorised for a record | any | 403 page: "You don't have access to this event." No detail about the record — that would leak it. |

### 7.5 Destructive and irreversible actions

Cancel event, withdraw registration, reject booking, and delete venue all go
through `ConfirmDialog`, which names the specific consequence ("This releases
Marina Grand Hall on 3 Oct and cancels 42 registrations"). A generic "Are you
sure?" is not acceptable.

---

## 8. Accessibility baseline

Non-negotiable, and cheap when done from the start:

- Every input has a `label` bound by `htmlFor` / `id`.
- Errors are linked with `aria-describedby` and the field carries
  `aria-invalid`.
- Keyboard reachable throughout; the visible focus ring is never removed.
- Colour contrast at least 4.5:1 for text; status meaning never carried by
  colour alone.
- One `h1` per screen; headings descend without skipping levels.
- Dialogs trap focus and close on `Esc`.

---

## 9. Traceability

| Core feature (Week 4) | Screens |
| --- | --- |
| User Authorisation and Authentication | S-01, S-02, plus role-gated nav (§4.2) and tabs (§4.3) |
| Event Request Creation | S-08 |
| Draft Event Requests | S-07, S-08 |
| Event Review and Approval | S-12, S-13 |
| Coordinator Assignment | S-28 |
| Event Status Management | S-06 (badge and History tab), §5.2 |
| Event Information Management | S-08 edit mode, S-06 |
| Venue Catalogue | S-19, S-20 |
| Venue Availability Calendar | S-21 |
| Venue Search and Filtering | S-14 |
| Venue Suitability Checking | S-14, §7.4 |
| Venue Booking Request | S-15 |
| Venue Booking Approval | S-22 |
| Booking Conflict Detection | S-15, S-21, S-22, §7.4 |
| Equipment Request Management | S-16, S-25 |
| Equipment Availability Checking | S-25, §7.4 |
| Equipment Reservation | S-25 |
| Attendee Registration | S-26, S-27, S-11 |
| Event Change Requests | S-10, S-17 |
| Notification System | S-04 and the top-bar bell (§4.1) |

---

## 10. Implementation status

This document specifies the whole first release. What is built so far:

| Built | Where |
| --- | --- |
| App chrome: top bar, role-aware sidebar, mobile slide-over, skip link | `src/components/AppShell.tsx` |
| Role, navigation and event-tab model | `src/lib/roles.ts` |
| Status labels and tones (§5.2) | `src/lib/statuses.ts` |
| Display formatting (§5.3) | `src/lib/format.ts` |
| Component vocabulary (§5.4) | `src/components/ui/` |
| Validation and server-error mapping (§7.1, §7.2) | `src/lib/formErrors.ts` |
| S-01 Login, including the `?next=` return path | `src/app/login/page.tsx` |
| S-02 Register — reference implementation of the validation pattern | `src/app/register/page.tsx` |
| S-03 Dashboard, role-aware | `src/app/dashboard/page.tsx` |
| S-07 My events, drafts separated | `src/app/events/page.tsx` |
| S-08 Event request form, draft and submit | `src/app/events/new/page.tsx` |
| Facility and accessibility requirements as rows (§6.2) | `src/app/api/facilities/route.ts`, `createEventSchema.facilityIds` |
| Equipment requests from the organiser's form (§6.2) | `createEventSchema.equipment`, `src/app/api/events/route.ts` |

Specified but not yet built, and why:

| Not built | Blocked on |
| --- | --- |
| S-06 event detail, S-12–S-18, S-19–S-25, S-26–S-28. | Their endpoints do not exist yet. |

**Requirements are now rows, not prose.** An organiser ticks facilities and
accessibility needs from `GET /api/facilities`, and they are written to
`event_facility_requirements`; equipment is chosen as item + quantity and
written to `equipment_requests`. This is what makes S-14 buildable: venue
suitability has to match an event's needs against what each venue has, and
free text cannot be matched. Two consequences worth knowing:

- **Equipment needs dates.** `EquipmentRequest.starts_at` / `ends_at` are NOT
  NULL and are derived from the event's own times, so the Equipment section of
  S-08 stays hidden until the event has a start and an end — the same pattern
  as registration capacity. The reservation window is the event's times plus
  two hours either side for load-in and load-out; Technical Support adjusts it
  on review.
- **One row per item.** `equipment_requests` is unique on
  `(event_id, equipment_id)`, so the same item cannot be requested twice in one
  event. Both the form and `createEventSchema` reject it with a message naming
  the problem rather than letting the database raise a constraint error.

Everything an organiser ticks is stored as mandatory. The nice-to-have case
(`is_mandatory: false`) is a coordinator refinement and is not exposed on the
organiser's form.

---

## 11. Open questions for the customer

To raise at the next Q&A session:

1. Who assigns coordinators — a dedicated Operations Manager, or do
   coordinators pick up work from a shared queue? (Determines whether S-28 and
   the `ops_manager` role survive.)
2. Are tentative venue holds in scope for release 1, or only pending and
   approved bookings?
3. Can an Organiser edit a submitted request directly, or must every change go
   through a change request (S-10)?
4. Should attendees see the venue before an event is confirmed?
5. Does a waiting list auto-promote when someone withdraws, or does a
   coordinator approve the promotion?
