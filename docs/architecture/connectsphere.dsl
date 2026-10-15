workspace "ConnectSphere" "Event planning and venue booking system for ConnectSphere Event Services" {

    model {
        organiser = person "Event Organiser" "External client representative who submits event requests and communicates requirements." {
            tags "External Person"
        }
        opsManager = person "Ops Manager" "Assigns an Event Coordinator to each submitted request from the unassigned queue."
        coordinator = person "Event Coordinator" "Reviews event requests, requests venue bookings and equipment, and confirms events."
        venueStaff = person "Venue Staff" "Manages venue information, availability, and booking decisions."
        techSupportStaff = person "Technical Support Staff" "Manages equipment records, availability, and reservations."
        attendee = person "Attendee" "External participant who registers for confirmed events." {
            tags "External Person"
        }

        connectsphere = softwareSystem "ConnectSphere" "Lets ConnectSphere staff and clients plan events, book venues, reserve equipment, and manage attendee registration." {

            webapp = container "Web Application" "Serves the UI for events, venues, equipment and registrations, and exposes the REST API that enforces business rules and validation." "Next.js (React + Node.js, App Router)" {

                pages = component "Pages" "Home, login, register and events pages." "Next.js React (client-rendered)"
                sessionHelper = component "Session Helper" "Stores the JWT in localStorage and wraps fetch calls with the Authorization header." "TypeScript (browser)"

                authApi = component "Auth API" "Login, registration and session lookup." "Next.js Route Handlers"
                eventsApi = component "Events API" "Event request creation, review and status transitions; updates to an approved event's information, which flag the venue bookings, equipment and registrations a change affects for the coordinator's review instead of changing them (ADR-0003)." "Next.js Route Handlers"
                venuesApi = component "Venues API" "Venue catalogue and booking endpoints." "Next.js Route Handlers"
                equipmentApi = component "Equipment API" "Equipment catalogue and reservation endpoints." "Next.js Route Handlers"
                registrationsApi = component "Registrations API" "Attendee registration endpoints." "Next.js Route Handlers"

                validation = component "Validation" "Zod request-body schemas." "Zod"
                authHelpers = component "Auth Helpers" "Password hashing and JWT sign/verify." "bcryptjs, jsonwebtoken"
                prismaClient = component "Prisma Client" "Shared database client." "Prisma"
            }

            database = container "Database" "Stores users, events, venues, equipment, bookings and registrations." "PostgreSQL (Neon)" {
                tags "Database"
            }
        }

        organiser -> webapp "Submits and edits event requests, tracks status using" "" "ContextRel"
        opsManager -> webapp "Assigns coordinators to unassigned requests using" "" "ContextRel"
        coordinator -> webapp "Reviews requests, confirms events using" "" "ContextRel"
        venueStaff -> webapp "Manages venue catalogue and booking approvals using" "" "ContextRel"
        techSupportStaff -> webapp "Manages equipment catalogue and reservations using" "" "ContextRel"
        attendee -> webapp "Registers for events and views event details using" "" "ContextRel"

        webapp -> database "Reads from and writes to" "SQL / Prisma / TCP" "ContextRel"

        organiser -> eventsApi "Submits and edits event requests using"
        opsManager -> eventsApi "Assigns coordinators using"
        coordinator -> eventsApi "Reviews and confirms events using"
        venueStaff -> venuesApi "Manages venues and booking decisions using"
        techSupportStaff -> equipmentApi "Manages equipment and reservations using"
        attendee -> registrationsApi "Registers for events using"

        pages -> authApi "Calls directly (no token yet, login/register)" "JSON / HTTPS"
        pages -> sessionHelper "Saves the token after login, and wraps calls that need one via"
        sessionHelper -> eventsApi "Calls" "JSON / HTTPS"

        authApi -> validation "Validates request body using"
        authApi -> authHelpers "Hashes passwords and issues/verifies JWTs using"
        authApi -> prismaClient "Reads from and writes to"

        eventsApi -> validation "Validates request body using"
        eventsApi -> authHelpers "Verifies the session token using"
        eventsApi -> prismaClient "Reads from and writes to"

        venuesApi -> validation "Validates request body using"
        venuesApi -> authHelpers "Verifies the session token using"
        venuesApi -> prismaClient "Reads from and writes to"

        equipmentApi -> validation "Validates request body using"
        equipmentApi -> authHelpers "Verifies the session token using"
        equipmentApi -> prismaClient "Reads from and writes to"

        registrationsApi -> validation "Validates request body using"
        registrationsApi -> authHelpers "Verifies the session token using"
        registrationsApi -> prismaClient "Reads from and writes to"

        prismaClient -> database "Reads from and writes to" "SQL / TCP"
    }

    views {
        systemContext connectsphere "SystemContext" "The environment ConnectSphere operates in." {
            include *
            autoLayout tb
        }

        container connectsphere "Containers" "The containers that make up ConnectSphere." {
            include *
            autoLayout tb
        }

        styles {
            element "Person" {
                shape person
                background #08427b
                color #ffffff
                fontSize 24
            }
            element "External Person" {
                shape person
                background #999999
                color #ffffff
                fontSize 24
            }
            element "Software System" {
                background #1168bd
                color #ffffff
                fontSize 24
            }
            element "External System" {
                background #999999
                color #ffffff
                fontSize 24
            }
            element "Container" {
                background #438dd5
                color #ffffff
                fontSize 22
            }
            element "Database" {
                shape cylinder
                fontSize 22
            }
            element "Component" {
                background #85bbf0
                color #000000
            }
            element "Shared" {
                background #999999
                color #ffffff
            }

            relationship "Relationship" {
                routing Direct
                fontSize 16
                width 250
            }

            relationship "ContextRel" {
                fontSize 24
            }
        }
    }
}
