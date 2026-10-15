@AGENTS.md

## Design docs

When a change adds or changes a role, container or external system, update `docs/architecture/connectsphere.dsl` and regenerate the `.puml` files (see `docs/architecture/README.md`). When it changes `prisma/schema.prisma`, run `npm run docs:class-diagram`. When it changes a key flow (event lifecycle, venue booking, equipment request, registration), update the matching sequence diagram in `docs/architecture/`. When it makes a design decision (a rule, a locking strategy, a model change), add an ADR under `docs/architecture/adr/`. Do all of this in the same PR as the code.
