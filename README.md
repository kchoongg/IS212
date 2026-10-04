# IS212

## Stack

- Next.js 14 (App Router, TypeScript)
- Tailwind CSS
- PostgreSQL via Prisma
- Hand-rolled auth: bcryptjs (password hashing) + jsonwebtoken (sessions)
- Zod (validation)
- Vitest (testing)

## Getting started

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (local Postgres, Neon, or Supabase) and `JWT_SECRET`.
3. Apply the schema to your database:
   ```
   npm run prisma:migrate
   ```
4. Run the dev server:
   ```
   npm run dev
   ```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | Lint the whole repo |
| `npx tsc --noEmit` | Type-check |
| `npm test` | Run tests once |
| `npm run test:coverage` | Run tests once and report coverage (`coverage/index.html`) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:migrate` | Create/apply a migration |
| `npm run prisma:studio` | Open Prisma Studio |

## Project layout

- `src/app` — App Router routes (pages and `api/`)
- `src/components/ui` — the shared component library; import from `@/components/ui`
- `src/components/AppShell.tsx` — top bar and role-aware sidebar
- `src/lib/prisma.ts` — Prisma client singleton
- `src/lib/auth.ts` — password hashing and JWT session helpers
- `src/lib/validation/` — Zod schemas, one file per domain (`events.ts`, `equipment.ts`, ...)
- `src/lib/roles.ts`, `statuses.ts`, `format.ts` — role, status and display rules
- `prisma/schema.prisma` — data model

## Documentation

- `DOCUMENTATION.md` — how the app is built, conventions, changelog
- `UI_DESIGN.md` — every screen, navigation, forms, error states
- `SCHEMA_REFERENCE.md` — per-table field reference
- `design/mockups/` — visual mockups, one file per screen
