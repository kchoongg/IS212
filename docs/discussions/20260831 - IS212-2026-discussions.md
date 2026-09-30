# SinYang13/IS212-2026 — Discussions

87 discussions across 11 categories. Extracted 2026-08-31 13:18 UTC.

**2 unanswered** · 0 replied to · 84 answered · 26 labelled `important`

## Contents

- [Announcements](#announcements) (1)
- [Calendar](#calendar) (3)
- [Equipment & Technical Support](#equipment-technical-support) (15) — **1 unanswered**, 5 `important`
- [Events](#events) (19) — 6 `important`
- [General](#general) (5) — 1 `important`
- [Non-Functional Requirements](#non-functional-requirements) (7)
- [Notifications](#notifications) (4) — **1 unanswered**, 1 `important`
- [Registration & Attendees](#registration-attendees) (9) — 5 `important`
- [Reporting & Analytics](#reporting-analytics) (3)
- [Users](#users) (11) — 4 `important`
- [Venues](#venues) (10) — 4 `important`

---

## Announcements

_Read me first!_

### Posts (1)

#### [#1](https://github.com/SinYang13/IS212-2026/discussions/1) Read Me First!

**SinYang13** · 2026-08-18 · 1 upvote

> **Hello and welcome to the SPM project!**
>
> We will be using GitHub Discussions for our section (G9) to facilitate our customer clarification sessions. This will be the first year we are trying this platform, so do share any feedback and ideas that you have to improve the experience for all.
>
> On this platform, you may ask the "customer" any questions you have, and we will get back to you as best as we can. However, we are only humans and may not be descriptive or quick - part of what real-world customers are like! Over the course of this semester, we wish to cultivate this skill of asking **_clear, concise, and specific questions_** that help you in your future work.
>
> **We ask that you follow these guidelines:**
>
> 1. Before posting any question, please check if the question has already been asked or answered. Make good use of the search function or AI tools. **Any duplicates that we detect may be closed.**
> 2. Post your questions under the relevant category. If no category fits your question, post it under General. If there are a significant number of common categories under General, we will consider making a new category.
> 3. Start all your titles with your group number, e.g. "[T3] How do I use GitHub?"
> 4. **Upvote questions that your group would also like to ask.** We will go through the top upvoted questions during the in-person clarification sessions. Leftover questions will be answered ad-hoc.
>
> Have fun and all the best!

---

## Calendar

### Answered (3)

#### [#10](https://github.com/SinYang13/IS212-2026/discussions/10) [T1] Do attendees see a calendar of all open events they can register for, or only events they've already registered for?

**kangaroott** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> 1) They definitely can view events that they register for and also those open for registration. If the question is on UI/UX, please propose and do the appropriate

#### [#6](https://github.com/SinYang13/IS212-2026/discussions/6) [T1] Should calendar provide 30-minutes intra-day breakdown or a wider view (e.g., weekly) breakdown visualisation is enough?

**kangaroott** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> This is a UI/UX question, please propose and do the appropriate

#### [#3](https://github.com/SinYang13/IS212-2026/discussions/3) [T1] Is calendar view-only or can users drag and drop to reschedule events on calendar (resulting in change of status from Approved -> Under Review?)

**kangaroott** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> This is a UI/UX question, please propose and do the appropriate. However, any rescheduling must still follow the relevant event-change process and should not bypass required checks or approvals.

---

## Equipment & Technical Support

### Unanswered (1)

#### [#2](https://github.com/SinYang13/IS212-2026/discussions/2) [T1] Does equipment have physical location? If it needs to be moved to a different venue, does that affect turnaround(downtime due to transit)?

`follow-up question` **`important`** · **Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote · **re-opened by a follow-up**

> Does equipment have physical location? If it needs to be moved to a different venue, does that affect turnaround(downtime due to transit)?

**Previous answer** — SinYang13, 2026-08-25

> Yes, equipment has a physical location. If equipment needs to be moved between venues, the time required for transfer and preparation should be considered when determining its availability. How this is represented in the solution is for you to propose.

**Follow-ups since the answer:**

- **Isaidchia** (2026-08-28): Hi, it seems like this requirement contradicts with https://github.com/SinYang13/IS212-2026/discussions/5

where the equipment is returned to ConnectSphere for assessment and then collected from ConnectSphere on Return day + 1 onwards, do assist in clarifying which workflow stands
- **SinYang13** (2026-08-31): Both rules apply, but at different points in the equipment lifecycle.

Equipment has a physical location, and if it must be moved from its current location to the event venue, the required transfer and preparation time should be considered when determining whether it is available for that event.

After the event, the current operating assumption is that equipment is returned to ConnectSphere for inspection and preparation before it becomes available again. Under the clarified rule, equipment may be collected from D-1 and is only treated as available again from Return Day +1.

Therefore, transfer time affects pre-event availability, while the Return Day +1 rule governs post-event availability. They are not alternatives to each other.

How the system represents transfer time, preparation time and the equipment's current location is for the solution team to propose.

Current equipment location
→ transfer/preparation to event venue
→ D-1 collection / event commitment period
→ event use
→ return to ConnectSphere
→ inspection/preparation
→ available again from Return Day +1

### Answered (14)

#### [#90](https://github.com/SinYang13/IS212-2026/discussions/90) [T6] When a Technical Support Staff reviews equipment requirements, are they able to reserve the equipment for requirements that are met and only highlight those unavailable? must every requirement be met before proceeding with reservations

**`important`** · **Isaidchia** · 2026-08-28 · 1 upvote

> [T6] When a Technical Support Staff reviews equipment requirements, are they able to reserve the equipment for requirements that are met and only highlight those unavailable? or must every requirement be met before proceeding with reservations

**Answer** — SinYang13, 2026-08-31

> Equipment that is available and suitable may be reserved even if some other requested equipment is unavailable. Technical Support Staff should identify which requirements can be fulfilled and highlight unavailable items or suggest alternatives. The Event Coordinator then determines whether the outstanding requirement affects overall event readines

#### [#87](https://github.com/SinYang13/IS212-2026/discussions/87) [T6] Describe how the Technical Support Staff clarifies support requirements when there is insufficient information

**`important`** · **Isaidchia** · 2026-08-28 · 1 upvote

**Answer** — SinYang13, 2026-08-31

> Technical Support Staff can record questions, comments, or clarification needs against the event. Where clarification from the Event Organiser is required, the Event Coordinator remains the main liaison and coordinates the response. The relevant clarification and response should be retained with the event record.

#### [#19](https://github.com/SinYang13/IS212-2026/discussions/19) [T1] Is there a formal equipment request -> approval workflow (like venue booking) or does Event Coordinator just reserve directly against availability?

**`important`** · **Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> Is there a formal equipment request -> approval workflow (like venue booking) or does Event Coordinator just reserve directly against availability?

**Answer** — josephsungls, 2026-08-25

> The Event Coordinator records the equipment requirement. Technical Support Staff review whether the requested equipment is suitable and available, and available equipment can then be reserved for the event.

#### [#5](https://github.com/SinYang13/IS212-2026/discussions/5) [T1] Can same piece of equipment be shared between events on same day (eg. morning and afternoon event)

**`important`** · **Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> Can same piece of equipment be shared between events on same day (eg. morning and afternoon event)

**Answer** — josephsungls, 2026-08-25

> No. Based on our current operating process, equipment may be collected one day before the event (D-1). After it is returned, Technical Support Staff require time to check and prepare the equipment, so it will only be considered available again from Return Day + 1.

#### [#89](https://github.com/SinYang13/IS212-2026/discussions/89) [T6] Can a Technical Support Staff indicate their availability for event rostering?  If so, How often do they have to indicate their availability?

**Isaidchia** · 2026-08-28 · 1 upvote

**Answer** — SinYang13, 2026-08-31

> No separate staff self-declaration of availability is currently required. The system only needs to maintain sufficient availability information to support staff assignment. How availability is maintained can be proposed by students.

#### [#88](https://github.com/SinYang13/IS212-2026/discussions/88) [T6] How often is the roster to physically support an event updated for a Technical Support Staff? Who does the rostering? or is it system-assigned?

**Isaidchia** · 2026-08-28 · 1 upvote

**Answer** — SinYang13, 2026-08-31

> No fixed roster update frequency is required. There is no hard requirement of system assign or manual for assigning the support staff.

#### [#86](https://github.com/SinYang13/IS212-2026/discussions/86) [T6] Describe how the Technical Support Staff logs defects or damages of returned equipment

**Isaidchia** · 2026-08-28 · 1 upvote

**Answer** — SinYang13, 2026-08-31

> Technical Support Staff can record defects, damage, missing items, or other issues found when equipment is returned. The operational status of the affected equipment should be updated accordingly.

#### [#85](https://github.com/SinYang13/IS212-2026/discussions/85) [T6] Describe the checklist that the Technical Support Staff uses to assess equipment health after an event.

**Isaidchia** · 2026-08-28 · 1 upvote

**Answer** — SinYang13, 2026-08-31

> The checklist is kept outside of the system, we do not need to keep track in the system.

#### [#82](https://github.com/SinYang13/IS212-2026/discussions/82) [T6] Is there a maximum or minimum period (in days) that a piece of equipment can be reserved for?

**Isaidchia** · 2026-08-25 · 1 upvote

> Is there a maximum period that a piece of equipment can be reserved for?

**Answer** — SinYang13, 2026-08-31

> No maximum reservation period.

#### [#25](https://github.com/SinYang13/IS212-2026/discussions/25) [T1] What is the minimum notice period for equipment and technical support request?

**Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> What is the minimum notice period for equipment and technical support request?

**Answer** — SinYang13, 2026-08-25

> No minimum notice period has been specified. Please propose an appropriate approach if this is required in your solution.

#### [#23](https://github.com/SinYang13/IS212-2026/discussions/23) [T1] When equipment is under maintenance, is there an expected return date field? Should system flag and prebook when equipment becomes available again?

**Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> When equipment is under maintenance, is there an expected return date field? Should system flag and prebook when equipment becomes available again?

**Answer** — SinYang13, 2026-08-25

> Equipment can be recorded as unavailable, damaged or under maintenance. Expected return date and automatic pre-booking are not specified; please propose if appropriate. Currently, we have not listed equipment maintenance workflow as a potential functional requirement, would record as a consideration

#### [#16](https://github.com/SinYang13/IS212-2026/discussions/16) [T1] What happens to equipment reservations if event is rescheduled? Auto carry-over or must be re-requested?

**Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> What happens to equipment reservations if event is rescheduled? Auto carry-over or must be re-requested?

**Answer** — SinYang13, 2026-08-25

> A reschedule may affect equipment availability, so the equipment arrangement needs to be reviewed again. How you implement that workflow is for you to propose. As in the sequence, change of status or UX is for your recommendation

#### [#13](https://github.com/SinYang13/IS212-2026/discussions/13) [T1] How will equipment quantity be tracked? Individual items (serialization) or pooled inventory (arbitrary counter eg. 20 projectors available)

**Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> How will equipment quantity be tracked? Individual items (serialization) or pooled inventory (arbitrary counter eg. 20 projectors available)

**Answer** — SinYang13, 2026-08-25

> How you model equipment individually or as pooled quantities in the database or UX is for you to propose. However, the system needs to know the quantity of equipment available.

#### [#9](https://github.com/SinYang13/IS212-2026/discussions/9) [T1] Who decides if equipment is damaged or unavailable? Technical Support Staff only or can Coordinators flag it too?

**Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> Who decides if equipment is damaged or unavailable? Technical Support Staff only or can Coordinators flag it too?

**Answer** — SinYang13, 2026-08-25

> Technical Support Staff are responsible for maintaining equipment status

---

## Events

_Requests, Approvals, Changes, Discussions_

### Answered (19)

#### [#80](https://github.com/SinYang13/IS212-2026/discussions/80) [T3] What is the difference between an event being approved and being confirmed?

**`important`** · **Ryan-Lee-2000** · 2026-08-25 · 1 upvote

> The briefing indicates that an Event Coordinator first approves an event request so that planning can proceed, then later confirms the event once the essential arrangements are completed.
>
> Could you clarify:
>
> 1. What does approval commit ConnectSphere to?
> 2. Which arrangements are considered essential before confirmation?
> 3. Do the required arrangements depend on the particular event?
> 4. Can an event be confirmed while non-essential actions remain outstanding?
> 5. Should the system prevent confirmation when a required arrangement is incomplete?

**Answer** — SinYang13, 2026-08-31

> 1) Approval means the request contains sufficient information for planning to proceed. It does not commit ConnectSphere to a confirmed venue, equipment, technical support, registration setup, or final event delivery.
> 2) Essential arrangements are those required for that particular event to proceed. These may include venue, equipment, technical support, programme, registration setup, or other event-specific arrangements. There is no single fixed list that applies to every event.
> 3) Yes. The required arrangements depend on the event's actual needs. For example, some events may not require equipment, technical support, or attendee registration.
> 4) Yes, provided all arrangements considered essential for that event have been completed. Non-essential follow-up actions may remain outstanding if they do not prevent the event from being ready for confirmation.
> 5) Yes. If an arrangement has been identified as required/essential for that event and is still incomplete, the event should not be confirmable.

#### [#74](https://github.com/SinYang13/IS212-2026/discussions/74) [T1] For multi-session events, can sessions have different venues, equipment, and attendance limits?

**`important`** · **akashb2004-png** · 2026-08-23 · 1 upvote

> For multi-session events, can sessions have different venues, equipment, and attendance limits?

**Answer** — josephsungls, 2026-08-25

> Multi-session events may have different timings and operational requirements, including different venues, equipment requirements and attendance limits for each session.

#### [#73](https://github.com/SinYang13/IS212-2026/discussions/73) [T1] How is an Event Coordinator assigned? Auto-assignment (round-robin, capacity-based) or manual by a manager?

**`important`** · **akashb2004-png** · 2026-08-23 · 1 upvote

> How is an Event Coordinator assigned? Auto-assignment (round-robin, capacity-based) or manual by a manager?

**Answer** — josephsungls, 2026-08-25

> After an event request is submitted, an Event Operations Manager assigns an Event Coordinator to the event.

#### [#71](https://github.com/SinYang13/IS212-2026/discussions/71) [T1] What defines an event as completed? Is it automatic (after end time passes) or manual (coordinator marks it)

**`important`** · **akashb2004-png** · 2026-08-23 · 1 upvote

> What defines an event as completed? Is it automatic (after end time passes) or manual (coordinator marks it)

**Answer** — josephsungls, 2026-08-25

> After the event has taken place, the Event Coordinator can mark it as completed. If it remains open, the system may automatically mark it as completed 7 days after the event end date.

#### [#69](https://github.com/SinYang13/IS212-2026/discussions/69) [T1] Is there a postponed status separate from cancelled? What happens to arrangements when postponed vs cancelled?

**`important`** · **akashb2004-png** · 2026-08-23 · 1 upvote

> Is there a postponed status separate from cancelled? What happens to arrangements when postponed vs cancelled?

**Answer** — josephsungls, 2026-08-25

> For postponement with a new date/time, treat it as a rescheduling request and review affected arrangements. If no new date is known, release the current bookings but retain the event record until a new date is provided.

#### [#68](https://github.com/SinYang13/IS212-2026/discussions/68) [T1] Can an event be cancelled at any stage, or only after confirmation? Who has authority to cancel?

**`important`** · **akashb2004-png** · 2026-08-23 · 1 upvote

> Can an event be cancelled at any stage, or only after confirmation? Who has authority to cancel?

**Answer** — josephsungls, 2026-08-25

> For cancellation of an event, only the event coordinator in-charge can set it. It can be cancelled at any stage.

#### [#95](https://github.com/SinYang13/IS212-2026/discussions/95) [T6] When an Event Coordinator is assigned to an event, do they need to accept the assignment, or is it automatically assigned to them? Can they reject or decline an assignment?

**jerricknsc** · 2026-08-31 · 1 upvote

> When an Event Coordinator is assigned to an event, do they need to accept the assignment, or is it automatically assigned to them? Can they reject or decline an assignment?

**Answer** — SinYang13, 2026-08-31

> No acceptance step, if any issue it will be handled outside the system.

#### [#94](https://github.com/SinYang13/IS212-2026/discussions/94) [T6] Who has the authority to reassign the event? Can it be reassigned by the Event Coordinator or it has to go back to the Event Operations Manager?

**jerricknsc** · 2026-08-31 · 1 upvote

> With reference to page 5 of project brief:
>
> > Events can be assigned to an Event Coordinator responsible for managing the planning process. Reassignment may be required when staff responsibilities or availability change
>
> Who has the authority to reassign the event? Can it be reassigned by the Event Coordinator or it has to go back to the Event Operations Manager?

**Answer** — SinYang13, 2026-08-31

> Reassignment is performed by the Event Operations Manager. The request and approval process for reassignment is handled outside the system. The system may assume that any reassignment action entered by the Event Operations Manager has already been approved.

#### [#93](https://github.com/SinYang13/IS212-2026/discussions/93) [T6] Is there a criteria for choosing which Event Coordinator to assign to which event or it is totally up to the Event Operations Manager?

**jerricknsc** · 2026-08-31 · 1 upvote

> Is there a criteria for choosing which Event Coordinator to assign to which event or it is totally up to the Event Operations Manager?

**Answer** — SinYang13, 2026-08-31

> It is up to Event Operations Manager, they have their own SOP which is handled outside of the system

#### [#92](https://github.com/SinYang13/IS212-2026/discussions/92) [T6] Can Event Coordinators be assigned to 2 events concurrently?

**jerricknsc** · 2026-08-31 · 1 upvote

> Can Event Coordinators be assigned to 2 events concurrently?

**Answer** — SinYang13, 2026-08-31

> Yes

#### [#78](https://github.com/SinYang13/IS212-2026/discussions/78) [T1] Is there a minimum time period before the actual event where an Event Organiser or Coordinator must create the event request?

**akashb2004-png** · 2026-08-23 · 1 upvote

> Is there a minimum time period before the actual event where an Event Organiser or Coordinator must create the event request?

**Answer** — SinYang13, 2026-08-25

> No minimum lead time has been specified for now. Please propose an appropriate approach if your solution requires one.

#### [#75](https://github.com/SinYang13/IS212-2026/discussions/75) [T1] What does "reuse information from a previous event" mean in practice? Clone the whole event? Copy only certain fields?

**akashb2004-png** · 2026-08-23 · 1 upvote

> What does "reuse information from a previous event" mean in practice? Clone the whole event? Copy only certain fields?

**Answer** — SinYang13, 2026-08-25

> The requirement is simply to reduce repeated data entry while still allowing the new event to have different dates and requirements. Which information is copied and how it is presented is for you to propose.

#### [#72](https://github.com/SinYang13/IS212-2026/discussions/72) [T1] What are the minimum required fields for an event request to be submittable?

**akashb2004-png** · 2026-08-23 · 1 upvote

> What are the minimum required fields for an event request to be submittable?

**Answer** — SinYang13, 2026-08-25

> If you meant fields length, we have no requirements for that. If you meant which fields are mandatory, we have not firmed out the fields as yet, do propose what is appropriate

#### [#70](https://github.com/SinYang13/IS212-2026/discussions/70) [T1] After event is confirmed, can it still be moved back to Planning if a major change occurs?

**akashb2004-png** · 2026-08-23 · 1 upvote

> After event is confirmed, can it still be moved back to Planning if a major change occurs?

**Answer** — SinYang13, 2026-08-25

> A major change may require existing arrangements to be reviewed again. You can propose if you need a transition process flow

#### [#67](https://github.com/SinYang13/IS212-2026/discussions/67) [T1]Can a rejected event be resubmitted or is rejection final?

**akashb2004-png** · 2026-08-23 · 1 upvote

> Can a rejected event be resubmitted or is rejection final?

**Answer** — SinYang13, 2026-08-25

> Please propose an appropriate approach if needed.

#### [#24](https://github.com/SinYang13/IS212-2026/discussions/24) [T1] Do Event Organisers need to accept any terms/contract before submitting a request?

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> We do not need to keep track of it using this system, as the contracts and payments will be handled physically and outside of the systems for now.

#### [#21](https://github.com/SinYang13/IS212-2026/discussions/21) [T1] Can documents be versioned (upload new version of same document) or only added/deleted?

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> As they are not legal documents, we do not need to keep any versions.

#### [#15](https://github.com/SinYang13/IS212-2026/discussions/15) [T1] Are comments threaded (reply to specific comment) or flat (chronological list)?

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> The requirement is to retain comments, questions and updates with the event record. Whether comments are threaded or chronological is a UI/UX design decision.

#### [#8](https://github.com/SinYang13/IS212-2026/discussions/8) [T1] Is there a cut-off point before event date after which changes are no longer allowed?

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> No change cut-off period is required but some changes may occur even after confirmation may require affected arrangements to be reviewed again.

---

## General

_Questions that don't fit in the existing categories (or suggestions)_

### Answered (5)

#### [#79](https://github.com/SinYang13/IS212-2026/discussions/79) [T3] What existing software does ConnectSphere use, and how should the proposed system interact with it?

**`important`** · **Ryan-Lee-2000** · 2026-08-25 · 1 upvote

> The briefing mentioned that ConnectSphere currently uses email, spreadsheets, shared calendars, messaging applications, online forms and shared documents. Could you clarify:
>
> 1. What applications or services does ConnectSphere currently used for each of these activities?
> 2. Does ConnectSphere want the new system to replace any of them, or will their staff continue using them alongside the new system?
> 3. If they will continue to be used, is integration expected like for example sending email notifications, synchronising event dates with shared calendars, or linking to externally stored documents?
> 4. Which system should be treated as the authoritative source of event information when information differs between the booking system and an external service?
> 5. Is integration with any existing service required for the first release, or should this only be considered as a possible future extension?

**Answer** — SinYang13, 2026-08-31

> 1) The specific external applications or services currently used are not specified. Integration with external tools is not in scope currently.
> 2) The new system should be treated as the primary system for the event-planning and venue-booking functions included in the project scope. Other tools may still be used for activities outside this scope.
> 3) No integration with existing external applications or services is required for the current scope. However, the notification requirements may include sending email notifications. This should be treated as a notification-channel requirement rather than a general integration requirement.
> 4) For event information managed by the proposed system, the Event Planning and Venue Booking System should be treated as the authoritative source.
> 5) Please refer to the final Release 1 scope to be confirmed on Friday.

