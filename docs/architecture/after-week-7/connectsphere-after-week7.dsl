workspace "ConnectSphere" "Event planning and venue booking system for ConnectSphere Event Services - after the Week 7 customer changes" {

    !identifiers hierarchical

    model {
        organiser = person "Event Organiser" "External client representative. Submits requests, answers clarifications, asks for changes." {
            tags "External Person"
        }
        lead = person "Event Coordinator Lead" "Internal. The same role as the Event Operations Manager, renamed (Week 7 #5, forum #129). Assigns and reassigns coordinators; sees all active events." {
            tags "Week 7"
        }
        coordinator = person "Event Coordinator" "Internal. Reviews requests, books one or more venues, reviews flags, decides change requests, submits for safety check, confirms events." {
            tags "Week 7"
        }
        venueStaff = person "Venue Staff" "Internal. Maintains venues, setup/turnaround times and unavailable periods; decides bookings." {
            tags "Week 7"
        }
        techSupport = person "Technical Support Staff" "Internal. Maintains the equipment stock, reserves equipment for events and suggests alternative items."
        safetyOfficer = person "Safety Officer" "Internal. New in Week 7 (#6). Approves, rejects or requests changes in the Operational Safety Check." {
            tags "Week 7"
        }
        attendee = person "Attendee" "External participant. Registers for confirmed events, withdraws, joins waiting lists." {
            tags "External Person"
        }

        connectsphere = softwareSystem "ConnectSphere" "Lets ConnectSphere staff and their clients plan events end to end: event requests and review, coordinator assignment, multi-venue booking with setup and turnaround time, tentative holds, equipment, the operational safety check, change requests, attendee registration and in-app notifications." {

            webui = container "Web UI" "The screens each role uses: React pages that run in the user's browser (only the public home page is rendered on the server). After login, every screen calls the API with the user's session token." "React 19, Next.js App Router pages, Tailwind CSS" {
                shell = component "App Shell & Navigation" "Top bar with the unread-notifications badge, and role-based sidebar for all seven roles (incl. Event Coordinator Lead and Safety Officer). Code: src/components/AppShell.tsx, src/lib/roles.ts" "React component" {
                    tags "Week 7"
                }
                gate = component "Access Gate" "Hides screens a role may not use. Usability only - the API re-checks every request. Code: src/components/RequirePermission.tsx" "React component"
                pages = component "Pages" "One screen per route: login/register, dashboard, events (new, edit draft, hub, review, update, venue, booking request, equipment, readiness, attendees, change request), review queue, assignments, change requests, flagged arrangements, safety checks, venues (catalogue, add/edit, find a venue, availability, unavailability), venue booking requests, equipment catalogue (with unavailability), equipment requests, browse events, my registrations, notifications. The event hub shows tabs per role and panels such as the safety decision and registration. Code: src/app/**/page.tsx, src/app/events/[id]/*.tsx, src/lib/eventTabs.ts, breadcrumbs.ts" "React, Next.js App Router pages" {
                    tags "Week 7"
                }
                featureComponents = component "Shared Feature Components" "Pieces used on more than one screen: assign coordinator, begin planning, change request list, session fields, venue form, unavailable periods, withdraw registration. Code: src/components/*.tsx" "React components" {
                    tags "Week 7"
                }
                session = component "Session & Current User" "Stores the login token and adds it to every API call (authedFetch); loads who is signed in. Code: src/lib/session.ts, useCurrentUser.ts" "TypeScript (runs in the browser)"
                format = component "Formatting & Statuses" "Singapore-time dates, EVT-000123 references, status labels and colours (incl. Safety review, Safety approved, Postponed, Completed). Code: src/lib/format.ts, statuses.ts" "TypeScript module" {
                    tags "Week 7"
                }
                forms = component "Form Logic" "Client-side validation and payload building for the event, venue and search forms; maps server errors back onto fields. Code: src/lib/eventForm.ts, eventInformationForm.ts, venueForm.ts, venueSearchForm.ts, formErrors.ts" "TypeScript modules"
                uikit = component "UI Kit" "Shared building blocks: Button, Table, Alert, Card, Tabs, DataState, StatusBadge, ConfirmDialog, Field, PageHeader. Code: src/components/ui" "React components, Tailwind CSS"
            }

            api = container "API Server" "Next.js server. Delivers the pages and exposes the JSON REST API. Every route except sign-up identifies the caller and checks role AND relationship to the event; routes that take input validate it; then it reads/writes the database. Time-based rules (hold expiry, auto-complete, waiting-list offers) run as sweeps at the start of the requests that read that data - there is no scheduled job." "Next.js 16 Route Handlers on Node.js, TypeScript" {

                authApi = component "Auth API" "Register (external roles only), log in (bcrypt check, 8-hour JWT), who-am-I. Code: /api/auth/*" "Next.js Route Handlers" {
                    tags "Route"
                }
                eventsApi = component "Events API" "Create, edit and submit requests; review, clarify, begin planning, confirm, postpone, cancel, complete; update event information. Code: /api/events, /api/events/[id], /api/events/[id]/(information, clarifications, begin-planning, postponement, cancellation)" "Next.js Route Handlers" {
                    tags "Route"
                }
                assignApi = component "Assignment API" "Unassigned queue, assign and reassign a coordinator, all assignments and active events. Code: /api/queue, /api/assignments, /api/events/[id]/coordinator" "Next.js Route Handlers" {
                    tags "Route" "Week 7"
                }
                changeApi = component "Change Request API" "Organiser asks for a change; coordinator approves or rejects it, field by field. Code: /api/change-requests, /api/events/[id]/change-requests/*" "Next.js Route Handlers" {
                    tags "Route"
                }
                venuesApi = component "Venues API" "Venue catalogue with setup and turnaround times; search; suitability for an event; availability calendar; unavailable periods. Code: /api/venues, /api/venues/[id], /api/venues/search, /api/events/[id]/venue-suitability, /api/venues/[id]/(availability, unavailability/*)" "Next.js Route Handlers" {
                    tags "Route" "Week 7"
                }
                bookingApi = component "Venue Booking API" "One or more venue bookings per event; Venue Staff decide requests and set hold expiry; withdraw or release one booking. Code: /api/events/[id]/venue-bookings/*, /api/venue-bookings/* (incl. /[id]/expiry)" "Next.js Route Handlers" {
                    tags "Route" "Week 7"
                }
                equipmentApi = component "Equipment API" "Catalogue and out-of-service units; equipment requests; availability, reserve and fulfilment; Technical Support suggests an alternative, the coordinator accepts or declines it. Code: /api/equipment/*, /api/events/[id]/equipment/*" "Next.js Route Handlers" {
                    tags "Route"
                }
                arrangementsApi = component "Arrangements API" "Outstanding arrangements for an event; flagged venue bookings, equipment and registration lists to keep or replace. Code: /api/events/[id]/arrangements, /api/flagged-arrangements" "Next.js Route Handlers" {
                    tags "Route" "Week 7"
                }
                safetyApi = component "Safety Check API" "Submit an event for the Operational Safety Check; the Safety Officer's queue; approve, reject or request changes; safety flags. Code: /api/safety-checks, /api/events/[id]/(safety-check, safety-decision, safety-flags)" "Next.js Route Handlers" {
                    tags "Route" "Week 7"
                }
                registrationsApi = component "Registrations API" "Registration settings, register, withdraw, attendee list, manual add, waiting list and place offers. Code: /api/registrations/*, /api/events/[id]/(registration, registrations, waiting-list/*)" "Next.js Route Handlers" {
                    tags "Route"
                }
                facilitiesApi = component "Facilities API" "Reference list of facilities and accessibility features. Code: /api/facilities" "Next.js Route Handlers" {
                    tags "Route"
                }
                notificationsApi = component "Notifications API" "List, read, read-all and unread count. The App Shell asks for the count on every page, so it first runs the time-based sweeps (holds, auto-complete, waiting-list offers). Code: /api/notifications/*" "Next.js Route Handlers" {
                    tags "Route"
                }

                requestAuth = component "Request Auth" "Turns a request into an Actor (verifies the token, re-reads the user so deactivation takes effect at once) and answers 401 / 403 / 404. Code: src/lib/apiAuth.ts" "TypeScript module" {
                    tags "Shared"
                }
                permissions = component "Permission Model" "Pure rules: what each of the seven roles may do, and whether a user is related to an event (owner, same organisation, assigned coordinator). Unit tested. Code: src/lib/permissions.ts, eventVisibility.ts" "TypeScript module (pure functions)" {
                    tags "Shared" "Week 7"
                }
                validation = component "Validation Schemas" "Zod schemas for request bodies, one file per domain; a few newer rules keep theirs alongside (e.g. safetyDecision.ts). Code: src/lib/validation/" "Zod" {
                    tags "Shared"
                }
                notifications = component "Notifications" "Writes in-app notifications inside the same transaction as the change that caused them (assignments, flags, safety outcomes, change requests, offers), and how each one is shown (notificationView.ts, also used by the screens). Code: src/lib/notifications.ts, notificationView.ts" "TypeScript module" {
                    tags "Shared"
                }
                tokens = component "Password & Token Helpers" "bcrypt password hashing; JWT sign and verify. Code: src/lib/auth.ts" "bcryptjs, jsonwebtoken" {
                    tags "Shared"
                }
                prisma = component "Prisma Client" "Single shared, type-safe database client. Code: src/lib/prisma.ts" "Prisma 6 client" {
                    tags "Shared"
                }

                lifecycle = component "Event Lifecycle Rules" "Review and clarification requests, begin planning, confirm (waits for safety approval), postpone, cancel (releases every venue booking and equipment), complete (by hand or 7 days after the end). Code: src/lib/eventReview.ts, clarification.ts, beginPlanning.ts, eventConfirmation.ts, eventPostponement.ts, eventCancellation.ts, eventCompletion*.ts" "TypeScript modules" {
                    tags "Rules"
                }
                sessionsRules = component "Event Session Rules" "A multi-session event's start, end and headcount; writes sessions and their equipment together. Code: src/lib/eventSessions.ts, sessionWrites.ts" "TypeScript modules" {
                    tags "Rules"
                }
                changeRules = component "Change Request Rules" "What a change asks for and how an approved change is applied. Code: src/lib/eventChangeRequest.ts, changeRequestDecision.ts, eventChangeImpact.ts, applyEventInformation.ts" "TypeScript modules" {
                    tags "Rules"
                }
                assignRules = component "Coordinator Assignments" "Who is assigned to what, and the Lead's view of all active events. Code: src/lib/coordinatorAssignments.ts" "TypeScript modules" {
                    tags "Rules" "Week 7"
                }
                venueTime = component "Venue Time & Conflict Rules" "Times on a 15-minute grid; a booking occupies the venue from start minus setup to end plus turnaround; overlapping occupied periods conflict. Code: src/lib/venueTime.ts, venueConflict.ts, venueAvailability.ts" "TypeScript modules" {
                    tags "Rules" "Week 7"
                }
                venueChange = component "Venue Change Impact Rules" "Which bookings an edit, retirement, unavailable period or new setup/turnaround time puts at risk - they are flagged, never changed or cancelled. Code: src/lib/venueImpact.ts, venueUnavailability*.ts, turnaroundRecheck.ts" "TypeScript modules" {
                    tags "Rules" "Week 7"
                }
                suitability = component "Venue Suitability Rules" "Each venue booking is checked against its own space's requirements: capacity for the layout, facilities, accessibility. Code: src/lib/venueSuitability.ts, venueSearch.ts" "TypeScript modules" {
                    tags "Rules" "Week 7"
                }
                holds = component "Hold Expiry Rules" "Tentative holds expire at their deadline and free the venue; the coordinator is warned first. Swept on request. Code: src/lib/holdExpiry.ts, holdExpiryService.ts" "TypeScript modules" {
                    tags "Rules" "Week 7"
                }
                arrangementRules = component "Arrangement Tracking Rules" "What is still outstanding for an event (each venue booking, equipment, safety check) and what has been flagged for review. Code: src/lib/eventArrangements.ts, flaggedArrangements*.ts, reviewFlags.ts" "TypeScript modules" {
                    tags "Rules" "Week 7"
                }
                bookingRules = component "Venue Booking Rules" "What a booking request needs (time, space, layout, session); how Venue Staff decide it; withdrawing or releasing one booking while the event's other bookings stay. Code: src/lib/venueBookingRequest.ts, venueBookingReview.ts, venueBookingReviewService.ts, venueBookingChange.ts" "TypeScript modules" {
                    tags "Rules" "Week 7"
                }
                safetyRules = component "Safety Check Rules" "When an event can be submitted, the Safety Officer's outcomes, returning an event to an earlier stage, and closing a pending check on cancel or postpone. Code: src/lib/safetyCheck.ts, safetyDecision.ts, safetyResolution.ts, safetyCheckClose.ts" "TypeScript modules" {
                    tags "Rules" "Week 7"
                }
                equipmentEngine = component "Equipment Availability Engine" "Collection day to Return Day blocking, busiest-day count of units held elsewhere, out-of-service units; request fulfilment, reserve quantity and alternatives. Code: src/lib/equipment.ts, equipmentAvailability*.ts, equipmentOutOfService.ts, equipmentFulfilment.ts, equipmentReservation.ts, equipmentSuggestion.ts" "TypeScript modules" {
                    tags "Rules"
                }
                registrationRules = component "Registration & Waiting List Rules" "Registration settings, who may register, capacity checked under a row lock, withdrawals, manual additions, and offering a freed place to the next person on the waiting list. Code: src/lib/registrationSettings.ts, registrationEligibility.ts, waitingList*.ts, manualRegistration.ts" "TypeScript modules" {
                    tags "Rules"
                }
            }

            database = container "Database" "Organisations, users, events and sessions, status history, venues with setup/turnaround times, unavailable periods, venue bookings (several per event) and holds, equipment and requests, safety checks, change requests, clarifications, flags, registrations and waiting list, notifications." "PostgreSQL on Neon (hosted)" {
                tags "Database" "Week 7"
            }
        }

        # People -> Web UI (no technology: these become the C1 relationships too)
        organiser -> connectsphere.webui "Submits and tracks requests using"
        lead -> connectsphere.webui "Assigns coordinators using"
        coordinator -> connectsphere.webui "Plans and confirms events using"
        venueStaff -> connectsphere.webui "Manages venues and bookings using"
        techSupport -> connectsphere.webui "Reserves equipment using"
        safetyOfficer -> connectsphere.webui "Conducts safety checks using"
        attendee -> connectsphere.webui "Registers for events using"

        connectsphere.webui -> connectsphere.api "Calls the JSON API (session token in the Authorization header)" "JSON / HTTPS"
        connectsphere.api -> connectsphere.database "Reads from and writes to" "SQL over TLS"

        # ---- Web UI components ----
        organiser -> connectsphere.webui.pages "Submits requests, answers clarifications, asks for changes on"
        lead -> connectsphere.webui.pages "Assigns and reassigns coordinators on"
        coordinator -> connectsphere.webui.pages "Plans, books venues, reviews flags, confirms events on"
        venueStaff -> connectsphere.webui.pages "Manages venues, unavailable periods and bookings on"
        techSupport -> connectsphere.webui.pages "Manages and reserves equipment on"
        safetyOfficer -> connectsphere.webui.pages "Conducts safety checks on"
        attendee -> connectsphere.webui.pages "Registers, withdraws and joins waiting lists on"
        connectsphere.webui.shell -> connectsphere.webui.pages "Wraps every page"
        connectsphere.webui.shell -> connectsphere.webui.session "Reads the signed-in user from"
        connectsphere.webui.shell -> connectsphere.api "Asks for the unread count on every page (which runs the time-based sweeps)" "JSON / HTTPS, Authorization: Bearer JWT"
        connectsphere.webui.gate -> connectsphere.webui.pages "Guards role-restricted pages"
        connectsphere.webui.gate -> connectsphere.webui.session "Checks the user's role via"
        connectsphere.webui.pages -> connectsphere.webui.featureComponents "Reuses"
        connectsphere.webui.pages -> connectsphere.webui.session "Calls the API through (authedFetch)"
        connectsphere.webui.pages -> connectsphere.webui.format "Displays dates, references and statuses with"
        connectsphere.webui.pages -> connectsphere.webui.forms "Validates forms with"
        connectsphere.webui.pages -> connectsphere.webui.uikit "Is built from"
        connectsphere.webui.featureComponents -> connectsphere.webui.uikit "Is built from"
        connectsphere.webui.session -> connectsphere.api "Makes API calls with the session token" "JSON / HTTPS, Authorization: Bearer JWT"
        connectsphere.webui.pages -> connectsphere.api "Logs in and registers via" "JSON / HTTPS"

        # ---- API Server: Web UI -> routes ----
        connectsphere.webui -> connectsphere.api.authApi "Logs in and registers via" "JSON / HTTPS"
        connectsphere.webui -> connectsphere.api.eventsApi "Calls" "JSON / HTTPS"
        connectsphere.webui -> connectsphere.api.assignApi "Calls" "JSON / HTTPS"
        connectsphere.webui -> connectsphere.api.changeApi "Calls" "JSON / HTTPS"
        connectsphere.webui -> connectsphere.api.venuesApi "Calls" "JSON / HTTPS"
        connectsphere.webui -> connectsphere.api.bookingApi "Calls" "JSON / HTTPS"
        connectsphere.webui -> connectsphere.api.equipmentApi "Calls" "JSON / HTTPS"
        connectsphere.webui -> connectsphere.api.arrangementsApi "Calls" "JSON / HTTPS"
        connectsphere.webui -> connectsphere.api.safetyApi "Calls" "JSON / HTTPS"
        connectsphere.webui -> connectsphere.api.registrationsApi "Calls" "JSON / HTTPS"
        connectsphere.webui -> connectsphere.api.notificationsApi "Calls" "JSON / HTTPS"
        connectsphere.webui -> connectsphere.api.facilitiesApi "Calls" "JSON / HTTPS"

        # ---- routes -> business rules ----
        connectsphere.api.eventsApi -> connectsphere.api.lifecycle "Changes status with"
        connectsphere.api.eventsApi -> connectsphere.api.sessionsRules "Derives and writes sessions with"
        connectsphere.api.assignApi -> connectsphere.api.assignRules "Assigns and lists with"
        connectsphere.api.changeApi -> connectsphere.api.changeRules "Applies approved changes with"
        connectsphere.api.venuesApi -> connectsphere.api.venueChange "Flags affected bookings with"
        connectsphere.api.venuesApi -> connectsphere.api.suitability "Searches and assesses venues with"
        connectsphere.api.bookingApi -> connectsphere.api.bookingRules "Requests, decides, withdraws and releases bookings with"
        connectsphere.api.bookingRules -> connectsphere.api.venueTime "Checks occupied periods and conflicts with"
        connectsphere.api.bookingRules -> connectsphere.api.suitability "Checks each space against its own requirements with"
        connectsphere.api.bookingRules -> connectsphere.api.notifications "Notifies the coordinator of the decision with"
        connectsphere.api.bookingApi -> connectsphere.api.holds "Sets and sweeps hold expiry with"
        connectsphere.api.equipmentApi -> connectsphere.api.equipmentEngine "Computes availability and reserves with"
        connectsphere.api.arrangementsApi -> connectsphere.api.arrangementRules "Lists outstanding and flagged items with"
        connectsphere.api.safetyApi -> connectsphere.api.safetyRules "Validates the decision (its Zod schema) and works out the new status with"
        connectsphere.api.registrationsApi -> connectsphere.api.registrationRules "Registers and offers places with"
        connectsphere.api.notificationsApi -> connectsphere.api.holds "Sweeps due holds before counting unread with"
        connectsphere.api.notificationsApi -> connectsphere.api.lifecycle "Auto-completes events 7 days after they end with"
        connectsphere.api.notificationsApi -> connectsphere.api.registrationRules "Ends lapsed place offers with"
        connectsphere.api.lifecycle -> connectsphere.api.safetyRules "Confirm waits for safety approval with"
        connectsphere.api.eventsApi -> connectsphere.api.notifications "Notifies the people involved in a status change with"
        connectsphere.api.assignApi -> connectsphere.api.notifications "Notifies old and new coordinators with"
        connectsphere.api.safetyApi -> connectsphere.api.notifications "Notifies the Safety Officer and the coordinator with"
        connectsphere.api.venueChange -> connectsphere.api.notifications "Notifies coordinators of flagged bookings with"
        connectsphere.api.holds -> connectsphere.api.prisma "Expires holds and writes the warning notifications with"
        connectsphere.api.registrationRules -> connectsphere.api.notifications "Offers freed places with"
        connectsphere.api.notifications -> connectsphere.api.prisma "Writes notifications (in the caller's transaction) with"
        connectsphere.api.sessionsRules -> connectsphere.api.prisma "Writes sessions (in the caller's transaction) with"

        # ---- request pipeline (drawn for the Safety Check API) ----
        connectsphere.api.authApi -> connectsphere.api.tokens "Hashes passwords, signs tokens with"
        connectsphere.api.safetyApi -> connectsphere.api.requestAuth "Identifies the caller with"
        connectsphere.api.safetyApi -> connectsphere.api.permissions "Checks access with"
        connectsphere.api.safetyApi -> connectsphere.api.prisma "Updates the check and the event status, in one transaction, with"
        connectsphere.api.requestAuth -> connectsphere.api.tokens "Verifies the JWT with"
        connectsphere.api.requestAuth -> connectsphere.api.prisma "Re-reads the current user with"
        connectsphere.api.prisma -> connectsphere.database "Reads from and writes to" "SQL over TLS"
    }

    views {
        systemContext connectsphere "C1_Context" "Level 1 - System Context after the Week 7 changes: who uses ConnectSphere. Orange outline = added or changed by Week 7. In-app notifications only, so there are no external systems." {
            include *
            autoLayout tb
        }

        container connectsphere "C2_Containers" "Level 2 - Containers after the Week 7 changes. Still one Next.js app and one database: time-based rules run inside the API Server on request, so no worker container was added. Orange outline = changed by Week 7." {
            include *
            autoLayout tb
        }

        component connectsphere.api "C3_API_Server" "Level 3 - Components of the API Server after Week 7. Blue = route handlers, green = business rules, light blue = shared services. Orange outline = added or changed by Week 7. Every route except sign-up also uses Request Auth and the Permission Model; routes that take input validate it with a Zod schema (src/lib/validation, or kept with its rules); all use the Prisma Client, and most that change data write notifications - see the Request Pipeline view." {
            include connectsphere.webui
            include "element.tag==Route"
            include "element.tag==Rules"
            include connectsphere.api.notifications connectsphere.api.prisma
            include connectsphere.database
            exclude "connectsphere.api.safetyApi -> connectsphere.api.prisma"
            exclude "connectsphere.api.holds -> connectsphere.api.prisma"
            autoLayout tb
        }

        component connectsphere.api "C3_Request_Pipeline" "Level 3 - The request pipeline the API routes follow, shown for the new Safety Check API (Week 7 #6): identify the caller, check access, validate any input (here the Zod schema lives with the safety rules, src/lib/safetyDecision.ts), apply the rules, read/write the database and notify, in one transaction." {
            include connectsphere.webui
            include connectsphere.api.safetyApi connectsphere.api.requestAuth connectsphere.api.permissions connectsphere.api.safetyRules connectsphere.api.notifications connectsphere.api.tokens connectsphere.api.prisma
            include connectsphere.database
            exclude "connectsphere.webui -> connectsphere.api.authApi"
            autoLayout tb
        }

        component connectsphere.webui "C3_Web_UI" "Level 3 - Components of the Web UI (runs in the browser) after Week 7. Orange outline = added or changed by Week 7." {
            include *
            autoLayout tb
        }

        styles {
            element "Person" {
                shape person
                background #08427b
                color #ffffff
            }
            element "External Person" {
                background #686868
                color #ffffff
            }
            element "Software System" {
                background #1168bd
                color #ffffff
            }
            element "Container" {
                background #438dd5
                color #ffffff
            }
            element "Database" {
                shape cylinder
            }
            element "Component" {
                background #85bbf0
                color #000000
            }
            element "Shared" {
                background #c6dcf2
                color #000000
            }
            element "Rules" {
                background #d5e8d4
                color #000000
            }
            element "Week 7" {
                stroke #e8710a
                strokeWidth 6
            }
        }
    }
}
