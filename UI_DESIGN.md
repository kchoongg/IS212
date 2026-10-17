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
identical chrome, one extra screen. A seventh, `safety_officer`, came with the
Week 7 changes (change #6, SPM-85): it reviews the operational safety of an
event once its arrangements are made, reading what a review needs and
changing nothing.

| Key | Label in UI | Internal/External | Home screen after login |
| --- | --- | --- | --- |
| `organiser` | Event Organiser | External | `/dashboard` — my events by status: Drafts, Under review, Approved, Planning |
| `coordinator` | Event Coordinator | Internal | `/dashboard` — my assigned events by status: Awaiting your review, Approved, Planning |
| `venue_staff` | Venue Staff | Internal | `/dashboard` — pending booking requests |
| `tech_support` | Technical Support | Internal | `/dashboard` — pending equipment requests |
| `attendee` | Attendee | External | `/dashboard` — my registrations + open events |
| `ops_manager` | Operations Manager | Internal | `/dashboard` — unassigned submitted events |
| `safety_officer` | Safety Officer | Internal | `/dashboard` — events awaiting their safety check |

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
| S-03 | Dashboard | `/dashboard` | Role-specific overview: what needs my attention. For an organiser and a coordinator, one section per status, each showing the five most recently updated events with a "View all" link — an overview, not the list. |
| S-04 | Notifications | `/notifications` | Full notification history, newest first: what happened, the event and its reference, and when. Unread ones bold with an "Unread" label and "Mark as read"; "Mark all as read" in the header; selecting one marks it read and opens its event, or the Venue or Equipment tab for an arrangement that needs review (SPM-71). Empty state "No notifications". |
| S-05 | Profile | `/profile` | Name, contact details, organisation, department. |
| S-06 | Event detail | `/events/[id]` | **The hub.** Role-adaptive view of one event. |

### 3.2 Event Organiser

| ID | Screen | Route | Purpose |
| --- | --- | --- | --- |
| S-07 | My events | `/events` | All my events; drafts visibly separated from submitted. |
| S-08 | Event request form | `/events/new`, `/events/[id]/edit` | Create/edit a request. Save draft or submit. |
| S-09 | Clarification response | `/events/[id]` → Discussion tab | Answer a coordinator's question. |
| S-10 | Change request form | `/events/[id]/change-request` | Request a change after submission. |
| S-11 | Registration list (own event) | `/events/[id]/attendees` (Attendees tab) | Who registered for my event (SPM-65). Above the table: "3 of 3 places taken · 1 on the waiting list" (no limit when capacity isn't set). Columns Attendee (with "Added by <name>" for a manually added attendee), Contact (email, phone), Status (Registered, Waiting list, Withdrawn, Attended) and Registered (date, plus "Withdrew …"), oldest first. Re-reads every 15 seconds while in view. When registration is not enabled it says so instead of showing an empty list. Only the organiser who raised the event and the assigned coordinator: anyone else, including another organiser at the same client and a coordinator not assigned to the event, has no Attendees tab, and typing its address shows "Not authorised". |

### 3.3 Event Coordinator

| ID | Screen | Route | Purpose |
| --- | --- | --- | --- |
| S-12 | Review queue | `/queue` | Events assigned to me, grouped by what they need. |
| S-13 | Event review | `/events/[id]/review` | Approve, reject, or request clarification. |
| S-14 | Venue search | `/venues/search?event=EVT-000123` | Filter venues against this event's requirements. Built (SPM-40): shows only matching venues; the greyed "not suitable, and why" view is the event's Venue tab (SPM-41). |
| S-15 | Venue booking request | `/events/[id]/booking/new` | Request a venue from Venue Staff. The event's requests are listed on its Venue tab ("Booking requests" card), where the assigned coordinator can **Withdraw request** (Pending) or **Release booking** (Approved), each behind a confirmation with an optional reason (SPM-67). The row stays, as Withdrawn or Released (grey), with "Reason for withdrawal/release: …"; a release notifies Venue Staff. A pending request reads "Hold expires <date, time>"; one not approved in time stays as **Expired** (grey) with "Hold expired on <date, time>" (SPM-82). |
| S-16 | Equipment request | `/events/[id]/equipment` | Record equipment needed. |
| S-17 | Change request review | `/events/[id]/change-requests/[crId]` | Approve/reject a requested change. |
| S-18 | Readiness | `/events/[id]/readiness` | What still prevents confirmation. Built (SPM-33): one item per venue booking, equipment line and registration setup, and the Operational Safety Check last - Complete, Outstanding or Not required - and the assigned coordinator can mark one as not required (never the safety check). Confirm event stays on the Overview (SPM-34). A booking or equipment line that is flagged for review gives the assigned coordinator **Keep booking** / **Keep reservation** (only while it still meets the event's requirements; otherwise what is unmet, and that it can't be kept) and a "Review in Flagged Arrangements" link (S-30, SPM-68), where a replacement is found. |
| S-30 | Flagged Arrangements | `/flagged` | Built (SPM-68): every venue booking, equipment reservation and registration list on the coordinator's own events that a change has flagged for review, most recently flagged first, on three tabs - "Venue bookings", "Equipment reservations" and "Registrations" (`?tab=venue`, `?tab=equipment`, `?tab=registrations`), each with how many are flagged. Opened without a tab it shows the first one with something in it; an empty tab says "No venue bookings are flagged" (and likewise), and the page says "Nothing is flagged", with no tabs, when there is nothing at all. Each item shows the event, the arrangement (for a booking, the space it is for: "Space: Breakout room", SPM-90), "Flagged because: …" and how it stands against the event now: "Suitability: Suitable / Not suitable" and "Availability: Available / Not available" with what is unmet, "Availability: 2 reserved, 4 available for these dates.", or "12 registered, 3 on the waiting list". **Keep booking** / **Keep reservation** / **Mark as reviewed** clear the flag and change nothing else. A booking or reservation that no longer meets the event's requirements has no Keep button: its item says "This booking can't be kept while it doesn't meet the event's requirements." under what is unmet (the server refuses too, for a page showing an older result). A flagged item that was marked as not required on Readiness is still listed, saying so; an event that is completed, cancelled, rejected or withdrawn is not listed at all. An equipment item has **Open Equipment tab**, and a registrations item **Open Overview** (where "Change registration settings" is). A booking also has **Find a replacement venue** (S-14, filled in from that booking) and **Open Venue tab**: the page clears flags and never changes an arrangement, so releasing or withdrawing the booking is done on the event's Venue tab (SPM-67). Every other role sees "You do not have access to this". |

### 3.4 Venue Staff

| ID | Screen | Route | Purpose |
| --- | --- | --- | --- |
| S-19 | Venue catalogue | `/venues` | All venues, searchable. |
| S-20 | Venue detail / edit | `/venues/[id]`, `/venues/[id]/edit` | Capacity, layouts, facilities, hours. |
| S-21 | Availability calendar | `/venues/[id]/availability` | Bookings, holds, and blocks over time: one row per day, each entry at its actual times, with setup and turnaround as their own entries (SPM-93). |
| S-22 | Booking approval queue | `/bookings` | Pending requests to approve or reject, one card each (SPM-42 list, SPM-43 decision). Approve asks for confirmation; Reject opens a form on the card — reason (required), suggested venue and alternative arrangement (both optional). A request that would clash shows "Conflict", says what with, links to S-21 and cannot be approved. The mockup's "Suggest another room" button and "Approve anyway" turnaround warning are superseded. A request the coordinator withdraws leaves the list (SPM-67). Each card has a **Hold expires** row ("No expiry set" for a hold made before SPM-82) with **Change expiry**, which opens "New expiry" with **Save expiry** / **Cancel**; success says "Hold expiry changed to <date, time>." A hold whose expiry passes becomes Expired and leaves the list (SPM-82). |
| S-23 | Block venue | — (on S-20) | Record a period the venue is unavailable for. Built in SPM-45 as the "Unavailable periods" section and "Mark unavailable" dialog on the venue editor (S-20), not as a page of its own: the date and time it becomes unavailable and is available again (15-minute grid), a reason, and a typed reason when it is Other. |

### 3.5 Technical Support

| ID | Screen | Route | Purpose |
| --- | --- | --- | --- |
| S-24 | Equipment catalogue | `/equipment` | Stock, categories, units out of service and why; Technical Support record and return them (SPM-55). |
| S-25 | Equipment request queue | `/equipment/requests` | Review requests, check availability, reserve. |

### 3.6 Attendee

| ID | Screen | Route | Purpose |
| --- | --- | --- | --- |
| S-26 | Browse events | `/browse` | Confirmed, registration-enabled events, each with a registration badge (Open, Not open yet + "Opens <date>", Closed, Full, Dates not set), soonest first (SPM-51). Registering happens on the event page's "Your registration" card. |
| S-27 | My registrations | `/registrations` | My registrations and their status (SPM-51). Each Registered row for an event that isn't cancelled, completed or over has **Withdraw** (SPM-52), behind the same dialog as on S-06; afterwards "You have withdrawn from <event title>." and the row stays, as Withdrawn. |

*(Attendees reach a public view of an event through S-06, rendered with the
attendee variant — see §4.3.)*

### 3.7 Operations Manager

| ID | Screen | Route | Purpose |
| --- | --- | --- | --- |
| S-28 | Assignment queue | `/assignments` | Submitted events with no coordinator. |

### 3.8 Safety Officer

| ID | Screen | Route | Purpose |
| --- | --- | --- | --- |
| S-29 | Safety Checks | `/safety-checks` | Events submitted for an Operational Safety Check (SPM-85): Event, Client, When, Expected attendance and Submitted ("10 Oct 2026 by Daniel Tan"), oldest first. Each opens the event's Overview. Every other role sees "You do not have access to this". |

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
| Coordinator | Dashboard · Review Queue · Flagged Arrangements · All Events · Venues · Equipment · Notifications |
| Venue Staff | Dashboard · Venues · Booking Requests · Notifications |
| Tech Support | Dashboard · Equipment · Equipment Requests · Notifications |
| Attendee | Dashboard · Browse Events · My Registrations · Notifications |
| Ops Manager | Dashboard · Assignments · All Events · Notifications |
| Safety Officer | Dashboard · Safety Checks · All Events · Notifications |

### 4.3 Event detail as the hub

S-06 is where the roles converge. Rather than building a separate event screen
per role, one screen renders the tabs the user is entitled to:

| Tab | Organiser | Coordinator | Venue Staff | Tech Support | Attendee | Safety Officer |
| --- | --- | --- | --- | --- | --- | --- |
| Overview | yes | yes | yes | yes | public subset | yes |
| Discussion | yes | yes | — | — | — | — |
| Venue | read-only | yes | yes | — | name only, once confirmed | — |
| Equipment | read-only | yes | — | yes | — | read-only |
| Attendees | yes | yes | — | — | — | — |
| Readiness | — | yes | — | — | — | — |
| History | — | yes | — | — | — | — |

**What a safety review reads** (SPM-85). The Overview gives ConnectSphere staff
two cards beside Details: **Sessions** (each session's label, then "27 Sept
2027, 09:00–12:00 · 200 people · Theatre"; a session with no label is "Session
1", and a missing value reads "Attendance not set" / "Layout not set") and
**Venue bookings** (each approved booking, labelled with its session or "Whole
event": "Marina Auditorium (MAR-AUD) · Theatre · seats 220" — the seats the
booked layout holds, not the room's largest; "Layout not set" or "capacity not
recorded" where that is missing; "No venue is booked yet." when there is none).
Neither card is shown to the organiser, who learns the room from the Venue row,
or to an Attendee. The Safety Officer has no Venue tab: it is the coordinator's
Find a venue search, and its address refuses every role without venue access
before anything loads — "You do not have access to this", "Finding and booking
a venue is for the Event Coordinator. The rooms booked for this event are on
its Overview."

**Resolving a safety check** (SPM-88). Staff see a **Safety check history**
card under Details: every submission, newest first - "Submitted by Daniel Tan,
8 Oct 2026, 14:00 - Changes requested by Hana Yusof, 9 Oct 2026, 10:00.
Changes required: …", "Awaiting review" while pending, "Closed after a change
on <date>: <what changed>" once closed. Not shown to the organiser or an
Attendee, or before the first submission. Once a check is returned (changes
requested or rejected) and the event is back in Planning, the assigned
coordinator gets **Flag arrangements for review** in the header: a dialog of
the same name with a tick box per venue booking ("Venue: <room>", or "Venue:
<session>: <room>") and equipment line ("Equipment: <item>"), "Flag for
review" / "Cancel", "Choose at least one arrangement to flag." when nothing is
ticked, then "<n> arrangement(s) flagged for review. Nothing has been changed
or cancelled." A significant change in Safety review or Safety approved asks
"Move this event back to Planning?" first on the edit page and the Equipment
tab (the pending check is closed, or the approval cancelled), and the Venue tab
and booking request form say "The safety check was closed" afterwards.

**The Overview's Registration card** (SPM-64) is read-only for every role
that can see the event: Registration (Enabled / Not enabled for this event),
then Capacity, Measured against, Opens and Closes. Attendees don't see
"Measured against", which room caps the capacity, or the amber "Registration
setup is incomplete" alert. Only the assigned coordinator, while the event is
Approved, Planning or Confirmed, gets "Change registration settings", which
turns the card into a form: "Attendees need to register for this event",
Registration capacity, Capacity measured against (only with two or more active
venue bookings), Registration opens, Registration closes, and "Save
registration settings" / "Cancel". Each server refusal shows under its own
field, and a save that flags the registrations lists them under "Flagged for
review". The organiser and coordinators also see "Places taken" ("3 of 10 · 7
left", or just the number with no capacity or with registration turned off) and
"Withdrawn" (SPM-52), whether or not registration is enabled; no other role
does.

A tab the role cannot see is **not rendered** — not rendered-and-disabled.
Disabled tabs leak the existence of internal planning information, which §8b of
the briefing forbids.

**Equipment is Organiser: read-only, own event only** (SPM-47). SPM-47's own
AC6 — "Technical Support Staff can view the requirements" — names one role,
but confirmed 2026-09-19 that the Organiser should also see what's been
recorded against the event they raised, even though this is broader than
AC6's literal wording. Scoped to the event they own — an Organiser never sees
another client's equipment planning (§8b). The Coordinator sees it too, but
only because managing it requires seeing it, not as a separate viewing right.

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
                 /events/[id] Submit for safety check (SPM-86) -> Safety Officer
                                           |  approved (SPM-87)
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
| `safety_review` | Safety review | info (blue) — with the Safety Officer (SPM-86) |
| `safety_cleared` | Safety approved | progress (indigo) — approved by the Safety Officer, to be confirmed (SPM-87) |
| `confirmed` | Confirmed | success (green) |
| `completed` | Completed | neutral (grey) |
| `postponed` | Postponed | warning (amber) |
| `rejected` | Rejected | danger (red) |
| `cancelled` | Cancelled | danger (red) |
| `withdrawn` | Withdrawn | neutral (grey) |

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
| **Sessions** | This event has multiple sessions | checkbox | — | Reveals one card per session (at least two) and **hides Schedule, Attendance and Equipment below** — the sessions hold those. Ticking it moves anything already entered there into Session 1 |
| | Session name | text | — | e.g. "Day 1 — Keynotes" |
| | Session starts at / ends at | datetime x2 | yes, **even for a draft** | ends after starts; start in the future (submit only). A session cannot be stored without its times |
| | Session expected attendance | number | yes (submit) | positive integer |
| | Session preferred layout | select | — | same options as event-level |
| | Session equipment | repeatable row, as Equipment below | — | one row per item **across the whole event**; hidden until that session has its times |
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

**Multi-session events.** With the Sessions box ticked the event's own start,
end and attendance are worked out from its sessions (earliest start, latest end,
largest session), so lists elsewhere keep working. Facilities, accessibility
needs and registration stay event-wide — "The venue must have" shows *These apply
to every session*, and registration must open and close before the **first**
session starts.

Conditional fields (capacity, open/close dates) are hidden until the checkbox is
ticked rather than disabled — a disabled field the user cannot explain is worse
than no field.

**Draft completeness.** A draft may be missing anything. Leaving draft may not:
`PATCH /api/events/[id]` refuses a submission unless title, category, starts at,
ends at, and expected attendance are all present. The form mirrors that set
exactly — "Save draft" validates only the title, "Submit request" validates the
five. Getting this wrong in the client produces a form that lets the user press
Submit and then shows a server error, which is the thing the spec exists to
prevent. One exception: when the Sessions box is ticked, "Save draft" also needs
each session's start and end, since a session cannot be stored without them;
its attendance is still only required to submit, and the server then checks
every session has one.

### 6.3 Other forms

| Screen | Fields | Notes |
| --- | --- | --- |
| S-01 Login | Email, Password | |
| S-02 Register | Name, Email, Password, Role, Organisation (external roles only) | Password min 8. Role select shows labels, submits keys. **Role offers Event Organiser and Attendee only** — staff accounts are not self-service (see `docs/PERMISSIONS.md` §1). |
| S-13 Event review | Decision (approve / reject / request clarification), Message or Reason | Reason **required** when rejecting — enforced server-side in `events/[id]/route.ts`. |
| S-15 Venue booking request | Venue (from the Venue tab), Session (multi-session events), What is this space for?, Expected attendance for this space, Room layout, Date, Start time, End time, Venue requirements | Built (SPM-42), in times since SPM-93. Date and times default to the event's or session's own, widened to the 15-minute grid. Times must be on the grid, the end after the start, and cover that time. The setup and turnaround times and the whole room-in-use period are shown under the fields, not chosen. SPM-90: the three space fields start on the event's (or session's) own attendance and layout, or on what the Venue tab's "The space you need" card was last checked for; the purpose starts as "Main programme" for the first booking and empty for a further one. |
| S-16 Equipment request | Equipment item, Quantity, Technical requirements, Start, End | Start/End default wider than the event — kit leaves early, returns late. |
| S-10 Change request | Reason *, Proposed start, Proposed end, Proposed attendance, Other changes | At least one proposed change required. Significant-change warning shown live — see §7.4. |
| S-20 Venue edit | Code, Name, Building, Floor, Address, Max capacity, Opens/Closes, Setup time (minutes), Turnaround time (minutes), Facilities, Per-layout capacities | Per-layout capacity is a repeatable row. Setup and turnaround in 15-minute steps, zero included (SPM-93). |
| S-23 Mark unavailable (dialog on S-20, SPM-45) | Unavailable from + From time, Available again on + Available again at, Reason (select), Other reason (only when the reason is Other) | All four dates and times required, times on the 15-minute grid (SPM-93). The return must be later than the start, and still to come. A period is never refused for the bookings it lands on: they are flagged for review and listed after saving. |
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
| Attendance exceeds venue capacity | S-14 venue search, S-18 readiness | Venue shown but greyed with "Theatre capacity is 200 - this space expects 250." (the space being booked, SPM-90). Not hidden, but it has no "Request booking" button (SPM-42). |
| Required facility missing | S-14 | "Missing: hearing loop" listed on the venue card; venue ranked below full matches. |
| Venue double-booking | S-15 submit, S-22 approve | Blocking error naming the conflicting event and its times, with a link to the S-21 calendar. |
| Booking overlaps setup/teardown | S-15, S-22 | Blocked, like any clash: a booking occupies the room from its start minus the venue's setup to its end plus its turnaround (Week 7 Change #1, SPM-93), so overlapping either is a double-booking (#35). Periods that only meet end to start do not clash. |
| Time off the 15-minute grid, or end not after start | S-15 | Blocked; the message sits under the time field it is about — "Choose a start time on a 15-minute step (:00, :15, :30 or :45).", "Choose an end time on a 15-minute step (:00, :15, :30 or :45).", "The end time must be after the start time." (SPM-93). |
| Room in use outside opening hours | S-15 | Blocked: "<Venue> is open 07:00–22:00. With its 30 min setup and 45 min turnaround, choose times between 07:30 and 21:15." (SPM-93). |
| Venue blocked for maintenance | S-14, S-15 | Venue excluded from results. (SPM-40 shows no reason: AC7 hides non-matching venues outright.) |
| Insufficient equipment | S-25 | "4 requested, 2 available for these dates." Tech Support may reserve a partial quantity, giving status `partially_fulfilled`. |
| Equipment out of service | S-24, S-25 | Availability shown as `total − out of service − reserved`; the breakdown is visible, not just the result. Marking units out of service flags the reservations it leaves short and lists them (SPM-55). |
| Registration full | S-06 "Your registration" | No Register button: "This event is full. You can join the waiting list instead." and, until Join and Respond to Waiting List is built, "Joining the waiting list isn't available yet." (SPM-51). |
| Registration not open or closed | S-06 "Your registration" | No Register button (hidden, not disabled): "Registration opens 1 Nov 2027, 09:00." or "Registration closed on 30 Sept 2026, 17:00." With no dates: "Registration dates haven't been set for this event." (SPM-51). |
| Already registered | S-06 "Your registration" | Register replaced by the status badge and "You registered on <date>." or "You're on the waiting list." (SPM-51). A Registered one also has **Withdraw** (SPM-52): "Withdraw from <event title>?" — "Your place is released and can be taken by someone else. To attend, you would have to register again, and the event may be full by then." — "Keep my place" / "Withdraw"; afterwards "You have withdrawn from this event." and Register is offered again. Waiting list, Attended and Withdrawn have no Withdraw (leaving the waiting list is SPM-66), and neither does any registration once the event is cancelled, completed or past its end. |
| Significant change proposed | S-10, S-17 | Amber warning listing exactly which arrangements will need re-checking (venue, equipment, registrations). |
| Event cancelled with live bookings | S-06 cancel | `ConfirmDialog` listing the bookings and reservations that will be released. |
| Rejecting without a reason | S-13, S-22 | Submit blocked; reason field errors. The server enforces this too. |
| Session expired | any | Redirect to `/login?next=<path>` with an info alert: "Your session expired. Log in to continue." The intended destination is preserved. |
| Not authorised for a record | any | 403 page: "You don't have access to this event." No detail about the record — that would leak it. |

### 7.5 Destructive and irreversible actions

Cancel event, record an event request's withdrawal, withdraw registration, reject
booking, and delete venue all go
through `ConfirmDialog`, which names the specific consequence ("This releases
Marina Grand Hall on 3 Oct and cancels 42 registrations"). A generic "Are you
sure?" is not acceptable.

**Beginning planning is one of these** (SPM-54). The coordinator's first venue
or equipment action on an Approved event moves it to Planning, which cannot be
undone and is visible to the organiser. `BeginPlanningDialog` asks first —
"Begin planning?", naming the status change and who will see it — on Search
(S-14), Submit request (S-15), and Add and Save (S-16). Cancel leaves the
event Approved and does not carry out the action. Remove on S-16 already
confirms, so it adds the same notice to its own dialog rather than asking
twice. Afterwards a "Planning has started" alert confirms the move.

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
| S-29 Safety Checks, the Safety Officer's list (SPM-85) | `src/app/safety-checks/page.tsx`, `src/app/api/safety-checks/route.ts` |
| S-30 Flagged Arrangements, the coordinator's list (SPM-68); and S-14 opened to replace a flagged booking (`?event=…&booking=…`: filled in from the booking, "Request booking" on each result) | `src/app/flagged/page.tsx`, `src/app/api/flagged-arrangements/route.ts`, `src/lib/flaggedArrangements.ts`, `src/lib/flaggedArrangementsService.ts`, `src/app/venues/search/page.tsx` |
| S-04 Notifications, and the unread count on the bell and the sidebar link (SPM-71) | `src/app/notifications/page.tsx`, `src/app/api/notifications/`, `src/lib/notificationView.ts`, `src/components/AppShell.tsx` |
| Overview "Sessions" and "Venue bookings" cards for staff (SPM-85) | `src/app/events/[id]/page.tsx` |
| S-07 My events, drafts separated | `src/app/events/page.tsx` |
| S-08 Event request form, draft and submit | `src/app/events/new/page.tsx` |
| S-08 Sessions section (multi-session events) | `src/components/SessionFields.tsx`, `src/lib/eventSessions.ts` |
| Facility and accessibility requirements as rows (§6.2) | `src/app/api/facilities/route.ts`, `createEventSchema.facilityIds` |
| Equipment requests from the organiser's form (§6.2) | `createEventSchema.equipment`, `src/app/api/events/route.ts` |
| S-14 Venue search and filters (SPM-40) | `src/app/venues/search/page.tsx`, `src/lib/venueSearch.ts`, `src/app/api/venues/search/route.ts` |
| S-16 Equipment requirements tab (SPM-47) | `src/app/events/[id]/equipment/page.tsx` |
| S-18 Readiness tab (SPM-33): what blocks confirmation, "Mark as not required" / "Mark as required", who marked it and when | `src/app/events/[id]/readiness/page.tsx`, `src/lib/eventConfirmation.ts`, `src/app/api/events/[id]/arrangements/route.ts` |
| Edit event information - the assigned coordinator, after approval (SPM-62): live "These changes affect existing arrangements" warning, "Move this event back to Planning?" on a Confirmed event, and what the save flagged | `src/app/events/[id]/update/page.tsx`, `src/lib/eventChangeImpact.ts` |
| Resolve safety check outcome (SPM-88): the Safety check history card, the "Flag arrangements for review" button and dialog, the safety wording of "Move this event back to Planning?" on the edit page and the Equipment tab, and "The safety check was closed" on the Venue tab and booking request form | `src/app/events/[id]/page.tsx`, `src/app/events/[id]/SafetyFlagDialog.tsx`, `src/app/events/[id]/update/page.tsx`, `src/app/events/[id]/equipment/page.tsx`, `src/app/events/[id]/venue/page.tsx`, `src/app/events/[id]/booking/new/page.tsx`, `src/lib/safetyResolution.ts` |
| Record safety decision - the Safety Officer, on an event in Safety review (SPM-87): button and dialog (Approve / Request changes / Reject, with a required reason for the last two), the decision on the "Safety check" row, each venue's opening hours and unavailable periods on the Venue bookings card, a "Safety approved" list on the organiser's and coordinator's Dashboard | `src/app/events/[id]/page.tsx`, `src/app/events/[id]/SafetyDecisionDialog.tsx`, `src/lib/safetyDecision.ts` |
| Submit for safety check - the assigned coordinator, from Planning (SPM-86): button and "Submit for safety check?" dialog on the Overview, the refusal naming what is outstanding or flagged, a staff-only "Safety check" row under Status, and a "Safety review" list on the organiser's and coordinator's Dashboard | `src/app/events/[id]/page.tsx`, `src/lib/safetyCheck.ts`, `src/app/dashboard/page.tsx` |
| S-24 Equipment catalogue: operational status for staff, and Technical Support recording and returning units out of service (SPM-55) | `src/app/equipment/page.tsx`, `src/lib/equipmentOutOfService.ts` |
| S-25 Equipment request queue + detail: availability (SPM-48), Reserve (SPM-49), fulfilment status + technical notes (SPM-50) | `src/app/equipment/requests/`, `src/lib/equipmentAvailability.ts`, `src/lib/equipmentFulfilment.ts` |

Specified but not yet built, and why:

| Not built | Blocked on |
| --- | --- |
| S-06 event detail, S-12–S-15, S-17, S-19–S-24, S-28. | Their endpoints do not exist yet. (S-26 and S-27 were built in SPM-51.) |

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