#### [#27](https://github.com/SinYang13/IS212-2026/discussions/27) [T1] Beyond venue search, do users need sorting/saved searches when browsing the general event list?

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> This is a UI/UX question, please propose and do the appropriate

#### [#12](https://github.com/SinYang13/IS212-2026/discussions/12) [T1] Does ConnectSphere have an existing database of venues/equipment/clients that needs to be imported, or do we start fresh?

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> No data migration, import and system integration requirement for now

#### [#11](https://github.com/SinYang13/IS212-2026/discussions/11) [T1] Is the 14-step process the expected happy path, and should all 14 steps be implemented, or is a subset acceptable?

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> The 14-step process describes a typical end-to-end event planning flow, and there may be other branching or exception flows that have not yet been identified. We will be having further internal discussions with other stakeholders after this round of clarifications to determine the features and flows to be prioritised for Release 1.

#### [#4](https://github.com/SinYang13/IS212-2026/discussions/4) [T1] What changes are significant enough to trigger impact analysis vs ordinary edits that don't

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> Changes that may affect existing arrangements should be treated as significant. Examples include changes to date/time, attendance, venue requirements, equipment requirements, or other changes that could invalidate confirmed arrangements. Ordinary edits that do not affect existing arrangements need not trigger revalidation. The exact implementation is for you to propose.

