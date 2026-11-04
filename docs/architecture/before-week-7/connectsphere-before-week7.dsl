workspace "ConnectSphere" "Event planning and venue booking system for ConnectSphere Event Services - before the Week 7 customer changes (main at a5730c5, end of Sprint 2, 4 Oct 2026)" {

    !identifiers hierarchical

    model {
        organiser = person "Event Organiser" "External client representative. Creates, saves as draft and submits event requests, and tracks their status." {
            tags "External Person"
        }
        opsManager = person "Event Operations Manager" "Internal. Shown in the app as 'Operations Manager'; renamed Event Coordinator Lead in Week 7. Assigns a coordinator to each submitted request."
        coordinator = person "Event Coordinator" "Internal. Reviews requests, begins planning, finds suitable venues and requests bookings, records equipment, and confirms events."
        venueStaff = person "Venue Staff" "Internal. Maintains the venue catalogue and availability, and approves or rejects venue booking requests."
        techSupportStaff = person "Technical Support Staff" "Internal. Maintains equipment stock, reviews requests and reserves equipment."
        attendee = person "Attendee" "External participant who registers for confirmed events (the screen to register was not built yet)." {
            tags "External Person"
        }

        connectsphere = softwareSystem "ConnectSphere" "Lets ConnectSphere staff and their clients plan events end to end: event requests and review, coordinator assignment, venue search and booking, equipment availability and reservation, and attendee registration. Notifications are recorded but not yet viewable." {

            webUI = container "Web UI" "The screens each role uses: React pages that run in the user's browser (only the public home page is rendered on the server). After login, every screen calls the API with the user's session token." "React 19, Next.js App Router pages, Tailwind CSS" {
                pages = component "Pages" "One screen per route: login/register, dashboard, events (new, edit draft, hub, review, venue, booking request, equipment), review queue, assignments, equipment requests, venues (catalogue, add/edit, find a venue, availability calendar), booking requests. Placeholders: browse events, my registrations, notifications, equipment catalogue. The event hub shows tabs per role and an at-a-glance panel. Code: src/app/**/page.tsx, src/app/events/[id]/EventGlance.tsx, src/lib/eventTabs.ts" "React, Next.js App Router pages"
                appShell = component "App Shell & Navigation" "Top bar and role-based sidebar for the six roles. Code: src/components/AppShell.tsx, src/lib/roles.ts" "React component"
                accessGate = component "Access Gate" "Hides screens a role may not use and shows a placeholder for stories not yet built. Usability only - the API re-checks every request. Code: src/components/RequirePermission.tsx, NotBuiltYet.tsx" "React component"
                featureComponents = component "Shared Feature Components" "Pieces used on more than one screen: assign coordinator, begin planning, session fields, venue form. Code: src/components/AssignCoordinator.tsx, BeginPlanningDialog.tsx, SessionFields.tsx, VenueForm.tsx" "React components"
                session = component "Session & Current User" "Stores the login token and adds it to every API call (authedFetch); loads who is signed in. Code: src/lib/session.ts, src/lib/useCurrentUser.ts" "TypeScript (runs in the browser)"
                formLogic = component "Form Logic" "Client-side validation and payload building for the event, venue and venue search forms; review decisions; maps server errors back onto fields. Code: src/lib/eventForm.ts, venueForm.ts, venueSearchForm.ts, eventReview.ts, formErrors.ts" "TypeScript modules"
                uiKit = component "UI Kit" "Shared building blocks: Button, Table, Alert, Card, Tabs, DataState, StatusBadge, ConfirmDialog, Field, PageHeader. Code: src/components/ui" "React components, Tailwind CSS"
                formatting = component "Formatting & Statuses" "Singapore-time dates, EVT-000123 references, status labels and colours. Code: src/lib/format.ts, src/lib/statuses.ts" "TypeScript module"
            }

            apiServer = container "API Server" "Next.js server. Delivers the pages and exposes the JSON REST API. Every route except sign-up identifies the caller and checks role AND relationship to the event; routes that take input validate it; then it reads/writes the database." "Next.js 16 Route Handlers on Node.js, TypeScript" {

                authApi = component "Auth API" "Register (external roles only), log in (bcrypt check, 8-hour JWT), who-am-I. Code: /api/auth/*" "Next.js Route Handlers" {
                    tags "Route"
                }
                eventsApi = component "Events API" "Create event requests (with sessions, facilities, equipment), edit drafts, change status (submit, approve, reject, confirm) with status history, begin planning. Code: /api/events, /api/events/[id], /api/events/[id]/begin-planning" "Next.js Route Handlers" {
                    tags "Route"
                }
                assignApi = component "Assignment API" "Unassigned queue for the Operations Manager; assign a coordinator; list assignments. Code: /api/queue, /api/assignments, /api/events/[id]/coordinator" "Next.js Route Handlers" {
                    tags "Route"
                }
                venuesApi = component "Venues API" "Venue catalogue: list, add, edit, retire; find a venue (search and filter); availability calendar. Code: /api/venues, /api/venues/[id], /api/venues/search, /api/venues/[id]/availability" "Next.js Route Handlers" {
                    tags "Route"
                }
                suitabilityApi = component "Venue Suitability API" "Assesses every active venue against an event's attendance, layout, facilities and accessibility needs. Code: /api/events/[id]/venue-suitability" "Next.js Route Handlers" {
                    tags "Route"
                }
                bookingApi = component "Venue Booking API" "Coordinator requests a venue booking for an event (AM / PM / Night slots); Venue Staff list requests and approve or reject them (row lock on the venue). Code: /api/events/[id]/venue-bookings, /api/venue-bookings, /api/venue-bookings/[id]" "Next.js Route Handlers" {
                    tags "Route"
                }
                eventEquipmentApi = component "Event Equipment API" "Coordinator records, updates and removes an event's (or session's) equipment requirements. Code: /api/events/[id]/equipment, /api/events/[id]/equipment/[requestId]" "Next.js Route Handlers" {
                    tags "Route"
                }
                availabilityApi = component "Equipment Availability & Reservation API" "Technical Support queue, availability per requested line, review and update a request (fulfilment), and Reserve (row lock on the equipment item to block double-booking). Code: /api/equipment/requests, /api/events/[id]/equipment/availability, /api/events/[id]/equipment/[requestId]/fulfilment, /api/events/[id]/equipment/[requestId]/reserve" "Next.js Route Handlers" {
                    tags "Route"
                }
                equipmentApi = component "Equipment Catalogue API" "List and add equipment; record units out of service with a reason. Code: /api/equipment, /api/equipment/[id]/out-of-service" "Next.js Route Handlers" {
                    tags "Route"
                }
                registrationsApi = component "Registrations API" "Attendee registers for a confirmed, open event; capacity checked in a transaction. Code: /api/registrations" "Next.js Route Handlers" {
                    tags "Route"
                }
                facilitiesApi = component "Facilities API" "Reference list of facilities and accessibility features. Code: /api/facilities" "Next.js Route Handlers" {
                    tags "Route"
                }

                requestAuth = component "Request Auth" "Turns a request into an Actor (verifies the token, re-reads the user so deactivation takes effect at once) and answers 401 / 403 / 404. Code: src/lib/apiAuth.ts" "TypeScript module" {
                    tags "Shared"
                }
                authHelpers = component "Password & Token Helpers" "bcrypt password hashing; JWT sign and verify. Code: src/lib/auth.ts" "bcryptjs, jsonwebtoken" {
                    tags "Shared"
                }
                permissions = component "Permission Model" "Pure rules: what each of the six roles may do, which status changes each may make, and whether a user is related to an event (owner, same organisation, assigned coordinator). Unit tested. Code: src/lib/permissions.ts" "TypeScript module (pure functions)" {
                    tags "Shared"
                }
                validation = component "Validation Schemas" "Zod schemas for every request body, one file per domain. Code: src/lib/validation/" "Zod" {
                    tags "Shared"
                }
                notifications = component "Notifications" "Writes in-app notifications inside the same transaction as the change that caused them (submission, assignment, flagged booking). No screen reads them yet. Code: src/lib/notifications.ts" "TypeScript module" {
                    tags "Shared"
                }
                prismaClient = component "Prisma Client" "Single shared, type-safe database client. Code: src/lib/prisma.ts" "Prisma 6 client" {
                    tags "Shared"
                }

                lifecycleRules = component "Event Lifecycle Rules" "Begin planning (Approved -> Planning) and confirm (every arrangement in place). Code: src/lib/beginPlanning.ts, src/lib/eventConfirmation.ts" "TypeScript modules" {
                    tags "Rules"
                }
                eventRules = component "Event Session Rules" "What a multi-session event's start, end and headcount are; writes sessions and their equipment together. Code: src/lib/eventSessions.ts, sessionWrites.ts" "TypeScript modules" {
                    tags "Rules"
                }
                suitabilityRules = component "Venue Suitability & Search Rules" "Pure: capacity for the chosen layout, required facilities, accessibility; says which requirement failed. Filters for Find a venue. Code: src/lib/venueSuitability.ts, venueSearch.ts" "TypeScript modules" {
                    tags "Rules"
                }
                impactRules = component "Venue Change Impact Rules" "Pure: which upcoming bookings a venue edit or retirement puts at risk, so they are flagged - never changed. Code: src/lib/venueImpact.ts" "TypeScript modules" {
                    tags "Rules"
                }
                calendarRules = component "Venue Availability Rules" "Pure: AM / PM / Night slot grid from real booking and unavailability times, including setup and turnaround. Code: src/lib/venueAvailability.ts, venueSlots.ts" "TypeScript modules" {
                    tags "Rules"
                }
                bookingRules = component "Venue Booking Rules" "What a booking request needs (slots, layout, session) and how Venue Staff decide it: only a pending request can be approved or rejected; a rejection needs a reason. Code: src/lib/venueBookingRequest.ts, venueBookingReview.ts, venueBookingReviewService.ts" "TypeScript modules" {
                    tags "Rules"
                }
                equipmentRules = component "Equipment Availability Engine" "Collection day (D-1) to Return Day blocking, transfer time, busiest-day count of units held elsewhere, out-of-service units; reserve quantity and fulfilment status. Rules are pure; a thin service loads the rows. Code: src/lib/equipmentAvailability*.ts, equipment.ts, equipmentFulfilment.ts" "TypeScript modules" {
                    tags "Rules"
                }
            }

            database = container "Database" "Organisations, users, events and sessions, status history, venues, layouts, facilities, venue bookings, unavailability, equipment and equipment requests, registrations, notifications." "PostgreSQL on Neon (hosted)" {
                tags "Database"
            }
        }

        # ---- People -> Web UI. No technology here, so the C1 view shows none. ----
        organiser -> connectsphere.webUI "Submits and tracks requests using"
        opsManager -> connectsphere.webUI "Assigns coordinators using"
        coordinator -> connectsphere.webUI "Plans and confirms events using"
        venueStaff -> connectsphere.webUI "Manages venues and bookings using"
        techSupportStaff -> connectsphere.webUI "Reserves equipment using"
        attendee -> connectsphere.webUI "Will register for events using (screen not built yet)"

        connectsphere.webUI -> connectsphere.apiServer "Calls the JSON API (session token in the Authorization header)" "JSON / HTTPS"
        connectsphere.apiServer -> connectsphere.database "Reads from and writes to" "SQL over TLS"

        # ---- Web UI components ----
        organiser -> connectsphere.webUI.pages "Creates, submits and tracks event requests on"
        opsManager -> connectsphere.webUI.pages "Assigns coordinators on"
        coordinator -> connectsphere.webUI.pages "Reviews, plans and confirms events on"
        venueStaff -> connectsphere.webUI.pages "Manages venues and decides bookings on"
        techSupportStaff -> connectsphere.webUI.pages "Reviews and reserves equipment on"
        attendee -> connectsphere.webUI.pages "Will register on (screen not built yet)"
        connectsphere.webUI.appShell -> connectsphere.webUI.pages "Wraps every page"
        connectsphere.webUI.appShell -> connectsphere.webUI.session "Reads the signed-in user from"
        connectsphere.webUI.accessGate -> connectsphere.webUI.pages "Guards role-restricted pages"
        connectsphere.webUI.accessGate -> connectsphere.webUI.session "Checks the user's role via"
        connectsphere.webUI.pages -> connectsphere.webUI.featureComponents "Reuses"
        connectsphere.webUI.pages -> connectsphere.webUI.formLogic "Validates forms with"
        connectsphere.webUI.pages -> connectsphere.webUI.uiKit "Is built from"
        connectsphere.webUI.featureComponents -> connectsphere.webUI.uiKit "Is built from"
        connectsphere.webUI.pages -> connectsphere.webUI.formatting "Displays dates, references and statuses with"
        connectsphere.webUI.pages -> connectsphere.webUI.session "Calls the API through (authedFetch)"
        connectsphere.webUI.pages -> connectsphere.apiServer "Logs in and registers via" "JSON / HTTPS"
        connectsphere.webUI.session -> connectsphere.apiServer "Makes API calls with the session token" "JSON / HTTPS, Authorization: Bearer JWT"

        # ---- API Server: Web UI -> routes ----
        connectsphere.webUI -> connectsphere.apiServer.authApi "Logs in and registers via" "JSON / HTTPS"
        connectsphere.webUI -> connectsphere.apiServer.eventsApi "Calls" "JSON / HTTPS"
        connectsphere.webUI -> connectsphere.apiServer.assignApi "Calls" "JSON / HTTPS"
        connectsphere.webUI -> connectsphere.apiServer.venuesApi "Calls" "JSON / HTTPS"
        connectsphere.webUI -> connectsphere.apiServer.suitabilityApi "Calls" "JSON / HTTPS"
        connectsphere.webUI -> connectsphere.apiServer.bookingApi "Calls" "JSON / HTTPS"
        connectsphere.webUI -> connectsphere.apiServer.eventEquipmentApi "Calls" "JSON / HTTPS"
        connectsphere.webUI -> connectsphere.apiServer.availabilityApi "Calls" "JSON / HTTPS"
        connectsphere.webUI -> connectsphere.apiServer.equipmentApi "Calls" "JSON / HTTPS"
        connectsphere.webUI -> connectsphere.apiServer.registrationsApi "Calls" "JSON / HTTPS"
        connectsphere.webUI -> connectsphere.apiServer.facilitiesApi "Calls" "JSON / HTTPS"

        # ---- routes -> rules and shared services ----
        connectsphere.apiServer.authApi -> connectsphere.apiServer.authHelpers "Hashes passwords, signs tokens with"
        connectsphere.apiServer.eventsApi -> connectsphere.apiServer.lifecycleRules "Begins planning and confirms with"
        connectsphere.apiServer.eventsApi -> connectsphere.apiServer.eventRules "Derives and writes sessions with"
        connectsphere.apiServer.eventsApi -> connectsphere.apiServer.notifications "Notifies Operations Managers of submissions with"
        connectsphere.apiServer.assignApi -> connectsphere.apiServer.notifications "Notifies the assigned coordinator with"
        connectsphere.apiServer.venuesApi -> connectsphere.apiServer.impactRules "Finds bookings a venue change affects with"
        connectsphere.apiServer.venuesApi -> connectsphere.apiServer.calendarRules "Builds the availability calendar with"
        connectsphere.apiServer.venuesApi -> connectsphere.apiServer.suitabilityRules "Searches venues with"
        connectsphere.apiServer.venuesApi -> connectsphere.apiServer.notifications "Notifies coordinators of flagged bookings with"
        connectsphere.apiServer.suitabilityApi -> connectsphere.apiServer.suitabilityRules "Assesses venues with"
        connectsphere.apiServer.bookingApi -> connectsphere.apiServer.bookingRules "Requests and decides bookings with"
        connectsphere.apiServer.bookingApi -> connectsphere.apiServer.lifecycleRules "Begins planning on an Approved event's first booking request with"
        connectsphere.apiServer.eventEquipmentApi -> connectsphere.apiServer.equipmentRules "Derives the reservation window with"
        connectsphere.apiServer.availabilityApi -> connectsphere.apiServer.equipmentRules "Computes availability, fulfilment and reserve quantity with"
        connectsphere.apiServer.equipmentApi -> connectsphere.apiServer.equipmentRules "Checks out-of-service counts with"
        connectsphere.apiServer.eventRules -> connectsphere.apiServer.prismaClient "Writes sessions (in the caller's transaction) with"
        connectsphere.apiServer.notifications -> connectsphere.apiServer.prismaClient "Writes notifications (in the caller's transaction) with"
        connectsphere.apiServer.equipmentRules -> connectsphere.apiServer.prismaClient "Loads requests, stock and bookings with"
        connectsphere.apiServer.bookingApi -> connectsphere.apiServer.prismaClient "Locks the venue row (SELECT ... FOR UPDATE) and saves the decision with"

        # ---- request pipeline (drawn for the Events API) ----
        connectsphere.apiServer.eventsApi -> connectsphere.apiServer.requestAuth "Identifies the caller with"
        connectsphere.apiServer.eventsApi -> connectsphere.apiServer.permissions "Checks access and allowed status changes with"
        connectsphere.apiServer.eventsApi -> connectsphere.apiServer.validation "Validates input with"
        connectsphere.apiServer.eventsApi -> connectsphere.apiServer.prismaClient "Reads and writes events with"
        connectsphere.apiServer.requestAuth -> connectsphere.apiServer.authHelpers "Verifies the JWT with"
        connectsphere.apiServer.requestAuth -> connectsphere.apiServer.prismaClient "Re-reads the current user with"
        connectsphere.apiServer.prismaClient -> connectsphere.database "Reads from and writes to" "SQL over TLS"
    }

    views {
        systemContext connectsphere "C1_Context" "Level 1 - System Context before the Week 7 changes (end of Sprint 2, 4 Oct): who uses ConnectSphere. In-app notifications only, so there are no external systems." {
            include *
            autoLayout tb
        }

        container connectsphere "C2_Containers" "Level 2 - Containers before the Week 7 changes (end of Sprint 2, 4 Oct)." {
            include *
            autoLayout tb
        }

        component connectsphere.apiServer "C3_API_Server" "Level 3 - Components of the API Server before Week 7 (end of Sprint 2, 4 Oct). Blue = route handlers, green = business rules, light blue = shared services. Every route except sign-up also uses Request Auth and the Permission Model; routes that take input use Validation Schemas; all use the Prisma Client - drawn in the Request Pipeline view." {
            include connectsphere.webUI
            include "element.tag==Route"
            include "element.tag==Rules"
            include connectsphere.apiServer.notifications connectsphere.apiServer.prismaClient connectsphere.apiServer.authHelpers
            include connectsphere.database
            exclude "connectsphere.apiServer.eventsApi -> connectsphere.apiServer.prismaClient"
            autoLayout tb
        }

        component connectsphere.apiServer "C3_Request_Pipeline" "Level 3 - The request pipeline the API routes follow, shown for the Events API: identify the caller, check access, validate any input, apply business rules, read/write the database." {
            include connectsphere.webUI
            include connectsphere.apiServer.eventsApi connectsphere.apiServer.requestAuth connectsphere.apiServer.permissions connectsphere.apiServer.validation connectsphere.apiServer.lifecycleRules connectsphere.apiServer.eventRules connectsphere.apiServer.notifications connectsphere.apiServer.authHelpers connectsphere.apiServer.prismaClient
            include connectsphere.database
            exclude "connectsphere.webUI -> connectsphere.apiServer.authApi"
            autoLayout tb
        }

        component connectsphere.webUI "C3_Web_UI" "Level 3 - Components of the Web UI (runs in the browser) before Week 7 (end of Sprint 2, 4 Oct)." {
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
        }
    }
}
