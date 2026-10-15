# Architecture diagrams (C4 model)

`connectsphere.dsl` is the source of truth — a Structurizr DSL description of
the system (System Context, Containers, Components). The `.puml` files are
generated from it; don't hand-edit them.

## Viewing a diagram
Install the **PlantUML** VS Code extension (jebbs.plantuml), open any
`structurizr-*.puml` file, then press Cmd+Option+D (or right-click → "Export Workspace Diagram"). Requires Java and Graphviz locally (`brew install
plantuml` pulls in both).

## After editing connectsphere.dsl
Regenerate the `.puml` files:

    structurizr-cli export -workspace docs/architecture/connectsphere.dsl -format plantuml

(`brew install structurizr-cli` if you don't have it.)

To run the CLI without Homebrew: download `structurizr-cli.zip` from its
GitHub releases, unzip it, and run (Java 17+)

    java -cp "<unzipped>/lib/*" com.structurizr.cli.StructurizrCliApplication export -workspace docs/architecture/connectsphere.dsl -format plantuml -output docs/architecture

The components (Events API, Venues API, ...) are in the model but in no view
yet, so editing a component's description changes no `.puml` file.

## Class diagram
`class-diagram.puml` is generated from `prisma/schema.prisma`. Don't edit it
by hand. After any schema change, in the same PR:

    npx prisma generate
    npm run docs:class-diagram

## Sequence diagrams
Drawn by hand from the code. Update them in the PR that changes the flow.

- `sequence-venue-booking-request.puml`: request a venue booking (SPM-42,
  SPM-44, SPM-93)
- `sequence-update-event-information.puml`: update an approved event's
  information and flag what it affects (SPM-62)

## Decisions
`adr/` holds the architecture decision records. See `adr/README.md` for the
index and the template.

## Files
- `structurizr-SystemContext.puml` — Level 1: who uses the system
- `structurizr-Containers.puml` — Level 2: Web App + Database
- `*-key.puml` — legend for each diagram above
- `class-diagram.puml` — the data model, generated from the Prisma schema
- `sequence-*.puml` — key flows
- `adr/` — architecture decision records