---

## Non-Functional Requirements

### Answered (7)

#### [#36](https://github.com/SinYang13/IS212-2026/discussions/36) [T1] Should event times be shown in the organiser's local time zone if they're based outside Singapore? Are we following server time or user time when planning/ booking an event?

**akashb2004-png** · 2026-08-23 · 1 upvote

> Should event times be shown in the organiser's local time zone if they're based outside Singapore? Are we following server time or user time when planning/ booking an event?

**Answer** — SinYang13, 2026-08-25

> As all the venues that we own are in Singapore. We will be using Singapore time Zone

#### [#31](https://github.com/SinYang13/IS212-2026/discussions/31) [T1] Do internal staff need offline access while physically at a venue with poor connectivity?

**akashb2004-png** · 2026-08-23 · 1 upvote

> Do internal staff need offline access while physically at a venue with poor connectivity?

**Answer** — SinYang13, 2026-08-25

> Offline access is not specified as a requirement for now

#### [#28](https://github.com/SinYang13/IS212-2026/discussions/28) [T1] Should the system support multiple languages or English only?

**akashb2004-png** · 2026-08-23 · 1 upvote

> Should the system support multiple languages or English only?

**Answer** — SinYang13, 2026-08-25

> Multiple-language support is not currently specified as a requirement. You may assume English for now.

