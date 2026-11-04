# Architecture diagrams (C4 model)

Two sets of C4 diagrams: the system before the Week 7 customer changes and the
system after them. Each set is drawn from one Structurizr DSL file in its folder;
the PNGs are generated from it, so edit the `.dsl`, not the images.

| Folder | Describes | Diagrams |
|---|---|---|
| [before-week-7/](before-week-7/) | `main` at `a5730c5`, end of Sprint 2 (4 Oct 2026). The Week 7 changes reached Jira on 2 Oct; no Week 7 code was merged before 9 Oct. | C1, C2, C3 API Server, C3 Request Pipeline |
| [after-week-7/](after-week-7/) | `main` now. An orange outline marks what the Week 7 changes added or changed. | C1, C2, C3 API Server, C3 Request Pipeline |

- **C1 Context:** ConnectSphere as one box and the roles that use it. No
  external systems: notifications are in-app only.
- **C2 Containers:** Web UI (React in the browser), API Server (Next.js route
  handlers) and Database (PostgreSQL on Neon). Time-based rules (hold expiry,
  auto-complete, waiting-list offers) run inside requests, so there is no
  worker container.
- **C3 API Server:** route groups (blue), business rules (green) and shared
  services (light blue). Each box ends with "Code:", the files it covers.
- **C3 Request Pipeline:** the steps the API routes share (identify the caller,
  check access, validate any input, apply the rules, write in one
  transaction), shown for one route.

[C4-code-map.md](C4-code-map.md) points every box to its file and line.

## Regenerating the images

Needs `structurizr-cli` and `plantuml` (`brew install structurizr-cli plantuml`).

    cd docs/architecture/after-week-7
    structurizr-cli export -workspace connectsphere-after-week7.dsl -format plantuml -output /tmp/c4
    plantuml -tpng /tmp/c4/structurizr-C1_Context.puml /tmp/c4/structurizr-C2_Containers.puml \
      /tmp/c4/structurizr-C3_API_Server.puml /tmp/c4/structurizr-C3_Request_Pipeline.puml

Then copy the PNGs over the ones in the folder. The before set is the same with
`before-week-7` and `connectsphere-before-week7.dsl`. The DSL also defines a
C3 Web UI view, which is not exported here.

Earlier versions are in git history: the 19 Sep model
(`docs/architecture/connectsphere.dsl`) and the 29 Sep update on branch
`SPM-2-update-c4-diagrams` (commit 4a33d91).
