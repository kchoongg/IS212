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

## Files
- `structurizr-SystemContext.puml` — Level 1: who uses the system
- `structurizr-Containers.puml` — Level 2: Web App + Database
- `*-key.puml` — legend for each diagram above