#### [#20](https://github.com/SinYang13/IS212-2026/discussions/20) [T1]Is there a data retention policy? How long should completed/cancelled events and their logs be kept?

**akashb2004-png** · 2026-08-23 · 1 upvote

> Is there a data retention policy? How long should completed/cancelled events and their logs be kept?

**Answer** — SinYang13, 2026-08-25

> No retention policy for this system as yet. Completed and cancelled events may remain available as historical records; archival and housekeeping are outside the current functional scope.

#### [#18](https://github.com/SinYang13/IS212-2026/discussions/18) [T1] Is there a document size/type limit? What file types are accepted?

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> No document size or file-type limits have been specified. Please propose an appropriate approach if your solution requires such constraints.

#### [#14](https://github.com/SinYang13/IS212-2026/discussions/14) [T1]Should the audit log be tamper-proof (append-only, no edits/deletes), or is a regular database table sufficient?

**akashb2004-png** · 2026-08-23 · 1 upvote

> Should the audit log be tamper-proof (append-only, no edits/deletes), or is a regular database table sufficient?

**Answer** — SinYang13, 2026-08-25

> The requirement is that important actions and changes are recorded so that ConnectSphere can determine what changed, who changed it, and when. The technical mechanism used to achieve this is for you to propose.

#### [#7](https://github.com/SinYang13/IS212-2026/discussions/7) [T1] How many concurrent users should the system support? (500 internal + how many external?) Do we need microservices?

**akashb2004-png** · 2026-08-23 · 1 upvote

> How many concurrent users should the system support? (500 internal + how many external?) Do we need microservices?

**Answer** — SinYang13, 2026-08-25

> The system should support ConnectSphere's expected growth over the next three years. The architecture, including whether microservices are appropriate, is for you to propose. Do also consider the nature of business and staff strength.

---

## Notifications

### Unanswered (1)

#### [#55](https://github.com/SinYang13/IS212-2026/discussions/55) [T1] Are notifications real-time (push) or batch (daily digest)?

`follow-up question` **`important`** · **LucasTan0205** · 2026-08-23 · 1 upvote · **re-opened by a follow-up**

> Are notifications real-time (push) or batch (daily digest)?

**Previous answer** — SinYang13, 2026-08-25

> We will put it as a batch but the frequency should be configurable

**Follow-ups since the answer:**

- **JameszLau** (2026-08-25): Sorry but what exactly does batch refer to? Would that mean a queue system for the notifications before sending them all out at a specific interval?
- **SinYang13** (2026-08-31): By batch, we mean notifications do not need to be delivered immediately in real time. They may be grouped and sent at configurable intervals, and the exact frequency should be configurable. However, if real-time delivery is technically simpler, that is also acceptable. The underlying requirement is that there is no hard requirement for notifications to be received within a specific time limit.

### Answered (3)

#### [#47](https://github.com/SinYang13/IS212-2026/discussions/47) [T1] Is there an "incomplete arrangements" or "pending approval" reminder that nags the coordinator? How often?

**LucasTan0205** · 2026-08-23 · 1 upvote

> Is there an "incomplete arrangements" or "pending approval" reminder that nags the coordinator? How often?

**Answer** — SinYang13, 2026-08-25

> Yes, reminders for incomplete arrangements. The frequency would be by batch and should also be configurable

#### [#40](https://github.com/SinYang13/IS212-2026/discussions/40) [T1] How far in advance and often should reminders fire? (e.g., 1 week before event, 1 day before?) Should it be configurable?

**LucasTan0205** · 2026-08-23 · 1 upvote

> How far in advance and often should reminders fire? (e.g., 1 week before event, 1 day before?) Should it be configurable?

**Answer** — SinYang13, 2026-08-25

> The timing and configurability are for you to propose.

#### [#37](https://github.com/SinYang13/IS212-2026/discussions/37) [T1] What are the notification channels – in-app only, email only, or both? Is it configurable per user or mass-configured?

**LucasTan0205** · 2026-08-23 · 1 upvote

> What are the notification channels – in-app only, email only, or both? Is it configurable per user or mass-configured?

**Answer** — SinYang13, 2026-08-25

> We should allow both channels but it should also be configurable for the type of notifications.

---

## Registration & Attendees

### Answered (9)

#### [#44](https://github.com/SinYang13/IS212-2026/discussions/44) [T1] Do waitlisted attendees get a time limit to accept when a spot opens, before it goes to the next person? Is this configurable?

**`important`** · **kangaroott** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> A waiting list is supported, and the acceptance window will be 3 days

#### [#42](https://github.com/SinYang13/IS212-2026/discussions/42) [T1] Can registration be re-opened after closing (e.g., if additional capacity becomes available)?

**`important`** · **kangaroott** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> We will allow the extension of the registration period

#### [#38](https://github.com/SinYang13/IS212-2026/discussions/38) [T1] How is attendance recorded? (QR code check-in? Manual roll call? Self-reporting? Coordinator marks it?)

**`important`** · **kangaroott** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> Attendance is manually checked in at the counter either using QR code or manual by the staff

#### [#33](https://github.com/SinYang13/IS212-2026/discussions/33) [T1] Can an Event Organiser manually add attendees (e.g., VIPs who don't self-register)?

**`important`** · **kangaroott** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> For attendees who are not self-registering through the system, the attendee list will have to be provided to the Event Coordinator for processing.

#### [#26](https://github.com/SinYang13/IS212-2026/discussions/26) [T1] Is the waiting list automatic (FIFO auto-promotion when spot opens) or manual (coordinator/organiser selects)?

**`important`** · **kangaroott** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> We will allow FIFO and manual override.

#### [#53](https://github.com/SinYang13/IS212-2026/discussions/53) [T1] Do attendees need an account to register attendance?

**kangaroott** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> The system supports Attendees as external users who can register for events and view their registration status. External user onboarding features are not listed in the brief yet

#### [#48](https://github.com/SinYang13/IS212-2026/discussions/48) [T1] Can an attendee register for multiple events simultaneously? Any limits?

**kangaroott** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> No limit has been specified on the number of events an Attendee may register for. Please propose an appropriate approach if your solution requires restrictions.

#### [#30](https://github.com/SinYang13/IS212-2026/discussions/30) [T1] Is there a registration deadline separate from the event date? (e.g., registration closes 3 days before event) Who sets it?

**kangaroott** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> Yes, there should be a registration start and end date that is separate from the event date. The event coordinator would be in-charge for this

#### [#22](https://github.com/SinYang13/IS212-2026/discussions/22) [T1] What information must an attendee provide when registering? (Name only? Dietary needs? Accessibility requirements?)

**kangaroott** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> Please propose an appropriate set of information based on the event needs.

---

## Reporting & Analytics

### Answered (3)

#### [#34](https://github.com/SinYang13/IS212-2026/discussions/34) [T1] Are reports generated on-demand or scheduled (e.g., weekly automatic report)?

**Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> Are reports generated on-demand or scheduled (e.g., weekly automatic report)?

**Answer** — SinYang13, 2026-08-25

> The current requirement is for users to generate reports when required.

#### [#32](https://github.com/SinYang13/IS212-2026/discussions/32) [T1] Can Event Organisers export attendee data (emails, names) for their own events? Any privacy/PDPA restrictions?

**Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> Can Event Organisers export attendee data (emails, names) for their own events? Any privacy/PDPA restrictions?

**Answer** — SinYang13, 2026-08-25

> Event Organisers can view or export attendee information for events they organise, where appropriate and subject to access restrictions.

#### [#29](https://github.com/SinYang13/IS212-2026/discussions/29) [T1] What does a "Venue Usage Report" contain? (Occupancy rates? Booking frequency? Revenue? Utilisation by day/time?)

**Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> What does a "Venue Usage Report" contain? (Occupancy rates? Booking frequency? Revenue? Utilisation by day/time?)

**Answer** — SinYang13, 2026-08-25

> The requirement is to allow internal users to review venue bookings and usage over a selected period for operational planning. The exact measures and presentation are not specified yet; please propose appropriate information that supports venue usage and operational planning. Revenue is not currently stated as part of this report.

---

## Users

_Roles, Permissions, Authentication_

### Answered (11)

#### [#81](https://github.com/SinYang13/IS212-2026/discussions/81) [T3] What events can Event Organisers from the same client organisation access?

**`important`** · **Ryan-Lee-2000** · 2026-08-25 · 1 upvote

> The briefing says that multiple Event Organisers can belong to one client organisation and that Organisers should not normally access events belonging to unrelated clients.
>
> Should an Event Organiser:
>
> 1. See only events that they personally created or were assigned to?
> 2. See every event belonging to their organisation?
> 3. Be granted access to additional events by another Organiser?
> 4. Be allowed to edit those events or only view them?
>
> Does a primary contact or client-organisation administrator control this access?

**Answer** — SinYang13, 2026-08-31

> n Event Organiser can view, edit and update events for which they are responsible. Other Event Organisers belonging to the same client organisation may view those events but cannot edit or update them. Event Organisers must not access events belonging to unrelated client organisations.

#### [#61](https://github.com/SinYang13/IS212-2026/discussions/61) [T1] Can Event Organisers delegate their role for a specific event to a colleague in the same organisation?

**`important`** · **Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> Can Event Organisers delegate their role for a specific event to a colleague in the same organisation?

**Answer** — SinYang13, 2026-08-25

> We do not support delegration for event organisers currently but can cater to change of event organiser

#### [#56](https://github.com/SinYang13/IS212-2026/discussions/56) [T1] Can a person hold multiple roles? (e.g., a Venue Staff member who is also an Attendee at another event)

**`important`** · **Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> Can a person hold multiple roles? (e.g., a Venue Staff member who is also an Attendee at another event)

**Answer** — SinYang13, 2026-08-25

> Yes

#### [#52](https://github.com/SinYang13/IS212-2026/discussions/52) [T1] Is there an admin role (above the 5 stakeholders listed) for system configuration, user management, etc.?

**`important`** · **Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> Is there an admin role (above the 5 stakeholders listed) for system configuration, user management, etc.?

**Answer** — SinYang13, 2026-08-25

> Currently, we do not have a system-configuration feature specified. User administration is also not defined as a separate business role. If your solution requires user-administration permissions, you may propose an appropriate approach together with the existing access-control requirements.

#### [#91](https://github.com/SinYang13/IS212-2026/discussions/91) [T6] Describe what is protected information and who will have access to it

**Isaidchia** · 2026-08-28 · 1 upvote

**Answer** — SinYang13, 2026-08-31

> Protected information refers to information that should only be accessible to authorised users based on their role and relationship to the event. This may include internal planning information, venue and equipment arrangements, attendee information, client-related information, and other non-public event details. Access should follow the user’s role and responsibility for the event. The exact access-control design and field-level permissions may be proposed by the solution team.

#### [#66](https://github.com/SinYang13/IS212-2026/discussions/66) [T1] Are staffs scoped to specific venues/ equipment types/ location or is access organisation-wide?

**Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> Are staffs scoped to specific venues/ equipment types/ location or is access organisation-wide?

**Answer** — SinYang13, 2026-08-25

> Access should depend on the user's role and responsibilities. Venue Staff and Technical Support Staff should have access to the information needed for their responsibilities, but not restricted by venue, equipment type and location.

#### [#65](https://github.com/SinYang13/IS212-2026/discussions/65) [T1] Is there a designated primary contact per client organisation, or are all Event Organisers under it treated equally?

**Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> Is there a designated primary contact per client organisation, or are all Event Organisers under it treated equally?

**Answer** — SinYang13, 2026-08-25

> Multiple Event Organisers may belong to the same client organisation, but no primary-contact role has been specified. Please propose an appropriate approach if this is needed.

#### [#64](https://github.com/SinYang13/IS212-2026/discussions/64) [T1] How do external users recover a forgotten password or locked account?

**Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> How do external users recover a forgotten password or locked account?

**Answer** — SinYang13, 2026-08-25

> Account recovery and locked-account handling are not specified in the current requirements.

#### [#62](https://github.com/SinYang13/IS212-2026/discussions/62) [T1] What authentication method is expected - email/password, SSO, MFA?

**Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> What authentication method is expected - email/password, SSO, MFA?

**Answer** — SinYang13, 2026-08-25

> Secure authentication is required, but the authentication method is not specified. Please propose an appropriate approach.

#### [#59](https://github.com/SinYang13/IS212-2026/discussions/59) [T1] What happens to an Event Organiser's events if their account is deactivated? Orphaned? Transferred to another organiser?

**Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> What happens to an Event Organiser's events if their account is deactivated? Orphaned? Transferred to another organiser?

**Answer** — SinYang13, 2026-08-25

> We can use the change of event organiser

#### [#49](https://github.com/SinYang13/IS212-2026/discussions/49) [T1] How do external users (Event Organizers, Attendees) get accounts? Self-registration? Invitation by ConnectSphere?

**Joe-Zhou-Yubin** · 2026-08-23 · 1 upvote

> How do external users (Event Organizers, Attendees) get accounts? Self-registration? Invitation by ConnectSphere?

**Answer** — SinYang13, 2026-08-25

> The onboarding process feature is currently not in the list of features as yet.

---

## Venues

_Booking & Availability_

### Answered (10)

#### [#83](https://github.com/SinYang13/IS212-2026/discussions/83) [T6] Is venue suitability checked during the Event Coordinator's venue search (filtering), or is a separate check needed when a full request is submitted for booking, should this check re trigger if event requirements change afterwards

**`important`** · **WilliamsSmithM** · 2026-08-27 · 1 upvote

> The brief has venue search/filtering and venue booking/approval as separate functions, but no explicit suitability check between them. We want to confirm if filtering alone counts as a suitability check, or if a dedicated check is needed. 
>
> If it is a dedicated check when it should trigger? 
> Venue search?
> Event Coordinators submission?
> New Event requirements updated?
> All?

**Answer** — SinYang13, 2026-08-31

> Filtering is used to narrow the list of venues based on criteria such as date, time, capacity, accessibility, layout, and facilities.
>
> Suitability checking evaluates whether a selected or shortlisted venue can satisfy the current event requirements.
>
> In other words, search and filtering are mainly used to find or list potential venues, while suitability checking is used to assess a venue after it has been identified or selected. The result may be presented as an indication in the venue list or checked after selection. The exact presentation and implementation are for the solution team to propose.

#### [#50](https://github.com/SinYang13/IS212-2026/discussions/50) [T1] Can a venue be partially blocked? (e.g., available mornings only during a renovation period)

**`important`** · **LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> The venue will be booked based on 3 time slots (AM, PM, Night) if full day will be all 3 slots. AM (7am-12pm, 1pm-6pm, 7pm-12am) he exact UX and implementation are for you to propose.

#### [#46](https://github.com/SinYang13/IS212-2026/discussions/46) [T1] Who manages venue operating hours? Can they vary by day of week? Are weekend/holiday events allowed, do we need to follow a holiday calendar?

**`important`** · **LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> Venue Staff maintain venue information, including operating hours. We assume all days are equal for now.

#### [#41](https://github.com/SinYang13/IS212-2026/discussions/41) [T1] Can multiple events have tentative holds on the same venue/time slot simultaneously?

**`important`** · **LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> Only one active tentative hold or confirmed booking should exist for the same venue and overlapping time period. A tentative hold may later be confirmed or released. The expiry period and release mechanism are for you to propose.

#### [#57](https://github.com/SinYang13/IS212-2026/discussions/57) [T1] How much in advance can event organizers book venues for events? (Booking Horizon)

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> No booking horizon has been specified. Please propose an appropriate approach if your solution requires one.

#### [#54](https://github.com/SinYang13/IS212-2026/discussions/54) [T1] When a venue becomes unavailable after a booking is confirmed (e.g., venue shutdown ceiling collapsed), does the system automatically notify the coordinator, or must Venue Staff manually reach out?

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> Venue Staff are responsible for updating venue availability when operational circumstances change, and an availability change affecting an upcoming event is a notification scenario. Event coordinator will need to make changes accordingly. please propose an appropriate automation mechanisms if required.

#### [#45](https://github.com/SinYang13/IS212-2026/discussions/45) [T1] When Venue Staff reject a booking and suggest an alternative, is this a formal counter-offer in the system, or just a comment/note?

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> Venue Staff may reject a booking request and suggest an alternative venue or arrangement. The changes will then be made by the coordinator

#### [#43](https://github.com/SinYang13/IS212-2026/discussions/43) [T1] How is turnaround time defined? Per-venue configurable, or a global rule? Is it fixed (e.g., always 1 hour) or variable by event type/size?

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> Turnaround requirements are associated with venue operations, and Venue Staff can record setup, teardown and turnaround requirements that is set for per venue

#### [#39](https://github.com/SinYang13/IS212-2026/discussions/39) [T1] How long can a tentative hold last? Is there a time limit before it auto-releases? Is this configurable?

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> No duration or auto-release rule has been specified for tentative holds. Please propose an appropriate approach if this is required.

#### [#35](https://github.com/SinYang13/IS212-2026/discussions/35) [T1] Is double-booking prevention a hard system block (impossible to book) or a warning (allow with override by Venue Staff for VIP organizations)?

**LeonNg29** · 2026-08-23 · 1 upvote

**Answer** — SinYang13, 2026-08-25

> The system should identify and block  incompatible or overlapping bookings and help prevent double-booking.

---
